/** SermonAudio REST API origin. */
export const SERMONAUDIO_API_BASE = 'https://api.sermonaudio.com';

const SERMONAUDIO_API_HOSTNAME = new URL(SERMONAUDIO_API_BASE).hostname;

/**
 * Resolves a SermonAudio API path or URL for server-side `fetch`.
 * Rejects absolute URLs whose hostname is not the configured SermonAudio API host.
 * Rejects non-default HTTPS ports and normalizes explicit `:443` away.
 * Always normalizes the result to HTTPS on the default port.
 * @param pathOrUrl - Relative API path or absolute SermonAudio API URL (e.g. pagination `next`).
 * @returns Resolved HTTPS URL, or `null` when the input is invalid or untrusted.
 */
export function resolveSermonAudioApiUrl(pathOrUrl: string): string | null {
  const trimmed = pathOrUrl.trim();
  if (trimmed === '') {
    return null;
  }

  let resolved: URL;
  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      resolved = new URL(trimmed);
    } else if (trimmed.startsWith('/')) {
      resolved = new URL(trimmed, SERMONAUDIO_API_BASE);
    } else {
      return null;
    }
  } catch {
    return null;
  }

  if (resolved.hostname !== SERMONAUDIO_API_HOSTNAME) {
    return null;
  }

  resolved.protocol = 'https:';

  const port = resolved.port;
  if (port !== '' && port !== '443') {
    return null;
  }

  resolved.port = '';
  return resolved.toString();
}

/**
 * Builds standard JSON request headers for SermonAudio API calls.
 * @param apiKey - Stored SermonAudio API key for the connected account.
 * @returns Header map for `fetch`.
 */
export function sermonAudioJsonHeaders(apiKey: string): Record<string, string> {
  return {
    'X-Api-Key': apiKey,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}
