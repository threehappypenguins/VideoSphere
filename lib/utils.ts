// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================
// Place shared utility functions here. These are helper functions used across
// multiple components or pages.
//
// STUDENT: Add your own utility functions as your project grows.
// Examples: date formatting, string manipulation, validation helpers, etc.
// =============================================================================

/**
 * Concatenates CSS class names, filtering out falsy values.
 * Useful for conditionally applying Tailwind classes.
 *
 * @example
 *   cn('px-4 py-2', isActive && 'bg-primary', className)
 */
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
