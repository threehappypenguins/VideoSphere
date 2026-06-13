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
 * @property mayHaveSubcategories - True when the category has one or more subcategories to expand.
 */
export interface VimeoCategoryOption {
  uri: string;
  name: string;
  subcategories: Array<{ uri: string; name: string }>;
  mayHaveSubcategories?: boolean;
}

/** Maximum category and subcategory entries Vimeo accepts on `PUT /videos/{id}/categories`. */
export const VIMEO_MAX_VIDEO_CATEGORY_BATCH_ENTRIES = 6;

/**
 * Parses a stored category URI or slug into Vimeo batch slug entries.
 * Subcategory URIs expand to both the parent category slug and the subcategory slug.
 * @param categoryUriOrSlug - Stored URI, path, URL, or bare slug from draft metadata.
 * @returns Slugs for the Vimeo categories batch body, or null when unparseable.
 */
export function parseVimeoCategorySlugs(categoryUriOrSlug: string): string[] | null {
  const s = categoryUriOrSlug.trim();
  if (!s) return null;

  const sub = s.match(/\/categories\/([^/]+)\/subcategories\/([^/?#]+)/i);
  if (sub) return [sub[1], sub[2]];

  const shortSub = s.match(/\/categories\/([^/]+)\/([^/?#]+)/i);
  if (shortSub) return [shortSub[1], shortSub[2]];

  const top = s.match(/\/categories\/([^/?#]+)/i);
  if (top) return [top[1]];

  try {
    const path = new URL(s).pathname;
    const subU = path.match(/\/categories\/([^/]+)\/subcategories\/([^/?#]+)/i);
    if (subU) return [subU[1], subU[2]];
    const shortSubU = path.match(/\/categories\/([^/]+)\/([^/?#]+)/i);
    if (shortSubU) return [shortSubU[1], shortSubU[2]];
    const topU = path.match(/\/categories\/([^/?#]+)/i);
    if (topU) return [topU[1]];
  } catch {
    /* not an absolute URL */
  }

  if (!s.includes('/') && !s.toLowerCase().startsWith('http')) {
    return [s];
  }

  return null;
}

/**
 * Builds the deduplicated Vimeo category slug list used for upload batch validation.
 * @param categoryUris - Stored top-level or subcategory URIs from draft metadata.
 * @returns Unique slugs in first-seen order.
 */
export function buildVimeoCategoryBatchSlugsFromUris(categoryUris: readonly string[]): string[] {
  const seen = new Set<string>();
  const slugs: string[] = [];

  for (const categoryUri of categoryUris) {
    const parsed = parseVimeoCategorySlugs(categoryUri);
    if (!parsed?.length) continue;
    for (const slug of parsed) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      slugs.push(slug);
    }
  }

  return slugs;
}

/**
 * Counts how many Vimeo category batch entries the stored URIs would send on upload.
 * @param categoryUris - Stored top-level or subcategory URIs from draft metadata.
 * @returns Number of unique category/subcategory slugs Vimeo would receive.
 */
export function countVimeoCategoryBatchEntries(categoryUris: readonly string[]): number {
  return buildVimeoCategoryBatchSlugsFromUris(categoryUris).length;
}

/**
 * Returns whether adding a category URI would exceed Vimeo's upload batch limit.
 * @param currentUris - Currently selected category URIs.
 * @param uriToAdd - Category or subcategory URI the user is trying to add.
 * @returns True when the resulting batch would exceed {@link VIMEO_MAX_VIDEO_CATEGORY_BATCH_ENTRIES}.
 */
export function wouldAddingVimeoCategoryExceedLimit(
  currentUris: readonly string[],
  uriToAdd: string,
  categories: readonly VimeoCategoryOption[] = []
): boolean {
  const trimmed = uriToAdd.trim();
  if (!trimmed || currentUris.includes(trimmed)) {
    return false;
  }
  return (
    countVimeoCategoryBatchEntries(addVimeoCategoryUri(currentUris, trimmed, categories)) >
    VIMEO_MAX_VIDEO_CATEGORY_BATCH_ENTRIES
  );
}

/**
 * Returns whether a URI uses Vimeo's API subcategory path segment.
 * Use this when classifying rows from `GET /categories`, not for stored draft URIs.
 * @param uri - Category or subcategory URI from the Vimeo API.
 * @returns True when the URI includes `/subcategories/` after the parent slug.
 */
export function isVimeoApiSubcategoryPathUri(uri: string): boolean {
  return /\/categories\/[^/]+\/subcategories\//i.test(uri.trim());
}

/**
 * Resolves the parent category URI from an API subcategory path URI.
 * @param uri - Subcategory URI containing `/subcategories/` from the Vimeo API.
 * @returns Parent category URI, or null when the URI is not an API subcategory path.
 */
export function vimeoParentCategoryUriFromApiSubcategoryPath(uri: string): string | null {
  const match = uri.trim().match(/^\/categories\/([^/]+)\/subcategories\//i);
  return match ? `/categories/${match[1]}` : null;
}

/**
 * Returns whether a stored URI points at a Vimeo subcategory resource.
 * Includes short-form upload URIs (`/categories/parent/child`) used outside tree building.
 * @param uri - Stored category or subcategory URI.
 * @returns True when the URI represents a subcategory selection.
 */
export function isVimeoSubcategoryUri(uri: string): boolean {
  const trimmed = uri.trim();
  if (/\/subcategories\//i.test(trimmed)) {
    return true;
  }
  return /^\/categories\/[^/]+\/[^/?#]+/.test(trimmed);
}

/**
 * Resolves the parent category URI for a subcategory URI.
 * @param uri - Subcategory URI from draft metadata or the Vimeo API.
 * @param categories - Optional category tree for lookup when URI parsing is insufficient.
 * @returns Parent category URI, or null when the URI is not a subcategory.
 */
export function vimeoParentCategoryUriForSubcategoryUri(
  uri: string,
  categories: readonly VimeoCategoryOption[] = []
): string | null {
  const trimmed = uri.trim();
  const subcategoriesPath = trimmed.match(/^\/categories\/([^/]+)\/subcategories\//i);
  if (subcategoriesPath) {
    return `/categories/${subcategoriesPath[1]}`;
  }

  const shortPath = trimmed.match(/^\/categories\/([^/]+)\/([^/?#]+)/i);
  if (shortPath) {
    return `/categories/${shortPath[1]}`;
  }

  for (const category of categories) {
    for (const subcategory of category.subcategories) {
      if (subcategory.uri === trimmed) {
        return category.uri;
      }
    }
  }

  return null;
}

/**
 * Returns the next selected URI list after adding a category or subcategory.
 * Selecting a subcategory also adds its parent category tag when missing.
 * @param currentUris - Currently selected category URIs.
 * @param uriToAdd - Category or subcategory URI to add.
 * @param categories - Category tree from the Vimeo categories API.
 * @returns Updated URI list with parent auto-selection applied for subcategories.
 */
export function addVimeoCategoryUri(
  currentUris: readonly string[],
  uriToAdd: string,
  categories: readonly VimeoCategoryOption[] = []
): string[] {
  const trimmed = uriToAdd.trim();
  if (!trimmed || currentUris.includes(trimmed)) {
    return [...currentUris];
  }

  const next = [...currentUris];
  if (isVimeoSubcategoryUri(trimmed)) {
    const parentUri = vimeoParentCategoryUriForSubcategoryUri(trimmed, categories);
    if (parentUri && !next.includes(parentUri)) {
      next.push(parentUri);
    }
  }
  next.push(trimmed);
  return next;
}

/**
 * Returns the next selected URI list after removing a category chip.
 * Removing a parent category also removes all of its selected subcategories.
 * @param currentUris - Currently selected category URIs.
 * @param uriToRemove - Category or subcategory URI to remove.
 * @param categories - Category tree from the Vimeo categories API.
 * @returns Updated URI list after parent/subcategory cascade rules are applied.
 */
export function removeVimeoCategoryUri(
  currentUris: readonly string[],
  uriToRemove: string,
  categories: readonly VimeoCategoryOption[] = []
): string[] {
  const trimmed = uriToRemove.trim();
  if (!trimmed) {
    return [...currentUris];
  }

  if (isVimeoSubcategoryUri(trimmed)) {
    return currentUris.filter((uri) => uri !== trimmed);
  }

  const subcategoryUris = new Set(
    categories.find((category) => category.uri === trimmed)?.subcategories.map((sub) => sub.uri) ??
      []
  );

  return currentUris.filter((uri) => {
    if (uri === trimmed) {
      return false;
    }
    if (subcategoryUris.has(uri)) {
      return false;
    }
    return vimeoParentCategoryUriForSubcategoryUri(uri, categories) !== trimmed;
  });
}

/**
 * Returns a short chip label for one stored category URI.
 * @param uri - Stored category or subcategory URI.
 * @param categories - Category tree from the Vimeo categories API.
 * @returns Parent or subcategory display name for the chip.
 */
export function vimeoCategoryChipLabelForUri(
  uri: string,
  categories: VimeoCategoryOption[]
): string {
  const trimmed = uri.trim();
  for (const category of categories) {
    if (category.uri === trimmed) {
      return category.name;
    }
    for (const subcategory of category.subcategories) {
      if (subcategory.uri === trimmed) {
        return subcategory.name;
      }
    }
  }

  if (isVimeoSubcategoryUri(trimmed)) {
    const subMatch = trimmed.match(/\/subcategories\/([^/?#]+)/i);
    if (subMatch) {
      return subMatch[1];
    }
  }

  const topMatch = trimmed.match(/\/categories\/([^/?#]+)/i);
  if (topMatch) {
    return topMatch[1];
  }

  return trimmed;
}

/**
 * Returns whether the stored category URIs already use all Vimeo batch slots.
 * @param categoryUris - Stored top-level or subcategory URIs from draft metadata.
 * @returns True when no additional category can be selected without removing one first.
 */
export function isVimeoCategoryBatchAtLimit(categoryUris: readonly string[]): boolean {
  return countVimeoCategoryBatchEntries(categoryUris) >= VIMEO_MAX_VIDEO_CATEGORY_BATCH_ENTRIES;
}

export function vimeoCategorySlugFromUri(uri: string): string | null {
  const match = uri.trim().match(/^\/categories\/([^/?#]+)/i);
  return match?.[1] ?? null;
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
