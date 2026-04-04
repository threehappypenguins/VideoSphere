import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateRow, mockUpdateRow, mockDeleteRow, mockGetRow } = vi.hoisted(() => ({
  mockCreateRow: vi.fn(),
  mockUpdateRow: vi.fn(),
  mockDeleteRow: vi.fn(),
  mockGetRow: vi.fn(),
}));

vi.mock('node-appwrite', () => ({
  TablesDB: class TablesDB {
    createRow = mockCreateRow;
    updateRow = mockUpdateRow;
    deleteRow = mockDeleteRow;
    getRow = mockGetRow;
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
} from '@/lib/repositories/webhook-events';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('STRIPE_WEBHOOK_PROCESSING_STALE_MS', '600000');
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
      rowId: 'stripe:evt_123',
      data: expect.objectContaining({
        eventId: 'evt_123',
        provider: 'stripe',
        eventType: 'checkout.session.completed',
        status: 'processing',
        firstSeenAt: expect.any(String),
      }),
    });
  });

  it('treats conflicts with completed rows as duplicate events', async () => {
    mockCreateRow.mockRejectedValueOnce({ code: 409, type: 'row_already_exists' });
    mockGetRow.mockResolvedValueOnce({
      status: 'completed',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await claimStripeWebhookEvent('evt_duplicate', 'checkout.session.completed');

    expect(result).toEqual({ claimed: false, status: 'completed' });
  });

  it('treats bookkeeping-failure terminal status as duplicate', async () => {
    mockCreateRow.mockRejectedValueOnce({ code: 409, type: 'row_already_exists' });
    mockGetRow.mockResolvedValueOnce({
      status: 'completed_with_bookkeeping_error',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await claimStripeWebhookEvent(
      'evt_bookkeeping_terminal',
      'checkout.session.completed'
    );

    expect(result).toEqual({ claimed: false, status: 'completed' });
  });

  it('keeps fresh processing conflicts as in-progress duplicates', async () => {
    mockCreateRow.mockRejectedValueOnce({ code: 409, type: 'row_already_exists' });
    mockGetRow.mockResolvedValueOnce({
      status: 'processing',
      firstSeenAt: new Date().toISOString(),
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
      firstSeenAt: staleDate,
    });
    mockUpdateRow.mockResolvedValueOnce({});

    const result = await claimStripeWebhookEvent('evt_stale', 'checkout.session.completed');

    expect(result).toEqual({ claimed: true, status: 'processing' });
    expect(mockUpdateRow).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'processed_webhook_events',
      rowId: 'stripe:evt_stale',
      data: expect.objectContaining({
        status: 'processing',
        eventType: 'checkout.session.completed',
        completedAt: '',
        lastError: '',
      }),
    });
    expect(mockCreateRow).toHaveBeenCalledTimes(1);
  });

  it('reclaims failed rows and allows retry processing', async () => {
    mockCreateRow.mockRejectedValueOnce({ code: 409, type: 'row_already_exists' });
    mockGetRow.mockResolvedValueOnce({
      status: 'failed',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
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
      rowId: 'stripe:evt_failed_reclaim',
      data: expect.objectContaining({
        status: 'processing',
        eventType: 'checkout.session.completed',
        completedAt: '',
        lastError: '',
      }),
    });
  });

  it('marks a claimed event completed', async () => {
    mockUpdateRow.mockResolvedValueOnce({});

    await markStripeWebhookEventCompleted('evt_complete');

    expect(mockUpdateRow).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'processed_webhook_events',
      rowId: 'stripe:evt_complete',
      data: expect.objectContaining({
        status: 'completed',
        completedAt: expect.any(String),
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
      rowId: 'stripe:evt_failed',
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
      rowId: 'stripe:evt_bookkeeping_failure',
      data: expect.objectContaining({
        status: 'completed_with_bookkeeping_error',
        completedAt: expect.any(String),
        lastError: 'update failed',
      }),
    });
  });

  it('ignores delete requests for already removed rows', async () => {
    mockDeleteRow.mockRejectedValueOnce({ code: 404, type: 'row_not_found' });

    await expect(deleteStripeWebhookEvent('evt_missing')).resolves.toBeUndefined();
    expect(mockDeleteRow).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'processed_webhook_events',
      rowId: 'stripe:evt_missing',
    });
  });
});
