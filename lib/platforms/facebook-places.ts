import {
  buildFacebookAppSecretProof,
  FACEBOOK_GRAPH_API_BASE,
  facebookGraphApiFetchInit,
  fetchFacebookManagedPages,
} from '@/lib/platforms/facebook-oauth';
import {
  FACEBOOK_PLACE_SEARCH_MIN_LENGTH,
  type FacebookPlaceOption,
  type FacebookPlacesSearchResult,
} from '@/lib/platforms/facebook-places-types';

export {
  FACEBOOK_PLACE_SEARCH_MIN_LENGTH,
  FACEBOOK_PLACES_MANAGED_ONLY_MESSAGE,
  type FacebookPlaceOption,
  type FacebookPlacesSearchResult,
} from '@/lib/platforms/facebook-places-types';

interface FacebookPlaceLocation {
  city?: string;
  country?: string;
}

interface FacebookPagesSearchEntry {
  id?: string;
  name?: string;
  location?: FacebookPlaceLocation;
}

interface FacebookGraphErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
}

interface FacebookPagesSearchResponse extends FacebookGraphErrorBody {
  data?: FacebookPagesSearchEntry[];
}

/**
 * Returns true when a Graph API JSON body indicates an expired or invalid access token.
 * Permission and feature errors also use `OAuthException` but carry non-190 codes.
 * @param body - Parsed Graph API response body.
 * @returns True only for error code 190 (invalid/expired token).
 */
export function isFacebookGraphTokenError(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const err = (body as FacebookGraphErrorBody).error;
  if (!err) return false;
  return err.code === 190;
}

/**
 * Returns true when `/pages/search` failed because the Meta app lacks global Page search access.
 * @param body - Parsed Graph API response body.
 * @returns True for error code 10 or messages referencing required Page search features.
 */
export function isFacebookPagesSearchPermissionError(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const err = (body as FacebookGraphErrorBody).error;
  if (!err) return false;
  if (err.code === 10) return true;
  const message = err.message ?? '';
  return (
    message.includes('Page Public Metadata Access') ||
    message.includes('Page Public Content Access') ||
    message.includes("requires the 'pages_read_engagement' permission")
  );
}

function getGraphErrorBody(err: unknown): unknown {
  return err instanceof Error && 'graphBody' in err
    ? (err as Error & { graphBody?: unknown }).graphBody
    : undefined;
}

function formatPlaceLocation(location?: FacebookPlaceLocation): string | undefined {
  if (!location) return undefined;
  const parts = [location.city, location.country].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== ''
  );
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * Searches Facebook Pages to tag as a Reel location (`GET /pages/search`).
 * @param userAccessToken - Long-lived user access token (not the Page token).
 * @param query - Search text (minimum {@link FACEBOOK_PLACE_SEARCH_MIN_LENGTH} characters).
 * @returns Matching place options, or throws with the Graph API error body on failure.
 */
export async function searchFacebookPlaces(
  userAccessToken: string,
  query: string
): Promise<FacebookPlaceOption[]> {
  const trimmed = query.trim();
  if (trimmed.length < FACEBOOK_PLACE_SEARCH_MIN_LENGTH) {
    return [];
  }

  const params = new URLSearchParams({
    q: trimmed,
    fields: 'id,name,location',
  });
  const appSecretProof = buildFacebookAppSecretProof(userAccessToken);
  if (appSecretProof) {
    params.set('appsecret_proof', appSecretProof);
  }

  const res = await fetch(
    `${FACEBOOK_GRAPH_API_BASE}/pages/search?${params.toString()}`,
    facebookGraphApiFetchInit(userAccessToken)
  );
  const body = (await res.json().catch(() => ({}))) as FacebookPagesSearchResponse;

  if (!res.ok || body.error) {
    const message = body.error?.message ?? `Facebook Pages Search failed (HTTP ${res.status})`;
    const err = new Error(message) as Error & { graphBody?: unknown; statusCode?: number };
    err.graphBody = body;
    err.statusCode = res.status;
    throw err;
  }

  const data = Array.isArray(body.data) ? body.data : [];
  return data
    .filter((entry): entry is FacebookPagesSearchEntry & { id: string; name: string } =>
      Boolean(entry.id && entry.name)
    )
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      ...(formatPlaceLocation(entry.location)
        ? { location: formatPlaceLocation(entry.location) }
        : {}),
    }));
}

/**
 * Filters Pages the user manages (`GET /me/accounts`) by name for location tagging.
 * Works without Meta App Review for Page Public Metadata Access.
 * @param userAccessToken - Long-lived user access token.
 * @param query - Search text (minimum {@link FACEBOOK_PLACE_SEARCH_MIN_LENGTH} characters).
 * @returns Matching managed Page options.
 */
export async function searchFacebookManagedPlaces(
  userAccessToken: string,
  query: string
): Promise<FacebookPlaceOption[]> {
  const trimmed = query.trim();
  if (trimmed.length < FACEBOOK_PLACE_SEARCH_MIN_LENGTH) {
    return [];
  }

  const needle = trimmed.toLowerCase();
  const pages = await fetchFacebookManagedPages(userAccessToken);
  return pages
    .filter((page) => page.name.toLowerCase().includes(needle))
    .map((page) => ({
      id: page.id,
      name: page.name,
    }));
}

/**
 * Searches for taggable Facebook Pages, falling back to managed Pages when global search is unavailable.
 * @param userAccessToken - Long-lived user access token.
 * @param query - Search text.
 * @returns Place options and whether results came from global or managed search.
 */
export async function searchFacebookPlacesWithFallback(
  userAccessToken: string,
  query: string
): Promise<FacebookPlacesSearchResult> {
  try {
    const places = await searchFacebookPlaces(userAccessToken, query);
    return { places, searchMode: 'global' };
  } catch (err) {
    if (isFacebookPagesSearchPermissionError(getGraphErrorBody(err))) {
      const places = await searchFacebookManagedPlaces(userAccessToken, query);
      return { places, searchMode: 'managed' };
    }
    throw err;
  }
}
