import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockConnectToDatabase,
  mockCreate,
  mockFindById,
  mockFindOneAndUpdate,
  mockUpdateOne,
  mockDeleteOne,
} = vi.hoisted(() => ({
  mockConnectToDatabase: vi.fn(),
  mockCreate: vi.fn(),
  mockFindById: vi.fn(),
  mockFindOneAndUpdate: vi.fn(),
  mockUpdateOne: vi.fn(),
  mockDeleteOne: vi.fn(),
}));

vi.mock('@/lib/mongodb', () => ({
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
}));

vi.mock('@/lib/models/ProcessedWebhookEvent', () => ({
  ProcessedWebhookEventModel: {
    create: (...args: unknown[]) => mockCreate(...args),
    findById: (...args: unknown[]) => mockFindById(...args),
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
    updateOne: (...args: unknown[]) => mockUpdateOne(...args),
    deleteOne: (...args: unknown[]) => mockDeleteOne(...args),
  },
}));

import {
  claimStripeWebhookEvent,
  deleteStripeWebhookEvent,
  markStripeWebhookEventBookkeepingFailed,
  markStripeWebhookEventCompleted,
  markStripeWebhookEventFailed,
  markStripeWebhookEventNonRetryableFailed,
} from '@/lib/repositories/webhook-events';

beforeEach(() => {
  vi.clearAllMocks();
  mockConnectToDatabase.mockResolvedValue(undefined);
  mockFindOneAndUpdate.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'x' }) });
});

describe('webhook-events repository (mongo)', () => {
  it('claims a new event on first write', async () => {
    mockCreate.mockResolvedValueOnce({});

    const result = await claimStripeWebhookEvent('evt_1', 'checkout.session.completed');

    expect(result).toEqual({ claimed: true, status: 'processing' });
    expect(mockCreate).toHaveBeenCalled();
  });

  it('returns duplicate completed state when claim conflicts and existing row is terminal', async () => {
    mockCreate.mockRejectedValueOnce({ code: 11000 });
    mockFindById.mockReturnValueOnce({
      lean: vi
        .fn()
        .mockResolvedValue({ status: 'completed', createdAt: new Date(), updatedAt: new Date() }),
    });

    const result = await claimStripeWebhookEvent('evt_1', 'checkout.session.completed');

    expect(result).toEqual({ claimed: false, status: 'completed' });
  });

  it('rethrows non-duplicate create failures during claim', async () => {
    mockCreate.mockRejectedValueOnce(Object.assign(new Error('db down'), { code: 91 }));

    await expect(claimStripeWebhookEvent('evt_1', 'checkout.session.completed')).rejects.toThrow(
      'db down'
    );
  });

  it('reclaims stale processing events through compare-and-swap update', async () => {
    const staleTime = new Date(Date.now() - 11 * 60 * 1000);
    mockCreate.mockRejectedValueOnce({ code: 11000 });
    mockFindById
      .mockReturnValueOnce({
        lean: vi
          .fn()
          .mockResolvedValue({ status: 'processing', createdAt: staleTime, updatedAt: staleTime }),
      })
      .mockReturnValueOnce({
        lean: vi
          .fn()
          .mockResolvedValue({ status: 'processing', createdAt: staleTime, updatedAt: staleTime }),
      });

    const result = await claimStripeWebhookEvent('evt_stale', 'checkout.session.completed');

    expect(result).toEqual({ claimed: true, status: 'processing' });
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'processing', updatedAt: staleTime }),
      expect.objectContaining({ status: 'processing', eventId: 'evt_stale', lastError: '' }),
      { returnDocument: 'after' }
    );
  });

  it('reclaims retryable failed events through compare-and-swap update', async () => {
    const now = new Date();
    mockCreate.mockRejectedValueOnce({ code: 11000 });
    mockFindById
      .mockReturnValueOnce({
        lean: vi.fn().mockResolvedValue({ status: 'failed', createdAt: now, updatedAt: now }),
      })
      .mockReturnValueOnce({
        lean: vi.fn().mockResolvedValue({ status: 'failed', createdAt: now, updatedAt: now }),
      });

    const result = await claimStripeWebhookEvent('evt_failed', 'checkout.session.completed');

    expect(result).toEqual({ claimed: true, status: 'processing' });
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', updatedAt: now }),
      expect.objectContaining({ status: 'processing', eventId: 'evt_failed', lastError: '' }),
      { returnDocument: 'after' }
    );
  });

  it('returns unclaimed when reclaim compare-and-swap misses and another worker wins', async () => {
    const now = new Date();
    mockCreate.mockRejectedValueOnce({ code: 11000 }).mockRejectedValueOnce({ code: 11000 });
    mockFindById
      .mockReturnValueOnce({
        lean: vi.fn().mockResolvedValue({ status: 'failed', createdAt: now, updatedAt: now }),
      })
      .mockReturnValueOnce({
        lean: vi.fn().mockResolvedValue({ status: 'failed', createdAt: now, updatedAt: now }),
      })
      .mockReturnValueOnce({
        lean: vi.fn().mockResolvedValue({ status: 'processing', createdAt: now, updatedAt: now }),
      });
    mockFindOneAndUpdate.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(null) });

    const result = await claimStripeWebhookEvent('evt_cas_miss', 'checkout.session.completed');

    expect(result).toEqual({ claimed: false, status: 'processing' });
    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('marks completed and failed statuses', async () => {
    mockUpdateOne.mockResolvedValue({ matchedCount: 1 });

    await markStripeWebhookEventCompleted('evt_2');
    await markStripeWebhookEventFailed('evt_2', 'oops');
    await markStripeWebhookEventBookkeepingFailed('evt_2', 'bookkeeping');
    await markStripeWebhookEventNonRetryableFailed('evt_2', 'non-retryable');

    expect(mockUpdateOne).toHaveBeenCalledTimes(4);
  });

  it('throws when trying to mark terminal status for a missing event row', async () => {
    mockUpdateOne.mockResolvedValue({ matchedCount: 0 });

    await expect(markStripeWebhookEventCompleted('evt_missing')).rejects.toThrow(
      'Processed webhook event not found'
    );
  });

  it('deletes webhook event by deterministic row id', async () => {
    mockDeleteOne.mockResolvedValue({ deletedCount: 1 });

    await deleteStripeWebhookEvent('evt_3');

    expect(mockDeleteOne).toHaveBeenCalled();
  });
});
