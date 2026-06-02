import type { UserAuthProvider } from '@/lib/models/UserProfile';

/** Minimum password length enforced by registration and password reset flows. */
export { MIN_PASSWORD_LENGTH } from './password-policy.cjs';

/** Minimum {@link scorePasswordStrength} required for password set/reset flows. */
export { MIN_PASSWORD_STRENGTH_SCORE } from './password-policy.cjs';

/** Message shown when password reset is requested for a Google OAuth-only account. */
export { OAUTH_PASSWORD_RESET_MESSAGE } from './password-policy.cjs';

/**
 * Scores password strength on a 0–5 scale using the same rules as the signup strength meter.
 * @param password - Plaintext password to score.
 * @returns Strength score from 0 (empty) through 5 (very strong).
 */
export { scorePasswordStrength } from './password-policy.cjs';

/**
 * Validates a candidate password against application requirements.
 * @param password - Plaintext password to validate.
 * @returns An error message when invalid; otherwise null.
 */
export { validatePassword } from './password-policy.cjs';

import { userSupportsPasswordReset as userSupportsPasswordResetImpl } from './password-policy.cjs';

/**
 * Returns whether an account can use password-based login or password reset flows.
 * @param profile - User auth fields from `user_profiles`.
 * @returns True when the account has or supports a local password.
 */
export function userSupportsPasswordReset(profile: {
  passwordHash?: string;
  authProvider?: UserAuthProvider;
}): boolean {
  return userSupportsPasswordResetImpl(profile);
}
