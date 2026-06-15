/**
 * Tests for lib/uploads/r2-availability.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockHeadObject = vi.fn();

vi.mock('@/lib/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/r2')>();
  return {
    ...actual,
    headObject: (...args: unknown[]) => mockHeadObject(...args),
  };
});

import { R2ObjectNotFoundError } from '@/lib/r2';
import {
  checkR2Availability,
  r2FileAvailableForRetryJob,
  resolveR2AvailabilityForKeys,
} from '@/lib/uploads/r2-availability';

describe('checkR2Availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caches successful HEAD results', async () => {
    mockHeadObject.mockResolvedValue(4096);
    const cache = new Map<string, boolean>();

    await expect(checkR2Availability('key-a', cache)).resolves.toBe(true);
    await expect(checkR2Availability('key-a', cache)).resolves.toBe(true);

    expect(mockHeadObject).toHaveBeenCalledTimes(1);
    expect(cache.get('key-a')).toBe(true);
  });

  it('caches missing-object results as false', async () => {
    mockHeadObject.mockRejectedValue(new R2ObjectNotFoundError('key-missing'));
    const cache = new Map<string, boolean>();

    await expect(checkR2Availability('key-missing', cache)).resolves.toBe(false);
    expect(cache.get('key-missing')).toBe(false);
  });
});

describe('resolveR2AvailabilityForKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dedupes keys before HEAD', async () => {
    mockHeadObject.mockResolvedValue(4096);

    const map = await resolveR2AvailabilityForKeys(['dup', 'dup', 'other']);

    expect(mockHeadObject).toHaveBeenCalledTimes(2);
    expect(map.get('dup')).toBe(true);
    expect(map.get('other')).toBe(true);
  });
});

describe('r2FileAvailableForRetryJob', () => {
  it('returns null when no HEAD was needed', () => {
    expect(r2FileAvailableForRetryJob(false, 'key', new Map([['key', true]]))).toBe(null);
  });

  it('returns false when HEAD was needed but key is absent', () => {
    expect(r2FileAvailableForRetryJob(true, null, new Map())).toBe(false);
  });

  it('returns map lookup when HEAD was needed and key is present', () => {
    expect(r2FileAvailableForRetryJob(true, 'key', new Map([['key', true]]))).toBe(true);
    expect(r2FileAvailableForRetryJob(true, 'key', new Map())).toBe(false);
  });
});
