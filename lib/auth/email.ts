const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Returns whether a string matches a standard email address format.
 * @param email - Raw email input to validate.
 * @returns True when the trimmed value looks like a valid email address.
 */
export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed) return false;
  return EMAIL_FORMAT_RE.test(trimmed);
}

/**
 * Normalizes an email address for storage and comparison.
 * @param email - Raw email input.
 * @returns Trimmed, lowercased email string.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
