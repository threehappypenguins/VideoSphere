import { describe, expect, it } from 'vitest';
import { hashPasswordResetToken } from '@/lib/auth/password-reset-token-hash';

describe('hashPasswordResetToken', () => {
  it('returns a stable SHA-256 hex digest for the trimmed token', () => {
    const first = hashPasswordResetToken('  reset-token-value  ');
    const second = hashPasswordResetToken('reset-token-value');

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different digests for different tokens', () => {
    expect(hashPasswordResetToken('token-a')).not.toBe(hashPasswordResetToken('token-b'));
  });
});
