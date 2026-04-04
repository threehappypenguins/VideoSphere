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
  firstSeenAt: string | null;
}

function webhookEventRowId(provider: WebhookProvider, eventId: string): string {
  // Keep Appwrite row IDs within a conservative charset/length while preserving determinism.
  const hash = createHash('sha256').update(`${provider}:${eventId}`).digest('hex').slice(0, 32);
  return `${provider[0]}_${hash}`;
}

function nowIso(): string {
  return new Date().toISOString();
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

function isStaleProcessing(firstSeenAt: string | null): boolean {
  if (!firstSeenAt) return false;
  const firstSeenTime = Date.parse(firstSeenAt);
  if (!Number.isFinite(firstSeenTime)) return false;
  return Date.now() - firstSeenTime > processingStaleMs();
}

async function getWebhookEventRow(eventId: string): Promise<WebhookEventRow | null> {
  const rowId = webhookEventRowId('stripe', eventId);
  try {
    const row = (await tablesDb.getRow({
      databaseId: DATABASE_ID,
      tableId: PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID,
      rowId,
    })) as Record<string, unknown>;

    return {
      status: normalizeWebhookEventStatus(row.status),
      firstSeenAt: typeof row.firstSeenAt === 'string' ? row.firstSeenAt : null,
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

async function tryTransitionWebhookEventToProcessing(
  eventId: string,
  eventType: string
): Promise<boolean> {
  const rowId = webhookEventRowId('stripe', eventId);
  const nextFirstSeenAt = nowIso();
  try {
    await tablesDb.updateRow({
      databaseId: DATABASE_ID,
      tableId: PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID,
      rowId,
      data: {
        eventId,
        provider: 'stripe' satisfies WebhookProvider,
        eventType,
        status: 'processing' satisfies WebhookEventStatus,
        firstSeenAt: nextFirstSeenAt,
        completedAt: '',
        lastError: '',
      },
    });
    return true;
  } catch (error) {
    if (isUpdateConflictError(error)) {
      return false;
    }

    if (!isNotFoundError(error)) {
      throw error;
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
      firstSeenAt: nowIso(),
    },
  });
}

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
        const reclaimed = await tryTransitionWebhookEventToProcessing(eventId, eventType);
        if (reclaimed) {
          return { claimed: true, status: 'processing' };
        }
        continue;
      }

      if (existing.status === 'processing' && isStaleProcessing(existing.firstSeenAt)) {
        const reclaimed = await tryTransitionWebhookEventToProcessing(eventId, eventType);
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

export async function markStripeWebhookEventCompleted(eventId: string): Promise<void> {
  const rowId = webhookEventRowId('stripe', eventId);
  await tablesDb.updateRow({
    databaseId: DATABASE_ID,
    tableId: PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID,
    rowId,
    data: {
      status: 'completed' satisfies WebhookEventStatus,
      completedAt: nowIso(),
    },
  });
}

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
      completedAt: nowIso(),
      lastError: trimLastError(lastError),
    },
  });
}

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
      completedAt: nowIso(),
      lastError: trimLastError(lastError),
    },
  });
}

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
