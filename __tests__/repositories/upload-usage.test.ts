// =============================================================================
// UPLOAD USAGE REPOSITORY UNIT TESTS
// =============================================================================
// Tests for getMonthlyUsage, incrementUsage, and canUpload. Mocks
// node-appwrite TablesDB so we don't hit a real Appwrite instance.
// Pins Date to 2026-03-11 UTC so row IDs and month strings are deterministic.
// =============================================================================

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';

const FIXED_DATE = new Date('2026-03-11T12:00:00.000Z');
const FIXED_MONTH = '2026-03';

const { mockCreateRow, mockGetRow, mockIncrementRowColumn } = vi.hoisted(() => ({
  mockCreateRow: vi.fn(),
  mockGetRow: vi.fn(),
  mockIncrementRowColumn: vi.fn(),
}));

vi.mock('node-appwrite', () => ({
  TablesDB: class TablesDB {
    createRow = mockCreateRow;
    getRow = mockGetRow;
    incrementRowColumn = mockIncrementRowColumn;
  },
}));

vi.mock('@/lib/appwrite', () => ({
  default: {},
}));

import {
  getMonthlyUsage,
  incrementUsage,
  decrementUsage,
  canUpload,
  incrementUsageIfAllowed,
} from '@/lib/repositories/upload-usage';

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_DATE);
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getMonthlyUsage
// ---------------------------------------------------------------------------

describe('getMonthlyUsage', () => {
  it('returns uploadCount from the current-month row when it exists', async () => {
    mockGetRow.mockResolvedValue({
      $id: 'user-1_2026-03',
      userId: 'user-1',
      month: FIXED_MONTH,
      uploadCount: 5,
    });

    const count = await getMonthlyUsage('user-1');

    expect(mockGetRow).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'upload_usage',
      rowId: `user-1_${FIXED_MONTH}`,
    });
    expect(count).toBe(5);
  });

  it('returns 0 when no record exists for the current month (404)', async () => {
    mockGetRow.mockRejectedValue({ code: 404 });

    const count = await getMonthlyUsage('user-1');

    expect(count).toBe(0);
  });

  it('returns 0 when uploadCount is missing from the row', async () => {
    mockGetRow.mockResolvedValue({ $id: 'user-1_2026-03', userId: 'user-1', month: FIXED_MONTH });

    const count = await getMonthlyUsage('user-1');

    expect(count).toBe(0);
  });

  it('rethrows non-404 errors', async () => {
    mockGetRow.mockRejectedValue({ code: 500, message: 'Internal Server Error' });

    await expect(getMonthlyUsage('user-1')).rejects.toMatchObject({ code: 500 });
  });
});

// ---------------------------------------------------------------------------
// incrementUsage
// ---------------------------------------------------------------------------

describe('incrementUsage', () => {
  it('atomically increments uploadCount when a record already exists', async () => {
    mockIncrementRowColumn.mockResolvedValue({});

    await incrementUsage('user-1');

    expect(mockIncrementRowColumn).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'upload_usage',
      rowId: `user-1_${FIXED_MONTH}`,
      column: 'uploadCount',
      value: 1,
    });
    expect(mockCreateRow).not.toHaveBeenCalled();
  });

  it('creates a record with uploadCount 1 when none exists (404)', async () => {
    mockIncrementRowColumn.mockRejectedValue({ code: 404 });
    mockCreateRow.mockResolvedValue({});

    await incrementUsage('user-1');

    expect(mockCreateRow).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'upload_usage',
      rowId: `user-1_${FIXED_MONTH}`,
      data: { userId: 'user-1', month: FIXED_MONTH, uploadCount: 1 },
    });
  });

  it('falls back to atomic increment on 409 (concurrent row creation race)', async () => {
    mockIncrementRowColumn
      .mockRejectedValueOnce({ code: 404 }) // first call: row not found
      .mockResolvedValueOnce({}); // second call: atomic increment succeeds
    mockCreateRow.mockRejectedValue({ code: 409 }); // concurrent request already created it

    await incrementUsage('user-1');

    expect(mockIncrementRowColumn).toHaveBeenCalledTimes(2);
    expect(mockCreateRow).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-404 errors from incrementRowColumn', async () => {
    mockIncrementRowColumn.mockRejectedValue({ code: 503, message: 'Service Unavailable' });

    await expect(incrementUsage('user-1')).rejects.toMatchObject({ code: 503 });
    expect(mockCreateRow).not.toHaveBeenCalled();
  });

  it('rethrows non-409 errors from createRow', async () => {
    mockIncrementRowColumn.mockRejectedValue({ code: 404 });
    mockCreateRow.mockRejectedValue({ code: 500, message: 'Internal error' });

    await expect(incrementUsage('user-1')).rejects.toMatchObject({ code: 500 });
  });
});

// ---------------------------------------------------------------------------
// decrementUsage
// ---------------------------------------------------------------------------

describe('decrementUsage', () => {
  it('atomically decrements uploadCount by 1', async () => {
    mockIncrementRowColumn.mockResolvedValue({});

    await decrementUsage('user-1');

    expect(mockIncrementRowColumn).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'upload_usage',
      rowId: `user-1_${FIXED_MONTH}`,
      column: 'uploadCount',
      value: -1,
    });
  });

  it('rethrows errors from incrementRowColumn', async () => {
    mockIncrementRowColumn.mockRejectedValue({ code: 500, message: 'DB error' });

    await expect(decrementUsage('user-1')).rejects.toMatchObject({ code: 500 });
  });
});

// ---------------------------------------------------------------------------
// canUpload
// ---------------------------------------------------------------------------

describe('canUpload', () => {
  it('returns true for a supporter without checking usage', async () => {
    const result = await canUpload('user-1', true);

    expect(result).toBe(true);
    expect(mockGetRow).not.toHaveBeenCalled();
  });

  it('returns true for a free user with 0 uploads this month', async () => {
    mockGetRow.mockRejectedValue({ code: 404 });

    const result = await canUpload('user-1', false);

    expect(result).toBe(true);
  });

  it('returns true for a free user with 9 uploads (below the 10-upload limit)', async () => {
    mockGetRow.mockResolvedValue({ uploadCount: 9 });

    const result = await canUpload('user-1', false);

    expect(result).toBe(true);
  });

  it('returns false for a free user who has hit exactly 10 uploads', async () => {
    mockGetRow.mockResolvedValue({ uploadCount: 10 });

    const result = await canUpload('user-1', false);

    expect(result).toBe(false);
  });

  it('returns false for a free user who has exceeded the 10-upload limit', async () => {
    mockGetRow.mockResolvedValue({ uploadCount: 14 });

    const result = await canUpload('user-1', false);

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// incrementUsageIfAllowed
// ---------------------------------------------------------------------------

describe('incrementUsageIfAllowed', () => {
  it('returns { allowed: true } for a supporter without touching the counter', async () => {
    const result = await incrementUsageIfAllowed('user-1', true);

    expect(result).toEqual({ allowed: true, monthlyUsage: 0 });
    expect(mockIncrementRowColumn).not.toHaveBeenCalled();
    expect(mockGetRow).not.toHaveBeenCalled();
  });

  it('returns { allowed: true } when count after increment is within the limit', async () => {
    // incrementUsage path: incrementRowColumn succeeds
    mockIncrementRowColumn.mockResolvedValueOnce({});
    // getMonthlyUsage read-back: count is 5 (within limit of 10)
    mockGetRow.mockResolvedValueOnce({ uploadCount: 5 });

    const result = await incrementUsageIfAllowed('user-1', false);

    expect(result).toEqual({ allowed: true, monthlyUsage: 5 });
    // Only one incrementRowColumn call (no rollback)
    expect(mockIncrementRowColumn).toHaveBeenCalledTimes(1);
    expect(mockIncrementRowColumn).toHaveBeenCalledWith(
      expect.objectContaining({ column: 'uploadCount', value: 1 })
    );
  });

  it('rolls back and returns { allowed: false } when count exceeds the limit', async () => {
    // incrementUsage path: incrementRowColumn succeeds
    mockIncrementRowColumn.mockResolvedValue({});
    // getMonthlyUsage read-back: count is 11 (over limit of 10)
    mockGetRow.mockResolvedValueOnce({ uploadCount: 11 });

    const result = await incrementUsageIfAllowed('user-1', false);

    expect(result).toEqual({ allowed: false, monthlyUsage: 10 });
    // Two incrementRowColumn calls: +1 (claim) and -1 (rollback)
    expect(mockIncrementRowColumn).toHaveBeenCalledTimes(2);
    expect(mockIncrementRowColumn).toHaveBeenLastCalledWith(
      expect.objectContaining({ column: 'uploadCount', value: -1 })
    );
  });

  it('returns { allowed: true } when count equals the limit exactly', async () => {
    mockIncrementRowColumn.mockResolvedValueOnce({});
    // count = 10, limit = 10: still allowed (10 ≤ 10)
    mockGetRow.mockResolvedValueOnce({ uploadCount: 10 });

    const result = await incrementUsageIfAllowed('user-1', false);

    expect(result).toEqual({ allowed: true, monthlyUsage: 10 });
    expect(mockIncrementRowColumn).toHaveBeenCalledTimes(1);
  });

  it('throws when the over-cap rollback decrement fails', async () => {
    // incrementUsage path: claim succeeds
    mockIncrementRowColumn
      .mockResolvedValueOnce({}) // +1 claim
      .mockRejectedValueOnce({ code: 503, message: 'Service unavailable' }); // -1 rollback fails
    // getMonthlyUsage read-back: over limit
    mockGetRow.mockResolvedValueOnce({ uploadCount: 11 });

    await expect(incrementUsageIfAllowed('user-1', false)).rejects.toThrow(
      /Quota slot rollback failed/
    );
  });

  it('logs an error when the over-cap rollback decrement fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockIncrementRowColumn
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('DB unavailable'));
    mockGetRow.mockResolvedValueOnce({ uploadCount: 11 });

    await expect(incrementUsageIfAllowed('user-1', false)).rejects.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('roll back over-cap quota slot'),
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  it('respects a custom limit', async () => {
    mockIncrementRowColumn.mockResolvedValue({});
    // count = 6, limit = 5: over custom limit
    mockGetRow.mockResolvedValueOnce({ uploadCount: 6 });

    const result = await incrementUsageIfAllowed('user-1', false, 5);

    expect(result).toEqual({ allowed: false, monthlyUsage: 5 });
    expect(mockIncrementRowColumn).toHaveBeenCalledTimes(2);
  });
});
