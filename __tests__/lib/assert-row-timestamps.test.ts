import { describe, it, expect } from 'vitest';
import { assertRowTimestamps } from '@/lib/assert-row-timestamps';

describe('assertRowTimestamps', () => {
  it('returns timestamps when both are non-empty strings', () => {
    expect(
      assertRowTimestamps({
        $createdAt: '2026-01-01T00:00:00.000Z',
        $updatedAt: '2026-01-02T00:00:00.000Z',
      })
    ).toEqual({
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('throws when either timestamp is missing or empty', () => {
    expect(() => assertRowTimestamps({})).toThrow(/missing non-empty string/);
    expect(() =>
      assertRowTimestamps({ $createdAt: '', $updatedAt: '2026-01-01T00:00:00.000Z' })
    ).toThrow(/missing non-empty string/);
    expect(() =>
      assertRowTimestamps({ $createdAt: '2026-01-01T00:00:00.000Z', $updatedAt: '' })
    ).toThrow(/missing non-empty string/);
  });
});
