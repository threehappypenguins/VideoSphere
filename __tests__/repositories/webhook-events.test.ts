import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateRow, mockUpdateRow, mockDeleteRow } = vi.hoisted(() => ({
  mockCreateRow: vi.fn(),
  mockUpdateRow: vi.fn(),
  mockDeleteRow: vi.fn(),
}));

vi.mock('node-appwrite', () => ({
  TablesDB: class TablesDB {
    createRow = mockCreateRow;
    updateRow = mockUpdateRow;
    deleteRow = mockDeleteRow;
  },
}));

vi.mock('@/lib/appwrite', () => ({
  default: {},
}));

import {
  claimStripeWebhookEvent,
  deleteStripeWebhookEvent,
  markStripeWebhookEventCompleted,
  markStripeWebhookEventFailed,
} from '@/lib/repositories/webhook-events';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('webhook-events repository', () => {
  it('claims a new Stripe event by creating a deterministic row', async () => {
    mockCreateRow.mockResolvedValueOnce({});

    const result = await claimStripeWebhookEvent('evt_123', 'checkout.session.completed');

    expect(result).toEqual({ claimed: true, status: 'processing' });
    expect(mockCreateRow).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'processed_webhook_events',
      rowId: 'evt_123',
      data: expect.objectContaining({
        eventId: 'evt_123',
        provider: 'stripe',
        eventType: 'checkout.session.completed',
        status: 'processing',
        firstSeenAt: expect.any(String),
      }),
    });
  });

  it('treats row conflicts as duplicate events', async () => {
    mockCreateRow.mockRejectedValueOnce({ code: 409, type: 'row_already_exists' });

    const result = await claimStripeWebhookEvent('evt_duplicate', 'checkout.session.completed');

    expect(result).toEqual({ claimed: false });
  });

  it('marks a claimed event completed', async () => {
    mockUpdateRow.mockResolvedValueOnce({});

    await markStripeWebhookEventCompleted('evt_complete');

    expect(mockUpdateRow).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'processed_webhook_events',
      rowId: 'evt_complete',
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
      rowId: 'evt_failed',
      data: expect.objectContaining({
        status: 'failed',
        lastError: expect.any(String),
      }),
    });

    const payload = mockUpdateRow.mock.calls[0]?.[0]?.data as { lastError: string };
    expect(payload.lastError.length).toBeLessThanOrEqual(2000);
  });

  it('ignores delete requests for already removed rows', async () => {
    mockDeleteRow.mockRejectedValueOnce({ code: 404, type: 'row_not_found' });

    await expect(deleteStripeWebhookEvent('evt_missing')).resolves.toBeUndefined();
    expect(mockDeleteRow).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'processed_webhook_events',
      rowId: 'evt_missing',
    });
  });
});
