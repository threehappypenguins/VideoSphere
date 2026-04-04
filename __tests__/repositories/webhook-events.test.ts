import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';

const {
  mockCreateRow,
  mockUpdateRow,
  mockDeleteRow,
  mockGetRow,
  mockCreateTransaction,
  mockUpdateTransaction,
} = vi.hoisted(() => ({
  mockCreateRow: vi.fn(),
  mockUpdateRow: vi.fn(),
  mockDeleteRow: vi.fn(),
  mockGetRow: vi.fn(),
  mockCreateTransaction: vi.fn(),
  mockUpdateTransaction: vi.fn(),
}));

vi.mock('node-appwrite', () => ({
  TablesDB: class TablesDB {
    createRow = mockCreateRow;
    updateRow = mockUpdateRow;
    deleteRow = mockDeleteRow;
    getRow = mockGetRow;
    createTransaction = mockCreateTransaction;
    updateTransaction = mockUpdateTransaction;
  },
}));

vi.mock('@/lib/appwrite', () => ({
  default: {},
}));

import {
  claimStripeWebhookEvent,
  deleteStripeWebhookEvent,
  markStripeWebhookEventBookkeepingFailed,
  markStripeWebhookEventCompleted,
  markStripeWebhookEventFailed,
  markStripeWebhookEventNonRetryableFailed,
} from '@/lib/repositories/webhook-events';

function expectedWebhookRowId(eventId: string): string {
  const hash = createHash('sha256').update(`stripe:${eventId}`).digest('hex').slice(0, 32);
  return `s_${hash}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('STRIPE_WEBHOOK_PROCESSING_STALE_MS', '600000');
  mockCreateTransaction.mockResolvedValue({ $id: 'tx_1' });
  mockUpdateTransaction.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('webhook-events repository', () => {
  it('claims a new Stripe event by creating a deterministic row', async () => {
    mockCreateRow.mockResolvedValueOnce({});

    const result = await claimStripeWebhookEvent('evt_123', 'checkout.session.completed');

    expect(result).toEqual({ claimed: true, status: 'processing' });
    expect(mockCreateRow).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'processed_webhook_events',
      rowId: expectedWebhookRowId('evt_123'),
      data: expect.objectContaining({
        eventId: 'evt_123',
        provider: 'stripe',
        eventType: 'checkout.session.completed',
        status: 'processing',
      }),
    });
  });

  it('treats conflicts with completed rows as duplicate events', async () => {
    mockCreateRow.mockRejectedValueOnce({ code: 409, type: 'row_already_exists' });
    mockGetRow.mockResolvedValueOnce({
      status: 'completed',
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await claimStripeWebhookEvent('evt_duplicate', 'checkout.session.completed');

    expect(result).toEqual({ claimed: false, status: 'completed' });
  });

  it('treats bookkeeping-failure terminal status as duplicate', async () => {
    mockCreateRow.mockRejectedValueOnce({ code: 409, type: 'row_already_exists' });
    mockGetRow.mockResolvedValueOnce({
      status: 'completed_with_bookkeeping_error',
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await claimStripeWebhookEvent(
      'evt_bookkeeping_terminal',
      'checkout.session.completed'
    );

    expect(result).toEqual({ claimed: false, status: 'completed' });
  });

  it('treats non-retryable failure status as duplicate', async () => {
    mockCreateRow.mockRejectedValueOnce({ code: 409, type: 'row_already_exists' });
    mockGetRow.mockResolvedValueOnce({
      status: 'failed_non_retryable',
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await claimStripeWebhookEvent(
      'evt_non_retryable_terminal',
      'checkout.session.completed'
    );

    expect(result).toEqual({ claimed: false, status: 'completed' });
  });

  it('keeps fresh processing conflicts as in-progress duplicates', async () => {
    mockCreateRow.mockRejectedValueOnce({ code: 409, type: 'row_already_exists' });
    mockGetRow.mockResolvedValueOnce({
      status: 'processing',
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
    });

    const result = await claimStripeWebhookEvent('evt_processing', 'checkout.session.completed');

    expect(result).toEqual({ claimed: false, status: 'processing' });
    expect(mockDeleteRow).not.toHaveBeenCalled();
  });

  it('reclaims stale processing rows and allows retry processing', async () => {
    const staleDate = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    mockCreateRow.mockRejectedValueOnce({ code: 409, type: 'row_already_exists' });
    mockGetRow.mockResolvedValueOnce({
      status: 'processing',
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: staleDate,
    });
    mockGetRow.mockResolvedValueOnce({
      status: 'processing',
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: staleDate,
    });
    mockUpdateRow.mockResolvedValueOnce({});

    const result = await claimStripeWebhookEvent('evt_stale', 'checkout.session.completed');

    expect(result).toEqual({ claimed: true, status: 'processing' });
    expect(mockCreateTransaction).toHaveBeenCalledWith();
    expect(mockUpdateRow).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'processed_webhook_events',
      rowId: expectedWebhookRowId('evt_stale'),
      data: expect.objectContaining({
        status: 'processing',
        eventType: 'checkout.session.completed',
        lastError: '',
      }),
      transactionId: 'tx_1',
    });
    expect(mockUpdateTransaction).toHaveBeenCalledWith({ transactionId: 'tx_1', commit: true });
    expect(mockCreateRow).toHaveBeenCalledTimes(1);
  });

  it('reclaims failed rows and allows retry processing', async () => {
    mockCreateRow.mockRejectedValueOnce({ code: 409, type: 'row_already_exists' });
    mockGetRow.mockResolvedValueOnce({
      status: 'failed',
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-01T00:00:00.000Z',
    });
    mockGetRow.mockResolvedValueOnce({
      status: 'failed',
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-01T00:00:00.000Z',
    });
    mockUpdateRow.mockResolvedValueOnce({});

    const result = await claimStripeWebhookEvent(
      'evt_failed_reclaim',
      'checkout.session.completed'
    );

    expect(result).toEqual({ claimed: true, status: 'processing' });
    expect(mockUpdateRow).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'processed_webhook_events',
      rowId: expectedWebhookRowId('evt_failed_reclaim'),
      data: expect.objectContaining({
        status: 'processing',
        eventType: 'checkout.session.completed',
        lastError: '',
      }),
      transactionId: 'tx_1',
    });
    expect(mockUpdateTransaction).toHaveBeenCalledWith({ transactionId: 'tx_1', commit: true });
  });

  it('does not reclaim when transaction update detects a conflict', async () => {
    mockCreateRow.mockRejectedValue({ code: 409, type: 'row_already_exists' });
    mockGetRow.mockResolvedValueOnce({
      status: 'failed',
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-01T00:00:00.000Z',
    });
    mockGetRow.mockResolvedValueOnce({
      status: 'failed',
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-01T00:00:00.000Z',
    });
    mockUpdateRow.mockRejectedValueOnce({ code: 409, type: 'row_update_conflict' });
    mockGetRow.mockResolvedValueOnce({
      status: 'processing',
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
    });

    const result = await claimStripeWebhookEvent('evt_conflict', 'checkout.session.completed');

    expect(result).toEqual({ claimed: false, status: 'processing' });
    expect(mockUpdateTransaction).toHaveBeenCalledWith({ transactionId: 'tx_1', rollback: true });
  });

  it('marks a claimed event completed', async () => {
    mockUpdateRow.mockResolvedValueOnce({});

    await markStripeWebhookEventCompleted('evt_complete');

    expect(mockUpdateRow).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'processed_webhook_events',
      rowId: expectedWebhookRowId('evt_complete'),
      data: expect.objectContaining({
        status: 'completed',
      }),
    });
  });

  it('marks a failed event with a trimmed error message', async () => {
    mockUpdateRow.mockResolvedValueOnce({});
    const longMessage = 'x'.repeat(2500);

    await markStripeWebhookEventFailed('evt_failed', longMessage);

    expect(mockUpdateRow).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'processed_webhook_events',
      rowId: expectedWebhookRowId('evt_failed'),
      data: expect.objectContaining({
        status: 'failed',
        lastError: expect.any(String),
      }),
    });

    const payload = mockUpdateRow.mock.calls[0]?.[0]?.data as { lastError: string };
    expect(payload.lastError.length).toBeLessThanOrEqual(2000);
  });

  it('marks bookkeeping failure as a terminal completed status', async () => {
    mockUpdateRow.mockResolvedValueOnce({});

    await markStripeWebhookEventBookkeepingFailed('evt_bookkeeping_failure', 'update failed');

    expect(mockUpdateRow).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'processed_webhook_events',
      rowId: expectedWebhookRowId('evt_bookkeeping_failure'),
      data: expect.objectContaining({
        status: 'completed_with_bookkeeping_error',
        lastError: 'update failed',
      }),
    });
  });

  it('marks non-retryable processing failure as a terminal status', async () => {
    mockUpdateRow.mockResolvedValueOnce({});

    await markStripeWebhookEventNonRetryableFailed('evt_non_retryable_failure', 'missing_user_id');

    expect(mockUpdateRow).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'processed_webhook_events',
      rowId: expectedWebhookRowId('evt_non_retryable_failure'),
      data: expect.objectContaining({
        status: 'failed_non_retryable',
        lastError: 'missing_user_id',
      }),
    });
  });

  it('ignores delete requests for already removed rows', async () => {
    mockDeleteRow.mockRejectedValueOnce({ code: 404, type: 'row_not_found' });

    await expect(deleteStripeWebhookEvent('evt_missing')).resolves.toBeUndefined();
    expect(mockDeleteRow).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'processed_webhook_events',
      rowId: expectedWebhookRowId('evt_missing'),
    });
  });
});
