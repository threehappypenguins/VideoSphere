// =============================================================================
// WEBHOOK EVENT REPOSITORY
// =============================================================================
// Stores durable Stripe webhook processing records so duplicate deliveries,
// retries, and replays can be ignored safely across deploys and restarts.
// =============================================================================

import { createHash } from 'crypto';
import { connectToDatabase } from '@/lib/mongodb';
import {
  ProcessedWebhookEventModel,
  type ProcessedWebhookEventDocument,
} from '@/lib/models/ProcessedWebhookEvent';

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

function isMongoDuplicateKeyError(error: unknown): boolean {
  const mongoError = error as { code?: number } | null;
  return mongoError?.code === 11000;
}

function webhookEventRowId(provider: WebhookProvider, eventId: string): string {
  const hash = createHash('sha256').update(`${provider}:${eventId}`).digest('hex').slice(0, 32);
  return `${provider[0]}_${hash}`;
}

function trimLastError(message: string): string {
  return message.length <= MAX_LAST_ERROR_LENGTH
    ? message
    : `${message.slice(0, MAX_LAST_ERROR_LENGTH - 1)}…`;
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
  await connectToDatabase();
  const rowId = webhookEventRowId('stripe', eventId);
  const doc = await ProcessedWebhookEventModel.findById(
    rowId
  ).lean<ProcessedWebhookEventDocument | null>();
  if (!doc) return null;

  return {
    status: normalizeWebhookEventStatus(doc.status),
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
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
  await connectToDatabase();

  const rowId = webhookEventRowId('stripe', eventId);
  const current = await ProcessedWebhookEventModel.findById(
    rowId
  ).lean<ProcessedWebhookEventDocument | null>();

  if (!current) {
    try {
      await createWebhookEventRecord({
        eventId,
        provider: 'stripe',
        eventType,
      });
      return true;
    } catch (error) {
      if (!isMongoDuplicateKeyError(error)) {
        throw error;
      }
      return false;
    }
  }

  const currentStatus = normalizeWebhookEventStatus(current.status);
  const currentCreatedAt = new Date(current.createdAt).toISOString();
  const currentUpdatedAt = new Date(current.updatedAt).toISOString();

  if (!canReclaimFromStatus(currentStatus, currentUpdatedAt, currentCreatedAt)) {
    return false;
  }

  const updated = await ProcessedWebhookEventModel.findOneAndUpdate(
    {
      _id: rowId,
      status: current.status,
      updatedAt: current.updatedAt,
    },
    {
      eventId,
      provider: 'stripe',
      eventType,
      status: 'processing',
      lastError: '',
    },
    { returnDocument: 'after' }
  ).lean<ProcessedWebhookEventDocument | null>();

  return updated !== null;
}

async function createWebhookEventRecord(input: CreateWebhookEventRecordInput): Promise<void> {
  await connectToDatabase();
  const rowId = webhookEventRowId(input.provider, input.eventId);
  await ProcessedWebhookEventModel.create({
    _id: rowId,
    eventId: input.eventId,
    provider: input.provider,
    eventType: input.eventType,
    status: 'processing' satisfies WebhookEventStatus,
    lastError: '',
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
  await connectToDatabase();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await createWebhookEventRecord({
        eventId,
        provider: 'stripe',
        eventType,
      });
      return { claimed: true, status: 'processing' };
    } catch (error) {
      if (!isMongoDuplicateKeyError(error)) {
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
  await connectToDatabase();
  const rowId = webhookEventRowId('stripe', eventId);
  const result = await ProcessedWebhookEventModel.updateOne(
    { _id: rowId },
    { status: 'completed' satisfies WebhookEventStatus }
  );
  if (result.matchedCount === 0) {
    throw new Error('Processed webhook event not found');
  }
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
  await connectToDatabase();
  const rowId = webhookEventRowId('stripe', eventId);
  const result = await ProcessedWebhookEventModel.updateOne(
    { _id: rowId },
    {
      status: 'failed' satisfies WebhookEventStatus,
      lastError: trimLastError(lastError),
    }
  );
  if (result.matchedCount === 0) {
    throw new Error('Processed webhook event not found');
  }
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
  await connectToDatabase();
  const rowId = webhookEventRowId('stripe', eventId);
  const result = await ProcessedWebhookEventModel.updateOne(
    { _id: rowId },
    {
      status: 'completed_with_bookkeeping_error' satisfies WebhookEventStatus,
      lastError: trimLastError(lastError),
    }
  );
  if (result.matchedCount === 0) {
    throw new Error('Processed webhook event not found');
  }
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
  await connectToDatabase();
  const rowId = webhookEventRowId('stripe', eventId);
  const result = await ProcessedWebhookEventModel.updateOne(
    { _id: rowId },
    {
      status: 'failed_non_retryable' satisfies WebhookEventStatus,
      lastError: trimLastError(lastError),
    }
  );
  if (result.matchedCount === 0) {
    throw new Error('Processed webhook event not found');
  }
}

/**
 * Executes delete stripe webhook event.
 * @param eventId - Input value for event id.
 * @returns The computed result.
 */
export async function deleteStripeWebhookEvent(eventId: string): Promise<void> {
  await connectToDatabase();
  const rowId = webhookEventRowId('stripe', eventId);
  await ProcessedWebhookEventModel.deleteOne({ _id: rowId });
}
