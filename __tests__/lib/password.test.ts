import { describe, expect, it } from 'vitest';
import {
  scorePasswordStrength,
  userSupportsPasswordReset,
  validatePassword,
} from '@/lib/auth/password';

describe('validatePassword', () => {
  it('rejects passwords shorter than 8 characters', () => {
    expect(validatePassword('short')).toBe('Password must be at least 8 characters.');
  });

  it('rejects common passwords', () => {
    expect(validatePassword('password')).toBe(
      'Password is too common. Choose a stronger password.'
    );
  });

  it('rejects weak passwords that only meet minimum length', () => {
    expect(validatePassword('aaaaaaaa')).toBe(
      'Password is too weak. Use a mix of letters, numbers, and symbols.'
    );
  });

  it('accepts a strong password', () => {
    expect(validatePassword('Abcdefg1!')).toBeNull();
  });
});

describe('scorePasswordStrength', () => {
  it('scores a balanced password as good or better', () => {
    expect(scorePasswordStrength('Abcdefg1!')).toBeGreaterThanOrEqual(3);
  });
});

describe('userSupportsPasswordReset', () => {
  it('returns false for Google OAuth-only accounts', () => {
    expect(userSupportsPasswordReset({ authProvider: 'google' })).toBe(false);
  });

  it('returns true when a password hash exists', () => {
    expect(
      userSupportsPasswordReset({ authProvider: 'google', passwordHash: 'hashed-value' })
    ).toBe(true);
  });

  it('returns true for password auth provider without hash yet', () => {
    expect(userSupportsPasswordReset({ authProvider: 'password' })).toBe(true);
  });
});
