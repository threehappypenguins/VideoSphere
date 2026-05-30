import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnectToDatabase, mockFindById, mockUpdateOne, mockAggregate } = vi.hoisted(() => ({
  mockConnectToDatabase: vi.fn(),
  mockFindById: vi.fn(),
  mockUpdateOne: vi.fn(),
  mockAggregate: vi.fn(),
}));

vi.mock('@/lib/mongodb', () => ({
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
}));

vi.mock('@/lib/models/UploadUsage', () => ({
  UploadUsageModel: {
    findById: (...args: unknown[]) => mockFindById(...args),
    updateOne: (...args: unknown[]) => mockUpdateOne(...args),
    aggregate: (...args: unknown[]) => mockAggregate(...args),
  },
}));

import {
  canUpload,
  decrementUsage,
  getMonthlyUsage,
  getTotalUploadsForMonth,
  incrementUsage,
  incrementUsageIfAllowed,
  usageMonthFromUtcIso,
} from '@/lib/repositories/upload-usage';

beforeEach(() => {
  vi.clearAllMocks();
  mockConnectToDatabase.mockResolvedValue(undefined);
});

describe('upload-usage repository (mongo)', () => {
  it('reads monthly usage and returns 0 for missing row', async () => {
    mockFindById.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue({ uploadCount: 5 }) });
    expect(await getMonthlyUsage('user-1', '2026-01')).toBe(5);

    mockFindById.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(null) });
    expect(await getMonthlyUsage('user-1', '2026-01')).toBe(0);
  });

  it('increments and decrements usage via updateOne', async () => {
    mockUpdateOne.mockResolvedValue({});

    await incrementUsage('user-1', '2026-01');
    await decrementUsage('user-1', '2026-01');

    expect(mockUpdateOne).toHaveBeenCalledTimes(2);
    expect(mockUpdateOne).toHaveBeenNthCalledWith(
      2,
      { _id: 'user-1_2026-01' },
      [
        {
          $set: {
            _id: 'user-1_2026-01',
            userId: { $ifNull: ['$userId', 'user-1'] },
            month: { $ifNull: ['$month', '2026-01'] },
            uploadCount: {
              $max: [0, { $subtract: [{ $ifNull: ['$uploadCount', 0] }, 1] }],
            },
          },
        },
      ],
      { upsert: true }
    );
  });

  it('checks upload allowance and atomic claim behavior', async () => {
    mockFindById.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue({ uploadCount: 9 }) });
    expect(await canUpload('user-1', false)).toBe(true);

    mockFindById.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue({ uploadCount: 10 }) });
    expect(await canUpload('user-1', false)).toBe(false);

    mockUpdateOne.mockResolvedValue({});
    mockFindById.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue({ uploadCount: 3 }) });
    const claim = await incrementUsageIfAllowed('user-1', false, 10);
    expect(claim.allowed).toBe(true);
  });

  it('aggregates monthly totals and parses usage month from timestamp', async () => {
    mockAggregate.mockResolvedValueOnce([{ total: 42 }]);
    expect(await getTotalUploadsForMonth('2026-01')).toBe(42);
    expect(usageMonthFromUtcIso('2026-02-01T00:00:00.000Z')).toBe('2026-02');
  });
});
