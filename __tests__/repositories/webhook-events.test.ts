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
    mockCreate.mockRejectedValueOnce(new Error('duplicate'));
    mockFindById.mockReturnValueOnce({
      lean: vi
        .fn()
        .mockResolvedValue({ status: 'completed', createdAt: new Date(), updatedAt: new Date() }),
    });

    const result = await claimStripeWebhookEvent('evt_1', 'checkout.session.completed');

    expect(result).toEqual({ claimed: false, status: 'completed' });
  });

  it('marks completed and failed statuses', async () => {
    mockUpdateOne.mockResolvedValue({});

    await markStripeWebhookEventCompleted('evt_2');
    await markStripeWebhookEventFailed('evt_2', 'oops');
    await markStripeWebhookEventBookkeepingFailed('evt_2', 'bookkeeping');
    await markStripeWebhookEventNonRetryableFailed('evt_2', 'non-retryable');

    expect(mockUpdateOne).toHaveBeenCalledTimes(4);
  });

  it('deletes webhook event by deterministic row id', async () => {
    mockDeleteOne.mockResolvedValue({ deletedCount: 1 });

    await deleteStripeWebhookEvent('evt_3');

    expect(mockDeleteOne).toHaveBeenCalled();
  });
});
