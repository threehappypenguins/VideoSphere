import type { UserAuthProvider } from '@/types';
import passwordPolicy from './password-policy.cjs';

/** Minimum password length enforced by registration and password reset flows. */
export const MIN_PASSWORD_LENGTH = passwordPolicy.MIN_PASSWORD_LENGTH;

/** Minimum {@link scorePasswordStrength} required for password set/reset flows. */
export const MIN_PASSWORD_STRENGTH_SCORE = passwordPolicy.MIN_PASSWORD_STRENGTH_SCORE;

/** Message shown when password reset is requested for a Google OAuth-only account. */
export const OAUTH_PASSWORD_RESET_MESSAGE = passwordPolicy.OAUTH_PASSWORD_RESET_MESSAGE;

/**
 * Scores password strength on a 0–5 scale using the same rules as the signup strength meter.
 * @param password - Plaintext password to score.
 * @returns Strength score from 0 (empty) through 5 (very strong).
 */
export function scorePasswordStrength(password: string): number {
  return passwordPolicy.scorePasswordStrength(password);
}

/**
 * Validates a candidate password against application requirements.
 * @param password - Plaintext password to validate.
 * @returns An error message when invalid; otherwise null.
 */
export function validatePassword(password: string): string | null {
  return passwordPolicy.validatePassword(password);
}

/**
 * Returns whether an account can use password-based login or admin password reset flows.
 * Eligibility is determined solely by `authProvider`; `passwordHash` is not consulted.
 * @param profile - User auth fields from `user_profiles` (`authProvider` only).
 * @returns True when `authProvider` is `'password'`; false for `'google'` or missing.
 */
export function userSupportsPasswordReset(profile: { authProvider?: UserAuthProvider }): boolean {
  return passwordPolicy.userSupportsPasswordReset(profile);
}
