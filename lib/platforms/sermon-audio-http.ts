/** SermonAudio REST API origin. */
export const SERMONAUDIO_API_BASE = 'https://api.sermonaudio.com';

const SERMONAUDIO_API_HOSTNAME = new URL(SERMONAUDIO_API_BASE).hostname;

function isSermonAudioHostname(hostname: string): boolean {
  return hostname === 'sermonaudio.com' || hostname.endsWith('.sermonaudio.com');
}

/**
 * Resolves a SermonAudio API path or URL for server-side `fetch`.
 * Rejects absolute URLs whose hostname is not the configured SermonAudio API host.
 * Rejects URLs that include embedded credentials and non-default HTTPS ports.
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

  if (resolved.username !== '' || resolved.password !== '') {
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
 * Validates an untrusted media upload URL from the SermonAudio API for server-side `fetch`.
 * Accepts only absolute HTTPS URLs on the SermonAudio domain with the default port.
 * @param rawUrl - Upload URL from a SermonAudio media create response.
 * @returns Normalized HTTPS URL, or `null` when the input is invalid or untrusted.
 */
export function resolveSermonAudioUploadUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (trimmed === '') {
    return null;
  }

  let resolved: URL;
  try {
    resolved = new URL(trimmed);
  } catch {
    return null;
  }

  if (resolved.protocol !== 'https:') {
    return null;
  }

  if (!isSermonAudioHostname(resolved.hostname)) {
    return null;
  }

  if (resolved.username !== '' || resolved.password !== '') {
    return null;
  }

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

/**
 * Thrown when a SermonAudio upstream HTTP response is not OK.
 * @property status - Upstream HTTP status code.
 * @property details - Optional upstream response body text.
 */
export class SermonAudioUpstreamHttpError extends Error {
  readonly status: number;
  readonly details?: string;

  /**
   * @param message - Human-readable failure summary.
   * @param status - Upstream HTTP status code.
   * @param details - Optional upstream response body text.
   */
  constructor(message: string, status: number, details?: string) {
    super(message);
    this.name = 'SermonAudioUpstreamHttpError';
    this.status = status;
    this.details = details;
  }
}

/**
 * Ensures a SermonAudio HTTP response succeeded before parsing JSON.
 * @param response - Upstream SermonAudio fetch response.
 * @param message - Error prefix when the response is not OK.
 * @throws {@link SermonAudioUpstreamHttpError} When `response.ok` is false.
 */
export async function assertSermonAudioHttpOk(response: Response, message: string): Promise<void> {
  if (response.ok) {
    return;
  }

  const details = await response.text().catch(() => undefined);
  throw new SermonAudioUpstreamHttpError(message, response.status, details);
}

/**
 * Returns whether an upstream status indicates invalid or revoked SermonAudio credentials.
 * @param status - Upstream HTTP status code.
 * @returns `true` for auth-related upstream failures.
 */
export function isSermonAudioCredentialsFailure(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}

/**
 * Maps an upstream SermonAudio HTTP status to an appropriate proxy response status.
 * @param upstreamStatus - Upstream HTTP status code.
 * @returns HTTP status for the VideoSphere API response.
 */
export function sermonAudioUpstreamResponseStatus(upstreamStatus: number): number {
  if (upstreamStatus === 429 || upstreamStatus === 503) {
    return 503;
  }
  return 502;
}
