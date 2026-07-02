import { describe, it, expect } from 'vitest';
import { isOAuthRefreshTokenRevokedError } from '@/lib/platforms/oauth-refresh-errors';

describe('isOAuthRefreshTokenRevokedError', () => {
  it('returns true for invalid_grant details', () => {
    expect(
      isOAuthRefreshTokenRevokedError('invalid_grant: Token has been expired or revoked.')
    ).toBe(true);
  });

  it('returns true for revoked token messages without invalid_grant prefix', () => {
    expect(isOAuthRefreshTokenRevokedError('Token has been revoked')).toBe(true);
  });

  it('returns false for unrelated OAuth errors', () => {
    expect(isOAuthRefreshTokenRevokedError('invalid_client: Unauthorized')).toBe(false);
  });
});
