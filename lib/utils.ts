// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================
// Place shared utility functions here. These are helper functions used across
// multiple components or pages.
//
// STUDENT: Add your own utility functions as your project grows.
// Examples: date formatting, string manipulation, validation helpers, etc.
// =============================================================================

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind CSS class names, resolving conflicts via tailwind-merge.
 * Accepts any value clsx accepts (strings, objects, arrays, falsy values).
 *
 * @example
 *   cn('px-4 py-2', isActive && 'bg-primary', className)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
