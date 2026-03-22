import { describe, it, expect } from 'vitest';
import { assertAppwriteRowTimestamps } from '@/lib/assert-appwrite-row-timestamps';

describe('assertAppwriteRowTimestamps', () => {
  it('returns timestamps when both are non-empty strings', () => {
    expect(
      assertAppwriteRowTimestamps({
        $createdAt: '2026-01-01T00:00:00.000Z',
        $updatedAt: '2026-01-02T00:00:00.000Z',
      })
    ).toEqual({
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('throws when either timestamp is missing or empty', () => {
    expect(() => assertAppwriteRowTimestamps({})).toThrow(/missing non-empty string/);
    expect(() =>
      assertAppwriteRowTimestamps({ $createdAt: '', $updatedAt: '2026-01-01T00:00:00.000Z' })
    ).toThrow(/missing non-empty string/);
    expect(() =>
      assertAppwriteRowTimestamps({ $createdAt: '2026-01-01T00:00:00.000Z', $updatedAt: '' })
    ).toThrow(/missing non-empty string/);
  });
});
