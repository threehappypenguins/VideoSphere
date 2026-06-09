const PLACES_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACES_DETAILS_URL = 'https://places.googleapis.com/v1/places';

/** Minimum characters before calling Google Places Autocomplete (New). */
export const YOUTUBE_LOCATION_SEARCH_MIN_LENGTH = 2;

/** Max length accepted by YouTube `recordingDetails.locationDescription`. */
export const YOUTUBE_LOCATION_DESCRIPTION_MAX_LENGTH = 100;

/** Place suggestion returned from Autocomplete (New). */
export interface GooglePlaceSuggestion {
  /** Google place id (`placeId` from Autocomplete). */
  placeId: string;
  /** Human-readable label shown in the picker (from `placePrediction.text.text`). */
  description: string;
}

/** Validated place coordinates and description for YouTube `recordingDetails`. */
export interface GooglePlaceLocation {
  /** Google place id. */
  placeId: string;
  /** Text sent to `recordingDetails.locationDescription` (truncated to 100 chars). */
  description: string;
  /** Latitude for `recordingDetails.location.latitude`. */
  latitude: number;
  /** Longitude for `recordingDetails.location.longitude`. */
  longitude: number;
}

type PlacesAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
    };
  }>;
};

type PlacesDetailsResponse = {
  formattedAddress?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
};

/**
 * Returns whether server-side Google Places API (New) is configured.
 * @returns True when `GOOGLE_PLACES_API_KEY` is set.
 */
export function isGooglePlacesConfigured(): boolean {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  return Boolean(key);
}

function getGooglePlacesApiKey(): string | null {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  return key || null;
}

function truncateLocationDescription(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= YOUTUBE_LOCATION_DESCRIPTION_MAX_LENGTH) {
    return trimmed;
  }
  return trimmed.slice(0, YOUTUBE_LOCATION_DESCRIPTION_MAX_LENGTH);
}

function parseLatitude(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -90 || value > 90) {
    return undefined;
  }
  return value;
}

function parseLongitude(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -180 || value > 180) {
    return undefined;
  }
  return value;
}

async function readPlacesErrorDetails(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '');
  if (!raw.trim()) {
    return `Google Places API returned HTTP ${response.status}.`;
  }

  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (typeof parsed.error?.message === 'string' && parsed.error.message.trim() !== '') {
      return parsed.error.message.trim();
    }
  } catch {
    // Fall through to raw body text.
  }

  return raw.trim();
}

/**
 * Returns place predictions for a user query via Places Autocomplete (New).
 * @param input - Partial place name or address typed by the user.
 * @param sessionToken - UUID session token grouping autocomplete with a later details call.
 * @param signal - Optional abort signal.
 * @returns Matching place suggestions, or an error message.
 */
export async function autocompleteGooglePlaces(
  input: string,
  sessionToken: string,
  signal?: AbortSignal
): Promise<{ ok: true; suggestions: GooglePlaceSuggestion[] } | { ok: false; details: string }> {
  const apiKey = getGooglePlacesApiKey();
  if (!apiKey) {
    return { ok: false, details: 'Google Places API is not configured.' };
  }

  const trimmedInput = input.trim();
  if (trimmedInput.length < YOUTUBE_LOCATION_SEARCH_MIN_LENGTH) {
    return {
      ok: false,
      details: `Search query must be at least ${YOUTUBE_LOCATION_SEARCH_MIN_LENGTH} characters.`,
    };
  }

  const response = await fetch(PLACES_AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text',
    },
    body: JSON.stringify({
      input: trimmedInput,
      sessionToken,
      includeQueryPredictions: false,
    }),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    return { ok: false, details: await readPlacesErrorDetails(response) };
  }

  const body = (await response.json().catch(() => ({}))) as PlacesAutocompleteResponse;
  const suggestions: GooglePlaceSuggestion[] = [];

  for (const suggestion of body.suggestions ?? []) {
    const placeId = suggestion.placePrediction?.placeId?.trim();
    const description = suggestion.placePrediction?.text?.text?.trim();
    if (!placeId || !description) continue;
    suggestions.push({ placeId, description });
  }

  return { ok: true, suggestions };
}

/**
 * Resolves a selected place id to coordinates and a YouTube-safe description.
 * @param placeId - Google place id from Autocomplete (New).
 * @param sessionToken - Same session token used for the autocomplete request.
 * @param fallbackDescription - Description from autocomplete when details omit formatted text.
 * @param signal - Optional abort signal.
 * @returns Validated location fields for YouTube upload metadata.
 */
export async function resolveGooglePlaceLocation(
  placeId: string,
  sessionToken: string,
  fallbackDescription: string,
  signal?: AbortSignal
): Promise<{ ok: true; location: GooglePlaceLocation } | { ok: false; details: string }> {
  const apiKey = getGooglePlacesApiKey();
  if (!apiKey) {
    return { ok: false, details: 'Google Places API is not configured.' };
  }

  const trimmedPlaceId = placeId.trim();
  if (trimmedPlaceId === '') {
    return { ok: false, details: 'Place id is required.' };
  }

  const response = await fetch(`${PLACES_DETAILS_URL}/${encodeURIComponent(trimmedPlaceId)}`, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'formattedAddress,displayName,location',
    },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    return { ok: false, details: await readPlacesErrorDetails(response) };
  }

  const body = (await response.json().catch(() => ({}))) as PlacesDetailsResponse;
  const latitude = parseLatitude(body.location?.latitude);
  const longitude = parseLongitude(body.location?.longitude);
  if (latitude === undefined || longitude === undefined) {
    return { ok: false, details: 'Selected place is missing coordinates.' };
  }

  const descriptionSource =
    body.formattedAddress?.trim() || body.displayName?.text?.trim() || fallbackDescription.trim();
  if (descriptionSource === '') {
    return { ok: false, details: 'Selected place is missing a description.' };
  }

  return {
    ok: true,
    location: {
      placeId: trimmedPlaceId,
      description: truncateLocationDescription(descriptionSource),
      latitude,
      longitude,
    },
  };
}
