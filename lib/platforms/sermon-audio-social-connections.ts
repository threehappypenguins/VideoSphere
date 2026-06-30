import {
  SERMONAUDIO_API_BASE,
  assertSermonAudioHttpOk,
  resolveSermonAudioApiUrl,
  sermonAudioJsonHeaders,
  SermonAudioUpstreamHttpError,
} from '@/lib/platforms/sermon-audio-http';
import type { SermonAudioCrossPublishTarget } from '@/types';

/** SermonAudio dashboard page where Cross Publish OAuth connections are managed. */
export const SERMONAUDIO_SOCIAL_CONNECTIONS_DASHBOARD_URL =
  'https://www.sermonaudio.com/dashboard/account/connections/';

/** OAuth connection status for one Cross Publish destination. */
export interface SermonAudioSocialConnectionPlatformStatus {
  /** When true, the platform is linked for Cross Publish in the SermonAudio dashboard. */
  connected: boolean;
  /** Connected account or page name from SermonAudio, when available. */
  displayName?: string;
}

/**
 * Cross Publish OAuth connection status keyed by VideoSphere destination id.
 * Populated from SermonAudio `POST .../refresh_social` (`google` → YouTube, `twitter` → X).
 */
export interface SermonAudioCrossPublishSocialConnections {
  /** YouTube (`google` in SermonAudio refresh_social response). */
  youtube: SermonAudioSocialConnectionPlatformStatus;
  /** Facebook. */
  facebook: SermonAudioSocialConnectionPlatformStatus;
  /** X / Twitter (`twitter` in SermonAudio refresh_social response). */
  x: SermonAudioSocialConnectionPlatformStatus;
}

function parseHasOAuth(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return (value as Record<string, unknown>).hasOAUTH === true;
}

function parseConnectionDisplayName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const pageName = typeof record.pageName === 'string' ? record.pageName.trim() : '';
  const username = typeof record.username === 'string' ? record.username.trim() : '';
  return name || pageName || username || undefined;
}

/**
 * Parses SermonAudio `refresh_social` JSON into Cross Publish connection flags.
 * @param body - Raw upstream JSON body.
 * @returns Connection status for YouTube, Facebook, and X.
 */
export function parseSermonAudioRefreshSocialResponse(
  body: unknown
): SermonAudioCrossPublishSocialConnections {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

  return {
    youtube: {
      connected: parseHasOAuth(raw.google),
      displayName: parseConnectionDisplayName(raw.google),
    },
    facebook: {
      connected: parseHasOAuth(raw.facebook),
      displayName: parseConnectionDisplayName(raw.facebook),
    },
    x: {
      connected: parseHasOAuth(raw.twitter),
      displayName: parseConnectionDisplayName(raw.twitter),
    },
  };
}

/**
 * Builds the SermonAudio `refresh_social` URL for a broadcaster.
 * @param broadcasterId - SermonAudio broadcaster id.
 * @returns Resolved HTTPS URL.
 */
export function sermonAudioRefreshSocialUrl(broadcasterId: string): string {
  const path =
    `${SERMONAUDIO_API_BASE}/v2/node/broadcasters/${encodeURIComponent(broadcasterId)}` +
    '/refresh_social?cacheLanguage=en&cacheMax=181&cacheDomain=www.sermonaudio.com';
  const url = resolveSermonAudioApiUrl(path);
  if (!url) {
    throw new SermonAudioUpstreamHttpError('Invalid SermonAudio refresh_social URL', 500);
  }
  return url;
}

/**
 * Fetches Cross Publish OAuth connection status from SermonAudio.
 * Uses undocumented `POST .../refresh_social` (dashboard parity; works with API key).
 * @param apiKey - SermonAudio API key for the connected account.
 * @param broadcasterId - SermonAudio broadcaster id.
 * @returns Connection status per Cross Publish destination.
 */
export async function fetchSermonAudioCrossPublishSocialConnections(
  apiKey: string,
  broadcasterId: string
): Promise<SermonAudioCrossPublishSocialConnections> {
  const response = await fetch(sermonAudioRefreshSocialUrl(broadcasterId), {
    method: 'POST',
    headers: sermonAudioJsonHeaders(apiKey),
    cache: 'no-store',
    redirect: 'error',
  });

  await assertSermonAudioHttpOk(response, 'SermonAudio refresh_social failed');
  const body: unknown = await response.json();
  return parseSermonAudioRefreshSocialResponse(body);
}

/**
 * Returns whether a Cross Publish destination is OAuth-connected in SermonAudio.
 * @param connections - Parsed connection status from `fetchSermonAudioCrossPublishSocialConnections`.
 * @param destinationId - Cross Publish destination id from draft metadata.
 * @returns True when the platform is linked in the SermonAudio dashboard.
 */
export function sermonAudioCrossPublishDestinationConnected(
  connections: SermonAudioCrossPublishSocialConnections,
  destinationId: SermonAudioCrossPublishTarget
): boolean {
  return connections[destinationId].connected;
}
