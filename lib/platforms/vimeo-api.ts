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
  const url = new URL(`${VIMEO_API_BASE}/categories`);
  url.searchParams.set('per_page', '100');
  url.searchParams.set('sort', 'name');
  url.searchParams.set('direction', 'asc');

  const res = await fetch(url.toString(), {
    headers: vimeoAuthHeaders(accessToken),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    return { ok: false, details: await readVimeoApiErrorDetails(res) };
  }

  const body = await res.json().catch(() => ({}));
  const items = unwrapVimeoDataArray<{
    uri?: string;
    name?: string;
    top_level?: boolean;
    subcategories?: Array<{ uri?: string; name?: string }>;
  }>(body)
    .filter((item) => item.top_level === true)
    .map((item) => {
      const uri = typeof item.uri === 'string' ? item.uri.trim() : '';
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      const subcategories = Array.isArray(item.subcategories)
        ? item.subcategories
            .map((subcategory) => ({
              uri: typeof subcategory.uri === 'string' ? subcategory.uri.trim() : '',
              name: typeof subcategory.name === 'string' ? subcategory.name.trim() : '',
            }))
            .filter((subcategory) => subcategory.uri.length > 0 && subcategory.name.length > 0)
            .sort((a, b) => a.name.localeCompare(b.name, 'en'))
        : [];

      return { uri, name, subcategories };
    })
    .filter((item) => item.uri.length > 0 && item.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));

  return { ok: true, items };
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

/**
 * Reads upload defaults from the authenticated Vimeo user (`GET /me`).
 * @param accessToken - OAuth access token with Vimeo read scope.
 * @param signal - Optional abort signal.
 * @returns Account defaults sourced from the Vimeo `/me` response.
 */
export async function fetchVimeoAccountDefaults(
  accessToken: string,
  signal?: AbortSignal
): Promise<{ ok: true; defaults: VimeoAccountDefaults } | { ok: false; details: string }> {
  const authHeaders = vimeoAuthHeaders(accessToken);
  const fetchInit = signal ? { headers: authHeaders, signal } : { headers: authHeaders };
  const meUrl = new URL(`${VIMEO_API_BASE}/me`);
  meUrl.searchParams.set('fields', VIMEO_ME_UPLOAD_DEFAULT_FIELDS);

  const [meRes, ratingsResult] = await Promise.all([
    fetch(meUrl.toString(), fetchInit),
    fetchVimeoContentRatings(accessToken, signal),
  ]);

  if (!meRes.ok) {
    return { ok: false, details: await readVimeoApiErrorDetails(meRes) };
  }
  if (ratingsResult.ok === false) {
    return { ok: false, details: ratingsResult.details };
  }

  const body = (await meRes.json().catch(() => ({}))) as Record<string, unknown>;
  const defaults: VimeoAccountDefaults = {};

  const userDefaultCodes = readMeDefaultContentRatingCodes(body);
  const contentRating = resolveVimeoAccountContentRatingDefault(
    userDefaultCodes,
    ratingsResult.items
  );
  if (contentRating !== undefined) {
    defaults.contentRating = contentRating;
  }

  const license = readMeDefaultLicense(body);
  if (license !== undefined) {
    defaults.license = license;
  }

  return { ok: true, defaults };
}
