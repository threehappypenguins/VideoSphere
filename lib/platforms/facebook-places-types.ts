/** Minimum query length for Facebook place search. */
export const FACEBOOK_PLACE_SEARCH_MIN_LENGTH = 2;

/**
 * User-facing notice when global `/pages/search` is unavailable and results are limited
 * to Pages the connected user manages.
 */
export const FACEBOOK_PLACES_MANAGED_ONLY_MESSAGE =
  'Showing only Facebook Pages you manage. To search all public places, request Page Public Metadata Access for your Meta app (App Review).';

/**
 * A Facebook Page returned by the Pages Search API for location tagging.
 * @property id - Page ID used as the `place` parameter on Reels finish.
 * @property name - Page display name.
 * @property location - Optional city/country label for UI display.
 */
export interface FacebookPlaceOption {
  id: string;
  name: string;
  location?: string;
}

/**
 * Result of a Facebook place search, including whether results came from global search
 * or a managed-Pages fallback.
 * @property places - Matching place options.
 * @property searchMode - `global` when `/pages/search` succeeded; `managed` when limited to `/me/accounts`.
 */
export interface FacebookPlacesSearchResult {
  places: FacebookPlaceOption[];
  searchMode: 'global' | 'managed';
}
