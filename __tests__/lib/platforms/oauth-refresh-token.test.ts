import { describe, expect, it } from 'vitest';
import { coalesceOAuthRefreshToken } from '@/lib/platforms/oauth-refresh-token';

describe('coalesceOAuthRefreshToken', () => {
  it('returns the first non-empty trimmed candidate', () => {
    expect(coalesceOAuthRefreshToken('', '  kept  ', 'other')).toBe('kept');
  });

  it('treats null and undefined like empty', () => {
    expect(coalesceOAuthRefreshToken(null, undefined, 'token')).toBe('token');
  });

  it('returns empty string when no usable candidate exists', () => {
    expect(coalesceOAuthRefreshToken('', '   ', null, undefined)).toBe('');
  });
});
