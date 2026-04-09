// =============================================================================
// WEBHOOK EVENT REPOSITORY
// =============================================================================
// Stores durable Stripe webhook processing records so duplicate deliveries,
// retries, and replays can be ignored safely across deploys and restarts.
// =============================================================================

import { TablesDB } from 'node-appwrite';
import { createHash } from 'crypto';
import appwriteClient from '@/lib/appwrite';
import { DATABASE_ID, PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID } from '@/lib/appwrite-constants';
import { assertAppwriteRowTimestamps } from '@/lib/assert-appwrite-row-timestamps';

const tablesDb = new TablesDB(appwriteClient);

type WebhookProvider = 'stripe';
type WebhookEventStatus =
  | 'processing'
  | 'completed'
  | 'failed'
  | 'completed_with_bookkeeping_error'
  | 'failed_non_retryable';

const MAX_LAST_ERROR_LENGTH = 2000;
const DEFAULT_PROCESSING_STALE_MS = 10 * 60 * 1000;

/**
 * Defines the shape of stripe webhook processing claim result.
 */
export interface StripeWebhookProcessingClaimResult {
  claimed: boolean;
  status?: WebhookEventStatus;
}

interface CreateWebhookEventRecordInput {
  eventId: string;
  provider: WebhookProvider;
  eventType: string;
}

interface WebhookEventRow {
  status: WebhookEventStatus;
  createdAt: string;
  updatedAt: string;
}

interface AppwriteTransaction {
  $id?: unknown;
  id?: unknown;
  transactionId?: unknown;
}

function webhookEventRowId(provider: WebhookProvider, eventId: string): string {
  // Keep Appwrite row IDs within a conservative charset/length while preserving determinism.
  const hash = createHash('sha256').update(`${provider}:${eventId}`).digest('hex').slice(0, 32);
  return `${provider[0]}_${hash}`;
}

function trimLastError(message: string): string {
  return message.length <= MAX_LAST_ERROR_LENGTH
    ? message
    : `${message.slice(0, MAX_LAST_ERROR_LENGTH - 1)}…`;
}

function isConflictError(error: unknown): boolean {
  const appwriteError = error as { code?: number; type?: string };
  return appwriteError.code === 409 || appwriteError.type === 'row_already_exists';
}

function isNotFoundError(error: unknown): boolean {
  const appwriteError = error as { code?: number; type?: string };
  return appwriteError.code === 404 || appwriteError.type === 'row_not_found';
}

function processingStaleMs(): number {
  const raw = process.env.STRIPE_WEBHOOK_PROCESSING_STALE_MS;
  if (!raw) return DEFAULT_PROCESSING_STALE_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PROCESSING_STALE_MS;
  return parsed;
}

function normalizeWebhookEventStatus(value: unknown): WebhookEventStatus {
  if (
    value === 'completed' ||
    value === 'failed' ||
    value === 'processing' ||
    value === 'completed_with_bookkeeping_error' ||
    value === 'failed_non_retryable'
  ) {
    return value;
  }
  return 'processing';
}

function staleReferenceTime(updatedAt: string, createdAt: string): number | null {
  const parsed = Date.parse(updatedAt || createdAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function isStaleProcessing(updatedAt: string, createdAt: string): boolean {
  const referenceTime = staleReferenceTime(updatedAt, createdAt);
  if (referenceTime === null) return false;
  return Date.now() - referenceTime > processingStaleMs();
}

async function getWebhookEventRow(eventId: string): Promise<WebhookEventRow | null> {
  const rowId = webhookEventRowId('stripe', eventId);
  try {
    const row = (await tablesDb.getRow({
      databaseId: DATABASE_ID,
      tableId: PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID,
      rowId,
    })) as Record<string, unknown>;
    const { $createdAt, $updatedAt } = assertAppwriteRowTimestamps(row);

    return {
      status: normalizeWebhookEventStatus(row.status),
      createdAt: $createdAt,
      updatedAt: $updatedAt,
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

function isUpdateConflictError(error: unknown): boolean {
  const appwriteError = error as { code?: number; type?: string };
  return appwriteError.code === 409 || appwriteError.type === 'row_update_conflict';
}

function parseTransactionId(value: unknown): string | null {
  const tx = value as AppwriteTransaction;
  const candidate = tx.$id ?? tx.id ?? tx.transactionId;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

async function createTransactionId(): Promise<string> {
  const transactionalTablesDb = tablesDb as TablesDB & {
    createTransaction: (params?: { ttl?: number }) => Promise<unknown>;
  };

  const created = await transactionalTablesDb.createTransaction();
  const transactionId = parseTransactionId(created);
  if (!transactionId) {
    throw new Error('Appwrite transaction creation returned no transaction id');
  }

  return transactionId;
}

async function finalizeTransaction(
  transactionId: string,
  mode: 'commit' | 'rollback'
): Promise<void> {
  const transactionalTablesDb = tablesDb as TablesDB & {
    updateTransaction: (params: {
      transactionId: string;
      commit?: boolean;
      rollback?: boolean;
    }) => Promise<unknown>;
  };

  await transactionalTablesDb.updateTransaction({
    transactionId,
    commit: mode === 'commit' ? true : undefined,
    rollback: mode === 'rollback' ? true : undefined,
  });
}

async function rollbackTransactionQuietly(transactionId: string): Promise<void> {
  try {
    await finalizeTransaction(transactionId, 'rollback');
  } catch {
    // Best-effort rollback only.
  }
}

function canReclaimFromStatus(
  status: WebhookEventStatus,
  updatedAt: string,
  createdAt: string
): boolean {
  if (status === 'failed') {
    return true;
  }

  if (status === 'processing') {
    return isStaleProcessing(updatedAt, createdAt);
  }

  return false;
}

async function tryTransitionWebhookEventToProcessing(
  eventId: string,
  eventType: string,
  _existing: WebhookEventRow
): Promise<boolean> {
  const rowId = webhookEventRowId('stripe', eventId);
  const data: Record<string, string> = {
    eventId,
    provider: 'stripe',
    eventType,
    status: 'processing',
    lastError: '',
  };

  let transactionId: string | null = null;
  let settled = false;

  try {
    transactionId = await createTransactionId();

    const txRow = (await tablesDb.getRow({
      databaseId: DATABASE_ID,
      tableId: PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID,
      rowId,
      transactionId,
    })) as Record<string, unknown>;
    const { $createdAt, $updatedAt } = assertAppwriteRowTimestamps(txRow);
    const txStatus = normalizeWebhookEventStatus(txRow.status);

    if (!canReclaimFromStatus(txStatus, $updatedAt, $createdAt)) {
      await finalizeTransaction(transactionId, 'rollback');
      settled = true;
      return false;
    }

    await tablesDb.updateRow({
      databaseId: DATABASE_ID,
      tableId: PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID,
      rowId,
      data,
      transactionId,
    });

    await finalizeTransaction(transactionId, 'commit');
    settled = true;
    return true;
  } catch (error) {
    if (isUpdateConflictError(error)) {
      return false;
    }

    if (!isNotFoundError(error)) {
      throw error;
    }
  } finally {
    if (transactionId && !settled) {
      await rollbackTransactionQuietly(transactionId);
    }
  }

  try {
    await createWebhookEventRecord({
      eventId,
      provider: 'stripe',
      eventType,
    });
    return true;
  } catch (error) {
    if (isConflictError(error)) {
      return false;
    }
    throw error;
  }
}

async function createWebhookEventRecord(input: CreateWebhookEventRecordInput): Promise<void> {
  const rowId = webhookEventRowId(input.provider, input.eventId);
  await tablesDb.createRow({
    databaseId: DATABASE_ID,
    tableId: PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID,
    rowId,
    data: {
      eventId: input.eventId,
      provider: input.provider,
      eventType: input.eventType,
      status: 'processing' satisfies WebhookEventStatus,
    },
  });
}

/**
 * Executes claim stripe webhook event.
 * @param eventId - Input value for event id.
 * @param eventType - Input value for event type.
 * @returns The computed result.
 */
export async function claimStripeWebhookEvent(
  eventId: string,
  eventType: string
): Promise<StripeWebhookProcessingClaimResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await createWebhookEventRecord({
        eventId,
        provider: 'stripe',
        eventType,
      });
      return { claimed: true, status: 'processing' };
    } catch (error) {
      if (!isConflictError(error)) {
        throw error;
      }

      const existing = await getWebhookEventRow(eventId);
      if (!existing) {
        continue;
      }

      if (
        existing.status === 'completed' ||
        existing.status === 'completed_with_bookkeeping_error' ||
        existing.status === 'failed_non_retryable'
      ) {
        return { claimed: false, status: 'completed' };
      }

      if (existing.status === 'failed') {
        const reclaimed = await tryTransitionWebhookEventToProcessing(eventId, eventType, existing);
        if (reclaimed) {
          return { claimed: true, status: 'processing' };
        }
        continue;
      }

      if (
        existing.status === 'processing' &&
        isStaleProcessing(existing.updatedAt, existing.createdAt)
      ) {
        const reclaimed = await tryTransitionWebhookEventToProcessing(eventId, eventType, existing);
        if (reclaimed) {
          return { claimed: true, status: 'processing' };
        }
        continue;
      }

      return { claimed: false, status: existing.status };
    }
  }

  const latest = await getWebhookEventRow(eventId);
  if (!latest) {
    return { claimed: false, status: 'processing' };
  }
  return { claimed: false, status: latest.status };
}

/**
 * Executes mark stripe webhook event completed.
 * @param eventId - Input value for event id.
 * @returns The computed result.
 */
export async function markStripeWebhookEventCompleted(eventId: string): Promise<void> {
  const rowId = webhookEventRowId('stripe', eventId);
  await tablesDb.updateRow({
    databaseId: DATABASE_ID,
    tableId: PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID,
    rowId,
    data: {
      status: 'completed' satisfies WebhookEventStatus,
    },
  });
}

/**
 * Executes mark stripe webhook event failed.
 * @param eventId - Input value for event id.
 * @param lastError - Input value for last error.
 * @returns The computed result.
 */
export async function markStripeWebhookEventFailed(
  eventId: string,
  lastError: string
): Promise<void> {
  const rowId = webhookEventRowId('stripe', eventId);
  await tablesDb.updateRow({
    databaseId: DATABASE_ID,
    tableId: PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID,
    rowId,
    data: {
      status: 'failed' satisfies WebhookEventStatus,
      lastError: trimLastError(lastError),
    },
  });
}

/**
 * Executes mark stripe webhook event bookkeeping failed.
 * @param eventId - Input value for event id.
 * @param lastError - Input value for last error.
 * @returns The computed result.
 */
export async function markStripeWebhookEventBookkeepingFailed(
  eventId: string,
  lastError: string
): Promise<void> {
  const rowId = webhookEventRowId('stripe', eventId);
  await tablesDb.updateRow({
    databaseId: DATABASE_ID,
    tableId: PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID,
    rowId,
    data: {
      status: 'completed_with_bookkeeping_error' satisfies WebhookEventStatus,
      lastError: trimLastError(lastError),
    },
  });
}

/**
 * Executes mark stripe webhook event non retryable failed.
 * @param eventId - Input value for event id.
 * @param lastError - Input value for last error.
 * @returns The computed result.
 */
export async function markStripeWebhookEventNonRetryableFailed(
  eventId: string,
  lastError: string
): Promise<void> {
  const rowId = webhookEventRowId('stripe', eventId);
  await tablesDb.updateRow({
    databaseId: DATABASE_ID,
    tableId: PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID,
    rowId,
    data: {
      status: 'failed_non_retryable' satisfies WebhookEventStatus,
      lastError: trimLastError(lastError),
    },
  });
}

/**
 * Executes delete stripe webhook event.
 * @param eventId - Input value for event id.
 * @returns The computed result.
 */
export async function deleteStripeWebhookEvent(eventId: string): Promise<void> {
  const rowId = webhookEventRowId('stripe', eventId);
  try {
    await tablesDb.deleteRow({
      databaseId: DATABASE_ID,
      tableId: PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID,
      rowId,
    });
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }
    throw error;
  }
}
