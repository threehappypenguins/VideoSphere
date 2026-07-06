/** Frosted scrim shared by auth feedback text for readability over the film-texture background. */
export const AUTH_FEEDBACK_SCRIM_CLASS =
  'inline-block rounded-md bg-background/90 px-2 py-1 shadow-sm ring-1 ring-border/60 backdrop-blur-sm';

/**
 * Tailwind classes for inline auth links so they stay readable over the film-texture background.
 */
export const AUTH_INLINE_LINK_CLASS = `${AUTH_FEEDBACK_SCRIM_CLASS} text-sm font-medium text-primary transition-colors hover:bg-background hover:text-primary/90`;

/** Field-level validation errors on auth forms. */
export const AUTH_FIELD_ERROR_CLASS = `${AUTH_FEEDBACK_SCRIM_CLASS} text-xs font-medium text-destructive`;

/** Form-level error banners on auth pages. */
export const AUTH_FORM_ERROR_CLASS = `${AUTH_FEEDBACK_SCRIM_CLASS} mt-6 text-sm font-medium text-destructive`;

/** Form-level success banners on auth pages. */
export const AUTH_FORM_SUCCESS_CLASS = `${AUTH_FEEDBACK_SCRIM_CLASS} mt-6 text-sm font-medium text-green-600 dark:text-green-400`;

/** Larger confirmation or status panels on auth pages. */
export const AUTH_NOTICE_PANEL_CLASS =
  'rounded-lg border border-border bg-background/90 p-4 text-sm text-foreground shadow-sm ring-1 ring-border/60 backdrop-blur-sm';

const PASSWORD_STRENGTH_LABEL_TONE = [
  '',
  'text-destructive',
  'text-muted-foreground',
  'text-foreground',
  'text-primary',
  'text-primary',
] as const;

/**
 * Returns Tailwind classes for a password strength label with a readable frosted scrim.
 * @param score - Password strength score from {@link lib/auth/password!scorePasswordStrength}.
 * @returns Class string for the strength label element.
 */
export function authPasswordStrengthLabelClass(score: number): string {
  const tone = PASSWORD_STRENGTH_LABEL_TONE[score] ?? 'text-foreground';
  return `${AUTH_FEEDBACK_SCRIM_CLASS} text-xs font-medium ${tone}`;
}
