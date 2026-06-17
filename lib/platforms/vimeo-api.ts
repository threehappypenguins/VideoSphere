import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import {
  type VimeoAccountDefaults,
  buildVimeoAccountDefaultsSeedPatch,
  readMeDefaultLicense,
} from '@/lib/platforms/vimeo-account-defaults';
import {
  readMeDefaultContentRatingCodes,
  resolveVimeoAccountContentRatingDefault,
  type VimeoContentRatingOption,
} from '@/lib/platforms/vimeo-content-rating';
import {
  readMembershipTypeFromMeBody,
  vimeoMembershipTypeSupportsUnlistedPrivacy,
} from '@/lib/platforms/vimeo-membership';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';
import type { VimeoCategoryOption } from '@/lib/platforms/vimeo-categories';
import {
  isVimeoApiSubcategoryPathUri,
  vimeoParentCategoryUriFromApiSubcategoryPath,
} from '@/lib/platforms/vimeo-categories';
import { isVimeoVideoLicenseCode, type VimeoLicenseOption } from '@/lib/platforms/vimeo-licenses';
import type { ApiError } from '@/types';

export type { VimeoAccountDefaults };
export { buildVimeoAccountDefaultsSeedPatch, readMeDefaultLicense };
export type { VimeoCategoryOption };
export type { VimeoLicenseOption };

const VIMEO_API_BASE = 'https://api.vimeo.com';
const VIMEO_ACCEPT = 'application/vnd.vimeo.*+json;version=3.4';

const VIMEO_ME_UPLOAD_DEFAULT_FIELDS =
  'account,membership.type,preferences.videos.license,preferences.videos.rating';

type VimeoConnectionResult =
  | { ok: true; accessToken: string }
  | { ok: false; response: NextResponse };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function vimeoAuthHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: VIMEO_ACCEPT,
  };
}

/**
 * Resolves a Vimeo API paging link to an absolute URL suitable for `fetch`.
 * @param next - Value from `body.paging.next` (absolute or path-relative).
 * @returns Absolute URL, or null when empty or unparseable.
 */
function resolveVimeoPagingNextUrl(next: string): string | null {
  const trimmed = next.trim();
  if (!trimmed) {
    return null;
  }

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      return new URL(trimmed).toString();
    }
    return new URL(trimmed, `${VIMEO_API_BASE}/`).toString();
  } catch {
    return null;
  }
}

async function readVimeoApiErrorDetails(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '');
  if (!raw.trim()) {
    return `Vimeo API returned HTTP ${response.status}.`;
  }

  try {
    const parsed = JSON.parse(raw) as { error?: string; developer_message?: string };
    const message = parsed.developer_message?.trim() || parsed.error?.trim();
    if (message) return message;
  } catch {
    // Fall through to raw body text.
  }

  return raw.trim();
}

/**
 * Builds a 502 response for a failed Vimeo API request.
 * @param details - Upstream error message or body text.
 * @returns JSON error response for route handlers.
 */
export function vimeoUpstreamErrorResponse(details: string): NextResponse {
  const errRes: ApiError = {
    error: 'Bad Gateway',
    message: details,
    statusCode: 502,
  };
  return NextResponse.json(errRes, { status: 502 });
}

/**
 * Builds a 401 response for missing session auth or token refresh failure.
 * @param message - Human-readable failure reason.
 * @returns JSON error response for route handlers.
 */
export function vimeoAuthErrorResponse(message: string): NextResponse {
  const errRes: ApiError = {
    error: 'Unauthorized',
    message,
    statusCode: 401,
  };
  return NextResponse.json(errRes, { status: 401 });
}

/**
 * Resolves the authenticated user's Vimeo connection and a fresh access token.
 * @param req - Incoming request (session auth).
 * @returns Access token for Vimeo API calls, or an error response.
 */
export async function requireVimeoConnection(req: NextRequest): Promise<VimeoConnectionResult> {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return { ok: false, response: vimeoAuthErrorResponse('Not authenticated') };
  }

  const account = await getConnectedAccountWithTokens(userId, 'vimeo');
  if (!account) {
    return { ok: false, response: vimeoAuthErrorResponse('Vimeo is not connected') };
  }

  try {
    const tokens = await refreshTokenIfNeeded(account);
    const accessToken = tokens.accessToken.trim();
    if (!accessToken) {
      return {
        ok: false,
        response: vimeoAuthErrorResponse(
          'Vimeo access token is missing. Reconnect your Vimeo account.'
        ),
      };
    }
    return { ok: true, accessToken };
  } catch (err) {
    const message =
      err instanceof Error && err.message.trim() !== ''
        ? err.message.trim()
        : 'Failed to refresh Vimeo access token. Reconnect your Vimeo account.';
    return { ok: false, response: vimeoAuthErrorResponse(message) };
  }
}

function unwrapVimeoDataArray<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body;
  if (isPlainObject(body) && Array.isArray(body.data)) {
    return body.data as T[];
  }
  return [];
}

type VimeoCategoryApiRow = {
  uri?: string;
  name?: string;
  top_level?: boolean;
  parent?: { uri?: string; name?: string };
  subcategories?: Array<{ uri?: string; name?: string; top_level?: boolean }>;
};

const VIMEO_CATEGORY_CONNECTION_SEGMENTS = new Set([
  'videos',
  'channels',
  'groups',
  'users',
  'subcategories',
]);

/**
 * Top-level category slugs omitted from `GET /categories` but valid for upload
 * (`GET /categories/{slug}` returns `top_level: true`).
 */
const VIMEO_SUPPLEMENTAL_TOP_LEVEL_CATEGORY_SLUGS = [
  'wedding',
  'events',
  'fashion',
  'technology',
  'food',
  'art',
  'personal',
  'howto',
  'product',
  'talks',
] as const;

/**
 * Category slugs whose subcategories are only exposed via
 * `GET /categories/{slug}/subcategories` (omitted from list/detail inline arrays).
 */
const VIMEO_DEDICATED_SUBCATEGORY_FALLBACK_SLUGS = new Set<string>(['brandedcontent']);

function isSingleSegmentCategoryUri(uri: string): boolean {
  return /^\/categories\/[^/]+$/i.test(uri.trim());
}

function isPlausibleSubcategoryUriForParent(
  uri: string,
  parentSlug: string,
  topLevelCategoryUris: ReadonlySet<string>
): boolean {
  const trimmed = uri.trim();
  if (!trimmed || topLevelCategoryUris.has(trimmed)) {
    return false;
  }

  if (isVimeoApiSubcategoryPathUri(trimmed)) {
    return trimmed.startsWith(`/categories/${parentSlug}/subcategories/`);
  }

  const shortPath = trimmed.match(/^\/categories\/([^/]+)\/([^/?#]+)/i);
  if (!shortPath || shortPath[1] !== parentSlug) {
    return false;
  }

  const childSegment = shortPath[2].toLowerCase();
  if (VIMEO_CATEGORY_CONNECTION_SEGMENTS.has(childSegment)) {
    return false;
  }

  return !topLevelCategoryUris.has(`/categories/${shortPath[2]}`);
}

function parseInlineSubcategoryEntry(
  entry: {
    uri?: string;
    name?: string;
  },
  parentSlug?: string,
  topLevelCategoryUris?: ReadonlySet<string>
): { uri: string; name: string } | null {
  const uri = typeof entry.uri === 'string' ? entry.uri.trim() : '';
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  if (!uri || !name) {
    return null;
  }

  if (
    parentSlug &&
    topLevelCategoryUris &&
    !isPlausibleSubcategoryUriForParent(uri, parentSlug, topLevelCategoryUris)
  ) {
    return null;
  }

  return { uri, name };
}

function isVimeoTopLevelCategoryRow(row: VimeoCategoryApiRow): boolean {
  const uri = typeof row.uri === 'string' ? row.uri.trim() : '';
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  if (!uri || !name || isVimeoApiSubcategoryPathUri(uri)) {
    return false;
  }

  // Rows from `GET /categories` use single-segment URIs for top-level categories.
  // Ignore `parent`/`top_level` on those rows — Vimeo sometimes sends inconsistent metadata.
  return isSingleSegmentCategoryUri(uri);
}

function belongsToParentCategory(
  uri: string,
  parentUri: string,
  parentSlug: string,
  row: Pick<VimeoCategoryApiRow, 'parent' | 'top_level'>
): boolean {
  if (row.top_level === true) {
    return false;
  }

  const rowParentUri = typeof row.parent?.uri === 'string' ? row.parent.uri.trim() : '';
  if (rowParentUri) {
    return rowParentUri === parentUri;
  }

  if (isVimeoApiSubcategoryPathUri(uri)) {
    return uri.startsWith(`/categories/${parentSlug}/subcategories/`);
  }

  return false;
}

function belongsToDedicatedSubcategoryRow(
  uri: string,
  parentUri: string,
  parentSlug: string,
  row: Pick<VimeoCategoryApiRow, 'parent' | 'top_level'>,
  topLevelCategoryUris: ReadonlySet<string>
): boolean {
  if (!isPlausibleSubcategoryUriForParent(uri, parentSlug, topLevelCategoryUris)) {
    return false;
  }

  if (belongsToParentCategory(uri, parentUri, parentSlug, row)) {
    return true;
  }

  const rowParentUri = typeof row.parent?.uri === 'string' ? row.parent.uri.trim() : '';
  if (rowParentUri && rowParentUri !== parentUri) {
    return false;
  }

  const shortPath = uri.match(/^\/categories\/([^/]+)\/([^/?#]+)/i);
  return shortPath?.[1] === parentSlug && shortPath[2] !== 'subcategories';
}

function vimeoCategorySlugFromUri(uri: string): string | null {
  const match = uri.trim().match(/^\/categories\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

function extractInlineSubcategoriesForParentFromRows(
  rows: VimeoCategoryApiRow[],
  parentUri: string,
  parentSlug: string,
  topLevelCategoryUris: ReadonlySet<string>
): Array<{ uri: string; name: string }> {
  for (const row of rows) {
    const uri = typeof row.uri === 'string' ? row.uri.trim() : '';
    if (uri !== parentUri || !Array.isArray(row.subcategories)) {
      continue;
    }

    return row.subcategories
      .map((subcategoryRow) =>
        parseInlineSubcategoryEntry(subcategoryRow, parentSlug, topLevelCategoryUris)
      )
      .filter((subcategory): subcategory is { uri: string; name: string } => subcategory !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }

  return [];
}

function parseSubcategoriesFromCategoryBody(
  body: VimeoCategoryApiRow,
  parentSlug?: string,
  topLevelCategoryUris?: ReadonlySet<string>
): Array<{ uri: string; name: string }> {
  if (!Array.isArray(body.subcategories)) {
    return [];
  }

  return body.subcategories
    .map((subcategory) =>
      parseInlineSubcategoryEntry(subcategory, parentSlug, topLevelCategoryUris)
    )
    .filter((subcategory): subcategory is { uri: string; name: string } => subcategory !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

function addSubcategoryToCategoryMap(
  categoriesByUri: Map<string, VimeoCategoryOption>,
  parentUri: string,
  parentName: string | undefined,
  subcategory: { uri: string; name: string }
) {
  let category = categoriesByUri.get(parentUri);
  if (!category) {
    category = {
      uri: parentUri,
      name: parentName?.trim() || vimeoCategorySlugFromUri(parentUri) || parentUri,
      subcategories: [],
    };
    categoriesByUri.set(parentUri, category);
  } else if (parentName?.trim()) {
    category.name = parentName.trim();
  }

  if (category.subcategories.some((existing) => existing.uri === subcategory.uri)) {
    return;
  }

  category.subcategories.push(subcategory);
}

function finalizeVimeoCategoryOption(category: VimeoCategoryOption): VimeoCategoryOption {
  const subcategories = [...category.subcategories].sort((a, b) =>
    a.name.localeCompare(b.name, 'en')
  );
  return {
    ...category,
    subcategories,
    mayHaveSubcategories: subcategories.length > 0,
  };
}

function buildVimeoCategoryTreeFromRows(rows: VimeoCategoryApiRow[]): VimeoCategoryOption[] {
  const categoriesByUri = new Map<string, VimeoCategoryOption>();
  const topLevelCategoryUris = new Set<string>();

  for (const row of rows) {
    if (!isVimeoTopLevelCategoryRow(row)) {
      continue;
    }
    const uri = typeof row.uri === 'string' ? row.uri.trim() : '';
    if (uri) {
      topLevelCategoryUris.add(uri);
    }
  }

  for (const row of rows) {
    if (!isVimeoTopLevelCategoryRow(row)) {
      continue;
    }

    const uri = typeof row.uri === 'string' ? row.uri.trim() : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const parentSlug = vimeoCategorySlugFromUri(uri);
    const existing = categoriesByUri.get(uri);
    categoriesByUri.set(uri, {
      uri,
      name,
      subcategories: existing?.subcategories ?? [],
    });

    if (Array.isArray(row.subcategories) && parentSlug) {
      for (const subcategoryRow of row.subcategories) {
        const subcategory = parseInlineSubcategoryEntry(
          subcategoryRow,
          parentSlug,
          topLevelCategoryUris
        );
        if (subcategory) {
          addSubcategoryToCategoryMap(categoriesByUri, uri, name, subcategory);
        }
      }
    }
  }

  return [...categoriesByUri.values()]
    .map(finalizeVimeoCategoryOption)
    .filter((category) => category.uri.length > 0 && category.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

function isSupplementalTopLevelCategoryRow(row: VimeoCategoryApiRow): boolean {
  const uri = typeof row.uri === 'string' ? row.uri.trim() : '';
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  if (!uri || !name || row.top_level === false || !isSingleSegmentCategoryUri(uri)) {
    return false;
  }

  return true;
}

function mapDedicatedSubcategoryRows(
  rows: VimeoCategoryApiRow[],
  parentSlug: string,
  topLevelCategoryUris: ReadonlySet<string>
): Array<{ uri: string; name: string }> {
  const parentUri = `/categories/${parentSlug}`;
  const subsByUri = new Map<string, { uri: string; name: string }>();

  for (const row of rows) {
    const uri = typeof row.uri === 'string' ? row.uri.trim() : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (
      !uri ||
      !name ||
      row.top_level === true ||
      !belongsToDedicatedSubcategoryRow(uri, parentUri, parentSlug, row, topLevelCategoryUris)
    ) {
      continue;
    }
    subsByUri.set(uri, { uri, name });
  }

  return [...subsByUri.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/**
 * Loads subcategories from Vimeo's dedicated collection endpoint
 * (`GET /categories/{slug}/subcategories`).
 * @param categorySlug - Top-level category slug (e.g. `brandedcontent`).
 * @param accessToken - OAuth access token with Vimeo read scope.
 * @param signal - Optional abort signal.
 * @returns Subcategory URI/name rows, or an empty array when the request fails.
 */
async function fetchSubcategoriesFromDedicatedEndpoint(
  categorySlug: string,
  accessToken: string,
  topLevelCategoryUris: ReadonlySet<string>,
  signal?: AbortSignal
): Promise<Array<{ uri: string; name: string }>> {
  const slug = categorySlug.trim();
  if (!slug) {
    return [];
  }

  const authHeaders = vimeoAuthHeaders(accessToken);
  const fetchInit = signal ? { headers: authHeaders, signal } : { headers: authHeaders };
  const rows: VimeoCategoryApiRow[] = [];

  let nextUrl: string | null =
    `${VIMEO_API_BASE}/categories/${encodeURIComponent(slug)}/subcategories?${new URLSearchParams({
      per_page: '100',
      sort: 'name',
      direction: 'asc',
    }).toString()}`;

  while (nextUrl) {
    const res = await fetch(nextUrl, fetchInit);
    if (!res.ok) {
      return [];
    }

    const body = await res.json().catch(() => ({}));
    rows.push(...unwrapVimeoDataArray<VimeoCategoryApiRow>(body));

    const pagingNext =
      isPlainObject(body) && isPlainObject(body.paging) && typeof body.paging.next === 'string'
        ? body.paging.next
        : null;
    nextUrl = pagingNext ? resolveVimeoPagingNextUrl(pagingNext) : null;
  }

  return mapDedicatedSubcategoryRows(rows, slug, topLevelCategoryUris);
}

function collectTopLevelCategoryUris(rows: VimeoCategoryApiRow[]): Set<string> {
  const topLevelCategoryUris = new Set<string>();
  for (const row of rows) {
    if (!isVimeoTopLevelCategoryRow(row)) {
      continue;
    }
    const uri = typeof row.uri === 'string' ? row.uri.trim() : '';
    if (uri) {
      topLevelCategoryUris.add(uri);
    }
  }
  return topLevelCategoryUris;
}

/**
 * Resolves subcategories for one top-level category using list inline rows, optional
 * detail enrichment, and a dedicated collection fallback for known upload-only trees.
 * @param categorySlug - Top-level category slug (e.g. `brandedcontent`).
 * @param accessToken - OAuth access token with Vimeo read scope.
 * @param signal - Optional abort signal.
 * @param prefetchedRows - Optional rows from a prior `GET /categories` fetch.
 * @param topLevelCategoryUris - Known top-level category URIs from the list response.
 * @returns Subcategory URI/name rows (possibly empty).
 */
async function resolveSubcategoriesForCategorySlug(
  categorySlug: string,
  accessToken: string,
  signal?: AbortSignal,
  prefetchedRows?: VimeoCategoryApiRow[],
  topLevelCategoryUris?: ReadonlySet<string>
): Promise<Array<{ uri: string; name: string }>> {
  const slug = categorySlug.trim();
  if (!slug) {
    return [];
  }

  const parentUri = `/categories/${slug}`;
  const rows = prefetchedRows ?? (await fetchAllVimeoCategoryRows(accessToken, signal));
  const knownTopLevelUris = topLevelCategoryUris ?? collectTopLevelCategoryUris(rows);

  const fromRows = extractInlineSubcategoriesForParentFromRows(
    rows,
    parentUri,
    slug,
    knownTopLevelUris
  );
  if (fromRows.length > 0) {
    return fromRows;
  }

  const detailRes = await fetch(`${VIMEO_API_BASE}/categories/${encodeURIComponent(slug)}`, {
    headers: vimeoAuthHeaders(accessToken),
    ...(signal ? { signal } : {}),
  });

  if (detailRes.ok) {
    const detailBody = (await detailRes.json().catch(() => ({}))) as VimeoCategoryApiRow;
    if (Array.isArray(detailBody.subcategories)) {
      const fromDetail = parseSubcategoriesFromCategoryBody(detailBody, slug, knownTopLevelUris);
      if (fromDetail.length > 0) {
        return fromDetail;
      }
    }
  }

  if (!VIMEO_DEDICATED_SUBCATEGORY_FALLBACK_SLUGS.has(slug)) {
    return [];
  }

  return fetchSubcategoriesFromDedicatedEndpoint(slug, accessToken, knownTopLevelUris, signal);
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await mapper(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

/**
 * Loads subcategories for categories that only expose children via the dedicated
 * `GET /categories/{slug}/subcategories` collection (e.g. Branded Content).
 * @param categories - Top-level categories built from the paginated list response.
 * @param accessToken - OAuth access token with Vimeo read scope.
 * @param signal - Optional abort signal.
 * @param prefetchedRows - Rows from the initial paginated `GET /categories` fetch.
 * @returns Categories with dedicated fallback subcategories applied.
 */
async function applyDedicatedSubcategoryFallbacks(
  categories: VimeoCategoryOption[],
  accessToken: string,
  signal?: AbortSignal,
  prefetchedRows?: VimeoCategoryApiRow[]
): Promise<VimeoCategoryOption[]> {
  const needingFallback = categories.filter((category) => {
    if (category.subcategories.length > 0) {
      return false;
    }
    const slug = vimeoCategorySlugFromUri(category.uri);
    return slug !== null && VIMEO_DEDICATED_SUBCATEGORY_FALLBACK_SLUGS.has(slug);
  });
  if (needingFallback.length === 0) {
    return categories;
  }

  const byUri = new Map(categories.map((category) => [category.uri, { ...category }]));
  const topLevelCategoryUris = new Set(categories.map((category) => category.uri));

  await mapWithConcurrency(needingFallback, 4, async (category) => {
    const slug = vimeoCategorySlugFromUri(category.uri);
    if (!slug) {
      return;
    }

    const subs = await resolveSubcategoriesForCategorySlug(
      slug,
      accessToken,
      signal,
      prefetchedRows,
      topLevelCategoryUris
    );
    const current = byUri.get(category.uri);
    if (!current) {
      return;
    }

    byUri.set(category.uri, finalizeVimeoCategoryOption({ ...current, subcategories: subs }));
  });

  return [...byUri.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/**
 * Adds upload-eligible top-level categories omitted from `GET /categories`.
 * @param categories - Categories built from the paginated list response.
 * @param accessToken - OAuth access token with Vimeo read scope.
 * @param signal - Optional abort signal.
 * @returns Merged category list including supplemental top-level rows.
 */
async function mergeSupplementalTopLevelCategories(
  categories: VimeoCategoryOption[],
  accessToken: string,
  signal?: AbortSignal
): Promise<VimeoCategoryOption[]> {
  const byUri = new Map(categories.map((category) => [category.uri, category]));
  const authHeaders = vimeoAuthHeaders(accessToken);
  const fetchInit = signal ? { headers: authHeaders, signal } : { headers: authHeaders };

  const missingSlugs = VIMEO_SUPPLEMENTAL_TOP_LEVEL_CATEGORY_SLUGS.filter(
    (slug) => !byUri.has(`/categories/${slug}`)
  );
  if (missingSlugs.length === 0) {
    return categories;
  }

  await mapWithConcurrency(missingSlugs, 4, async (slug) => {
    const res = await fetch(`${VIMEO_API_BASE}/categories/${encodeURIComponent(slug)}`, fetchInit);
    if (!res.ok) {
      return;
    }

    const body = (await res.json().catch(() => ({}))) as VimeoCategoryApiRow;
    if (!isSupplementalTopLevelCategoryRow(body)) {
      return;
    }

    const uri = body.uri!.trim();
    const name = body.name!.trim();
    byUri.set(uri, finalizeVimeoCategoryOption({ uri, name, subcategories: [] }));
  });

  return [...byUri.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/**
 * Fetches subcategories for one top-level Vimeo category.
 * Tries `GET /categories/{category}`, the flat category list, then
 * `GET /categories/{category}/subcategories`.
 * @param categorySlug - Top-level category slug (e.g. `brandedcontent`).
 * @param accessToken - OAuth access token with Vimeo read scope.
 * @param signal - Optional abort signal.
 * @returns Subcategory URI/name rows, or upstream error details.
 */
export async function fetchVimeoCategorySubcategories(
  categorySlug: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<
  { ok: true; items: Array<{ uri: string; name: string }> } | { ok: false; details: string }
> {
  const slug = categorySlug.trim();
  if (!slug) {
    return { ok: false, details: 'Category slug is required.' };
  }

  try {
    const rows = await fetchAllVimeoCategoryRows(accessToken, signal);
    const topLevelCategoryUris = collectTopLevelCategoryUris(rows);
    const items = await resolveSubcategoriesForCategorySlug(
      slug,
      accessToken,
      signal,
      rows,
      topLevelCategoryUris
    );
    return { ok: true, items };
  } catch (err) {
    const details =
      err instanceof Error && err.message.trim() !== ''
        ? err.message.trim()
        : 'Failed to load Vimeo subcategories.';
    return { ok: false, details };
  }
}

async function fetchAllVimeoCategoryRows(
  accessToken: string,
  signal?: AbortSignal
): Promise<VimeoCategoryApiRow[]> {
  const authHeaders = vimeoAuthHeaders(accessToken);
  const fetchInit = signal ? { headers: authHeaders, signal } : { headers: authHeaders };
  const rows: VimeoCategoryApiRow[] = [];

  let nextUrl: string | null = `${VIMEO_API_BASE}/categories?${new URLSearchParams({
    per_page: '100',
    sort: 'name',
    direction: 'asc',
  }).toString()}`;

  while (nextUrl) {
    const res = await fetch(nextUrl, fetchInit);
    if (!res.ok) {
      throw new Error(await readVimeoApiErrorDetails(res));
    }

    const body = await res.json().catch(() => ({}));
    rows.push(...unwrapVimeoDataArray<VimeoCategoryApiRow>(body));

    const pagingNext =
      isPlainObject(body) && isPlainObject(body.paging) && typeof body.paging.next === 'string'
        ? body.paging.next
        : null;
    nextUrl = pagingNext ? resolveVimeoPagingNextUrl(pagingNext) : null;
  }

  return rows;
}

/**
 * Fetches all Vimeo content ratings (`GET /contentratings`).
 * @param accessToken - OAuth access token with Vimeo read scope.
 * @param signal - Optional abort signal.
 * @returns Content rating code/name rows, or upstream error details.
 */
export async function fetchVimeoContentRatings(
  accessToken: string,
  signal?: AbortSignal
): Promise<{ ok: true; items: VimeoContentRatingOption[] } | { ok: false; details: string }> {
  const res = await fetch(`${VIMEO_API_BASE}/contentratings`, {
    headers: vimeoAuthHeaders(accessToken),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    return { ok: false, details: await readVimeoApiErrorDetails(res) };
  }

  const body = await res.json().catch(() => ({}));
  const items = unwrapVimeoDataArray<{ code?: string; name?: string }>(body)
    .map((item) => ({
      code: typeof item.code === 'string' ? item.code.trim() : '',
      name: typeof item.name === 'string' ? item.name.trim() : '',
    }))
    .filter((item) => item.code.length > 0 && item.name.length > 0);

  return { ok: true, items };
}

/**
 * Fetches top-level Vimeo categories with nested subcategories (`GET /categories`).
 * @param accessToken - OAuth access token with Vimeo read scope.
 * @param signal - Optional abort signal.
 * @returns Category URI/name rows for top-level categories and their subcategories.
 */
export async function fetchVimeoCategories(
  accessToken: string,
  signal?: AbortSignal
): Promise<{ ok: true; items: VimeoCategoryOption[] } | { ok: false; details: string }> {
  try {
    const rows = await fetchAllVimeoCategoryRows(accessToken, signal);
    const tree = buildVimeoCategoryTreeFromRows(rows);
    const withDedicatedFallbacks = await applyDedicatedSubcategoryFallbacks(
      tree,
      accessToken,
      signal,
      rows
    );
    const items = await mergeSupplementalTopLevelCategories(
      withDedicatedFallbacks,
      accessToken,
      signal
    );
    return { ok: true, items };
  } catch (err) {
    const details =
      err instanceof Error && err.message.trim() !== ''
        ? err.message.trim()
        : 'Failed to load Vimeo categories.';
    return { ok: false, details };
  }
}

/**
 * Fetches Creative Commons license options (`GET /creativecommons`).
 * @param accessToken - OAuth access token with Vimeo read scope.
 * @param signal - Optional abort signal.
 * @returns License code/name rows for upload UI, or upstream error details.
 */
export async function fetchVimeoCreativeCommonsLicenses(
  accessToken: string,
  signal?: AbortSignal
): Promise<{ ok: true; items: VimeoLicenseOption[] } | { ok: false; details: string }> {
  const res = await fetch(`${VIMEO_API_BASE}/creativecommons`, {
    headers: vimeoAuthHeaders(accessToken),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    return { ok: false, details: await readVimeoApiErrorDetails(res) };
  }

  const body = await res.json().catch(() => ({}));
  const items = unwrapVimeoDataArray<{ code?: string; name?: string }>(body)
    .map((item) => {
      const code = typeof item.code === 'string' ? item.code.trim() : '';
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      return { code, name };
    })
    .filter(
      (item): item is VimeoLicenseOption =>
        item.name.length > 0 && isVimeoVideoLicenseCode(item.code)
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));

  return { ok: true, items };
}

/** Draft metadata option bundle for the Vimeo card in the draft metadata modal. */
export interface VimeoDraftMetadataOptions {
  /** Content rating rows from `GET /contentratings`. */
  contentRatings: VimeoContentRatingOption[];
  /** Category tree from `GET /categories`. */
  categories: VimeoCategoryOption[];
  /** Creative Commons license rows from `GET /creativecommons`. */
  licenses: VimeoLicenseOption[];
  /** Upload defaults resolved from `GET /me` plus content ratings. */
  accountDefaults: VimeoAccountDefaults;
}

function buildVimeoAccountDefaultsFromMeBody(
  body: Record<string, unknown>,
  contentRatings: VimeoContentRatingOption[]
): VimeoAccountDefaults {
  const defaults: VimeoAccountDefaults = {};

  const userDefaultCodes = readMeDefaultContentRatingCodes(body);
  const resolvedContentRating = resolveVimeoAccountContentRatingDefault(
    userDefaultCodes,
    contentRatings
  );
  if (resolvedContentRating !== undefined) {
    defaults.contentRating = resolvedContentRating;
  }

  const license = readMeDefaultLicense(body);
  if (license !== undefined) {
    defaults.license = license;
  }

  const membershipType = readMembershipTypeFromMeBody(body);
  if (membershipType !== undefined) {
    defaults.membershipType = membershipType;
    defaults.supportsUnlistedPrivacy = vimeoMembershipTypeSupportsUnlistedPrivacy(membershipType);
  }

  return defaults;
}

/**
 * Fetches all Vimeo draft metadata options in one pass so each upstream resource is requested once.
 * @param accessToken - OAuth access token with Vimeo read scope.
 * @param signal - Optional abort signal.
 * @returns Draft metadata bundle for the Vimeo card, or upstream error details.
 */
export async function fetchVimeoDraftMetadataOptions(
  accessToken: string,
  signal?: AbortSignal
): Promise<{ ok: true; options: VimeoDraftMetadataOptions } | { ok: false; details: string }> {
  const authHeaders = vimeoAuthHeaders(accessToken);
  const fetchInit = signal ? { headers: authHeaders, signal } : { headers: authHeaders };
  const meUrl = new URL(`${VIMEO_API_BASE}/me`);
  meUrl.searchParams.set('fields', VIMEO_ME_UPLOAD_DEFAULT_FIELDS);

  const [ratingsResult, categoriesResult, licensesResult, meRes] = await Promise.all([
    fetchVimeoContentRatings(accessToken, signal),
    fetchVimeoCategories(accessToken, signal),
    fetchVimeoCreativeCommonsLicenses(accessToken, signal),
    fetch(meUrl.toString(), fetchInit),
  ]);

  if (ratingsResult.ok === false) {
    return { ok: false, details: ratingsResult.details };
  }
  if (categoriesResult.ok === false) {
    return { ok: false, details: categoriesResult.details };
  }
  if (licensesResult.ok === false) {
    return { ok: false, details: licensesResult.details };
  }
  if (!meRes.ok) {
    return { ok: false, details: await readVimeoApiErrorDetails(meRes) };
  }

  const body = (await meRes.json().catch(() => ({}))) as Record<string, unknown>;

  return {
    ok: true,
    options: {
      contentRatings: ratingsResult.items,
      categories: categoriesResult.items,
      licenses: licensesResult.items,
      accountDefaults: buildVimeoAccountDefaultsFromMeBody(body, ratingsResult.items),
    },
  };
}

/**
 * Reads upload defaults from the authenticated Vimeo user (`GET /me`).
 * @param accessToken - OAuth access token with Vimeo read scope.
 * @param signal - Optional abort signal.
 * @param contentRatings - Optional pre-fetched content rating rows to avoid duplicate `/contentratings` calls.
 * @returns Account defaults sourced from the Vimeo `/me` response.
 */
export async function fetchVimeoAccountDefaults(
  accessToken: string,
  signal?: AbortSignal,
  contentRatings?: VimeoContentRatingOption[]
): Promise<{ ok: true; defaults: VimeoAccountDefaults } | { ok: false; details: string }> {
  const authHeaders = vimeoAuthHeaders(accessToken);
  const fetchInit = signal ? { headers: authHeaders, signal } : { headers: authHeaders };
  const meUrl = new URL(`${VIMEO_API_BASE}/me`);
  meUrl.searchParams.set('fields', VIMEO_ME_UPLOAD_DEFAULT_FIELDS);

  const ratingsPromise =
    contentRatings !== undefined
      ? Promise.resolve({ ok: true as const, items: contentRatings })
      : fetchVimeoContentRatings(accessToken, signal);

  const [meRes, ratingsResult] = await Promise.all([
    fetch(meUrl.toString(), fetchInit),
    ratingsPromise,
  ]);

  if (!meRes.ok) {
    return { ok: false, details: await readVimeoApiErrorDetails(meRes) };
  }
  if (ratingsResult.ok === false) {
    return { ok: false, details: ratingsResult.details };
  }

  const body = (await meRes.json().catch(() => ({}))) as Record<string, unknown>;

  return {
    ok: true,
    defaults: buildVimeoAccountDefaultsFromMeBody(body, ratingsResult.items),
  };
}
