import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autocompleteGooglePlaces,
  isGooglePlacesConfigured,
  resolveGooglePlaceLocation,
  YOUTUBE_LOCATION_DESCRIPTION_MAX_LENGTH,
} from '@/lib/platforms/google-places';

describe('google-places', () => {
  const originalApiKey = process.env.GOOGLE_PLACES_API_KEY;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.GOOGLE_PLACES_API_KEY = 'test-places-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalApiKey === undefined) {
      delete process.env.GOOGLE_PLACES_API_KEY;
    } else {
      process.env.GOOGLE_PLACES_API_KEY = originalApiKey;
    }
  });

  it('isGooglePlacesConfigured returns false when the API key is missing', () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    expect(isGooglePlacesConfigured()).toBe(false);
  });

  it('autocompleteGooglePlaces maps place predictions', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            placePrediction: {
              placeId: 'place-1',
              text: { text: 'Halifax, NS, Canada' },
            },
          },
          {
            queryPrediction: {
              text: { text: 'Halifax hotels' },
            },
          },
        ],
      }),
    } as Response);

    const result = await autocompleteGooglePlaces('Halifax', 'session-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.suggestions).toEqual([
        { placeId: 'place-1', description: 'Halifax, NS, Canada' },
      ]);
    }
  });

  it('resolveGooglePlaceLocation returns coordinates and truncated description', async () => {
    const longAddress = 'A'.repeat(YOUTUBE_LOCATION_DESCRIPTION_MAX_LENGTH + 20);
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        formattedAddress: longAddress,
        location: { latitude: 44.6488, longitude: -63.5752 },
      }),
    } as Response);

    const result = await resolveGooglePlaceLocation('place-1', 'session-1', 'Halifax, NS');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.location.latitude).toBe(44.6488);
      expect(result.location.longitude).toBe(-63.5752);
      expect(result.location.description).toHaveLength(YOUTUBE_LOCATION_DESCRIPTION_MAX_LENGTH);
    }
  });
});
