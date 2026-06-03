'use strict';

/** Minimum password length enforced by registration and password reset flows. */
const MIN_PASSWORD_LENGTH = 8;

/** Minimum {@link scorePasswordStrength} required for password set/reset flows. */
const MIN_PASSWORD_STRENGTH_SCORE = 3;

const COMMON_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  'password',
  'password1',
  'password12',
  'password123',
  'qwerty123',
  'admin123',
  'letmein1',
  'welcome1',
  'iloveyou',
]);

/** Message shown when password reset is requested for a Google OAuth-only account. */
const OAUTH_PASSWORD_RESET_MESSAGE =
  'This account uses Google sign-in and does not have a password to reset.';

/**
 * Scores password strength on a 0–5 scale using the same rules as the signup strength meter.
 * @param {string} password - Plaintext password to score.
 * @returns {number} Strength score from 0 (empty) through 5 (very strong).
 */
function scorePasswordStrength(password) {
  if (!password) return 0;

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return score;
}

/**
 * Validates a candidate password against application requirements.
 * @param {string} password - Plaintext password to validate.
 * @returns {string | null} An error message when invalid; otherwise null.
 */
function validatePassword(password) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'Password is too common. Choose a stronger password.';
  }

  if (scorePasswordStrength(password) < MIN_PASSWORD_STRENGTH_SCORE) {
    return 'Password is too weak. Use a mix of letters, numbers, and symbols.';
  }

  return null;
}

/**
 * Returns whether an account can use password-based login or admin password reset flows.
 * Eligibility is determined solely by `authProvider`; `passwordHash` is not consulted.
 * @param {{ authProvider?: string }} profile - User auth fields (`authProvider` from `user_profiles`).
 * @returns {boolean} True when `authProvider` is `'password'`; false for `'google'` or missing.
 */
function userSupportsPasswordReset(profile) {
  return profile.authProvider === 'password';
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  MIN_PASSWORD_STRENGTH_SCORE,
  OAUTH_PASSWORD_RESET_MESSAGE,
  scorePasswordStrength,
  validatePassword,
  userSupportsPasswordReset,
};
