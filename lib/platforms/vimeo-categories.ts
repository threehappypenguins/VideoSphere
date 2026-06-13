/**
 * Client-safe Vimeo category types and label helpers.
 * Keep this module free of server-only imports (`next/server`, auth, DB, etc.)
 * so UI components can import it without pulling Node built-ins like `net`.
 */

/**
 * Top-level Vimeo category with optional nested subcategories from `GET /categories`.
 * @property uri - Category resource URI (e.g. `/categories/animation`).
 * @property name - Display name for the category.
 * @property subcategories - Child subcategories when returned by the API.
 */
export interface VimeoCategoryOption {
  uri: string;
  name: string;
  subcategories: Array<{ uri: string; name: string }>;
}

/**
 * Resolves a human-readable label for a stored category URI using fetched category rows.
 * @param uri - Stored category or subcategory URI.
 * @param categories - Category tree from the Vimeo categories API.
 * @returns Display label, or a slug-derived fallback when the URI is unknown.
 */
export function vimeoCategoryLabelForUri(uri: string, categories: VimeoCategoryOption[]): string {
  const trimmed = uri.trim();
  for (const category of categories) {
    if (category.uri === trimmed) {
      return category.name;
    }
    for (const subcategory of category.subcategories) {
      if (subcategory.uri === trimmed) {
        return `${category.name} › ${subcategory.name}`;
      }
    }
  }

  const subMatch = trimmed.match(/\/categories\/([^/]+)\/subcategories\/([^/?#]+)/i);
  if (subMatch) {
    return `${subMatch[1]} › ${subMatch[2]}`;
  }

  const topMatch = trimmed.match(/\/categories\/([^/?#]+)/i);
  if (topMatch) {
    return topMatch[1];
  }

  return trimmed;
}
