/** SermonAudio REST API origin. */
export const SERMONAUDIO_API_BASE = 'https://api.sermonaudio.com';

/**
 * Builds standard JSON request headers for SermonAudio API calls.
 * @param apiKey - Stored SermonAudio API key for the connected account.
 * @returns Header map for `fetch`.
 */
export function sermonAudioJsonHeaders(apiKey: string): Record<string, string> {
  return {
    'X-Api-Key': apiKey,
    Accept: 'application/json',
  };
}
