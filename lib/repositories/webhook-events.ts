// =============================================================================
// WEBHOOK EVENT REPOSITORY
// =============================================================================
// Stores durable Stripe webhook processing records so duplicate deliveries,
// retries, and replays can be ignored safely across deploys and restarts.
// =============================================================================

import { TablesDB } from 'node-appwrite';
import appwriteClient from '@/lib/appwrite';
import { DATABASE_ID, PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID } from '@/lib/appwrite-constants';

const tablesDb = new TablesDB(appwriteClient);

type WebhookProvider = 'stripe';
type WebhookEventStatus = 'processing' | 'completed' | 'failed';

const MAX_LAST_ERROR_LENGTH = 2000;

export interface StripeWebhookProcessingClaimResult {
  claimed: boolean;
  status?: WebhookEventStatus;
}

interface CreateWebhookEventRecordInput {
  eventId: string;
  provider: WebhookProvider;
  eventType: string;
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

async function createWebhookEventRecord(input: CreateWebhookEventRecordInput): Promise<void> {
  await tablesDb.createRow({
    databaseId: DATABASE_ID,
    tableId: PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID,
    rowId: input.eventId,
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
  try {
    await createWebhookEventRecord({
      eventId,
      provider: 'stripe',
      eventType,
    });
    return { claimed: true, status: 'processing' };
  } catch (error) {
    if (isConflictError(error)) {
      return { claimed: false };
    }
    throw error;
  }
}

export async function markStripeWebhookEventCompleted(eventId: string): Promise<void> {
  await tablesDb.updateRow({
    databaseId: DATABASE_ID,
    tableId: PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID,
    rowId: eventId,
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
  await tablesDb.updateRow({
    databaseId: DATABASE_ID,
    tableId: PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID,
    rowId: eventId,
    data: {
      status: 'failed' satisfies WebhookEventStatus,
      lastError: trimLastError(lastError),
    },
  });
}

export async function deleteStripeWebhookEvent(eventId: string): Promise<void> {
  try {
    await tablesDb.deleteRow({
      databaseId: DATABASE_ID,
      tableId: PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID,
      rowId: eventId,
    });
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }
    throw error;
  }
}
