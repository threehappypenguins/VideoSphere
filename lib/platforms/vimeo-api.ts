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
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';
import type { VimeoCategoryOption } from '@/lib/platforms/vimeo-categories';
import {
  isVimeoSubcategoryUri,
  vimeoParentCategoryUriForSubcategoryUri,
} from '@/lib/platforms/vimeo-categories';
import { isVimeoVideoLicenseCode, type VimeoLicenseOption } from '@/lib/platforms/vimeo-licenses';
import type { ApiError } from '@/types';

export type { VimeoAccountDefaults };
export { buildVimeoAccountDefaultsSeedPatch, readMeDefaultLicense };
export type { VimeoCategoryOption };
export type { VimeoLicenseOption };

const VIMEO_API_BASE = 'https://api.vimeo.com';
const VIMEO_ACCEPT = 'application/vnd.vimeo.*+json;version=3.4';

const VIMEO_ME_UPLOAD_DEFAULT_FIELDS = 'preferences.videos.license,preferences.videos.rating';

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

function normalizeVimeoSubcategoryRow(row: {
  uri?: string;
  name?: string;
  top_level?: boolean;
}): { uri: string; name: string } | null {
  const uri = typeof row.uri === 'string' ? row.uri.trim() : '';
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  if (!uri || !name || row.top_level === true) {
    return null;
  }
  if (row.top_level === false || isVimeoSubcategoryUri(uri)) {
    return { uri, name };
  }
  return null;
}

function vimeoCategorySlugFromUri(uri: string): string | null {
  const match = uri.trim().match(/^\/categories\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

function collectParentUrisWithChildren(rows: VimeoCategoryApiRow[]): Set<string> {
  const parents = new Set<string>();

  for (const row of rows) {
    const uri = typeof row.uri === 'string' ? row.uri.trim() : '';
    if (!uri) {
      continue;
    }

    if (Array.isArray(row.subcategories) && row.subcategories.length > 0) {
      parents.add(uri);
    }

    const parentUri = typeof row.parent?.uri === 'string' ? row.parent.uri.trim() : '';
    if (parentUri && row.top_level === false) {
      parents.add(parentUri);
    }

    if (row.top_level === false && isVimeoSubcategoryUri(uri)) {
      const inferredParent = vimeoParentCategoryUriForSubcategoryUri(uri);
      if (inferredParent) {
        parents.add(inferredParent);
      }
    }
  }

  return parents;
}

function extractSubcategoriesForParentFromRows(
  rows: VimeoCategoryApiRow[],
  parentUri: string,
  parentSlug: string
): Array<{ uri: string; name: string }> {
  const subsByUri = new Map<string, { uri: string; name: string }>();
  const parentPrefix = `/categories/${parentSlug}/`;

  const addSub = (sub: { uri: string; name: string } | null) => {
    if (sub) {
      subsByUri.set(sub.uri, sub);
    }
  };

  for (const row of rows) {
    const uri = typeof row.uri === 'string' ? row.uri.trim() : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';

    if (uri === parentUri && Array.isArray(row.subcategories)) {
      for (const subcategoryRow of row.subcategories) {
        addSub(
          normalizeVimeoSubcategoryRow({
            uri: subcategoryRow.uri,
            name: subcategoryRow.name,
            top_level: false,
          })
        );
      }
    }

    if (!uri || !name || row.top_level === true || uri === parentUri) {
      continue;
    }

    const rowParentUri = typeof row.parent?.uri === 'string' ? row.parent.uri.trim() : '';
    if (rowParentUri === parentUri || (uri.startsWith(parentPrefix) && uri !== parentUri)) {
      addSub(normalizeVimeoSubcategoryRow({ uri, name, top_level: false }));
    }
  }

  return [...subsByUri.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

function parseSubcategoriesFromCategoryBody(
  body: VimeoCategoryApiRow
): Array<{ uri: string; name: string }> {
  if (!Array.isArray(body.subcategories)) {
    return [];
  }

  return body.subcategories
    .map((subcategory) =>
      normalizeVimeoSubcategoryRow({
        uri: subcategory.uri,
        name: subcategory.name,
        top_level: false,
      })
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

function buildVimeoCategoryTreeFromRows(rows: VimeoCategoryApiRow[]): VimeoCategoryOption[] {
  const categoriesByUri = new Map<string, VimeoCategoryOption>();
  const parentUrisWithChildren = collectParentUrisWithChildren(rows);

  for (const row of rows) {
    const uri = typeof row.uri === 'string' ? row.uri.trim() : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!uri || !name || row.top_level !== true || isVimeoSubcategoryUri(uri)) {
      continue;
    }

    const existing = categoriesByUri.get(uri);
    categoriesByUri.set(uri, {
      uri,
      name,
      subcategories: existing?.subcategories ?? [],
      mayHaveSubcategories: parentUrisWithChildren.has(uri),
    });

    if (Array.isArray(row.subcategories)) {
      for (const subcategoryRow of row.subcategories) {
        const subcategory = normalizeVimeoSubcategoryRow({
          uri: subcategoryRow.uri,
          name: subcategoryRow.name,
          top_level: false,
        });
        if (subcategory) {
          addSubcategoryToCategoryMap(categoriesByUri, uri, name, subcategory);
        }
      }
    }
  }

  for (const row of rows) {
    const uri = typeof row.uri === 'string' ? row.uri.trim() : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!uri || !name || row.top_level === true) {
      continue;
    }

    const parentUri =
      typeof row.parent?.uri === 'string'
        ? row.parent.uri.trim()
        : (vimeoParentCategoryUriForSubcategoryUri(uri) ?? undefined);
    const parentName = typeof row.parent?.name === 'string' ? row.parent.name.trim() : undefined;

    const subcategory = normalizeVimeoSubcategoryRow({ uri, name, top_level: false });
    if (!subcategory || !parentUri) {
      continue;
    }

    addSubcategoryToCategoryMap(categoriesByUri, parentUri, parentName, subcategory);
  }

  return [...categoriesByUri.values()]
    .map((category) => ({
      ...category,
      subcategories: [...category.subcategories].sort((a, b) => a.name.localeCompare(b.name, 'en')),
      mayHaveSubcategories:
        category.subcategories.length > 0 || parentUrisWithChildren.has(category.uri),
    }))
    .filter((category) => category.uri.length > 0 && category.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
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
 * Loads subcategories from `GET /categories/{slug}` for top-level categories still missing children.
 * Vimeo's category list often omits nested subcategories until the category detail is fetched.
 * @param categories - Top-level categories built from the paginated list response.
 * @param accessToken - OAuth access token with Vimeo read scope.
 * @param signal - Optional abort signal.
 * @returns Categories with subcategories and `mayHaveSubcategories` filled in.
 */
async function fillMissingSubcategoriesFromDetail(
  categories: VimeoCategoryOption[],
  accessToken: string,
  signal?: AbortSignal
): Promise<VimeoCategoryOption[]> {
  const needingDetail = categories.filter((category) => category.subcategories.length === 0);
  if (needingDetail.length === 0) {
    return categories;
  }

  const byUri = new Map(categories.map((category) => [category.uri, { ...category }]));

  await mapWithConcurrency(needingDetail, 4, async (category) => {
    const slug = vimeoCategorySlugFromUri(category.uri);
    if (!slug) {
      return;
    }

    const detailRes = await fetch(`${VIMEO_API_BASE}/categories/${encodeURIComponent(slug)}`, {
      headers: vimeoAuthHeaders(accessToken),
      ...(signal ? { signal } : {}),
    });
    if (!detailRes.ok) {
      return;
    }

    const subs = parseSubcategoriesFromCategoryBody(
      (await detailRes.json().catch(() => ({}))) as VimeoCategoryApiRow
    );
    const current = byUri.get(category.uri);
    if (!current) {
      return;
    }

    byUri.set(category.uri, {
      ...current,
      subcategories: subs,
      mayHaveSubcategories: subs.length > 0,
    });
  });

  return [...byUri.values()]
    .map((category) => ({
      ...category,
      mayHaveSubcategories:
        category.mayHaveSubcategories === true || category.subcategories.length > 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/**
 * Fetches subcategories for one top-level Vimeo category (`GET /categories/{category}`).
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

  const parentUri = `/categories/${slug}`;
  const detailRes = await fetch(`${VIMEO_API_BASE}/categories/${encodeURIComponent(slug)}`, {
    headers: vimeoAuthHeaders(accessToken),
    ...(signal ? { signal } : {}),
  });

  if (!detailRes.ok) {
    return { ok: false, details: await readVimeoApiErrorDetails(detailRes) };
  }

  const detailBody = (await detailRes.json().catch(() => ({}))) as VimeoCategoryApiRow;
  let items = parseSubcategoriesFromCategoryBody(detailBody);

  if (items.length === 0) {
    const rows = await fetchAllVimeoCategoryRows(accessToken, signal);
    items = extractSubcategoriesForParentFromRows(rows, parentUri, slug);
  }

  return { ok: true, items };
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
    nextUrl = pagingNext?.trim() ? pagingNext : null;
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
    const items = await fillMissingSubcategoriesFromDetail(tree, accessToken, signal);
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
