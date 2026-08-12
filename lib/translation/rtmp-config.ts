// =============================================================================
// Optional MediaMTX / RTMP public URL helpers
// =============================================================================

/**
 * Reads optional public RTMP host configuration for MediaMTX ingest.
 * Not required for browser mic ingest. No shared API keys live here.
 * @returns Host (and optional port) string, or null when unset.
 */
export function getTranslationRtmpPublicHost(): string | null {
  const host = process.env.TRANSLATION_RTMP_PUBLIC_HOST?.trim();
  return host || null;
}

/**
 * Internal RTSP base URL for the app to pull published paths from MediaMTX
 * (e.g. `rtsp://mediamtx:8554` on the Docker network).
 * @returns Base URL without trailing slash, or null when unset.
 */
export function getMediamtxRtspBase(): string | null {
  const base = process.env.TRANSLATION_MEDIAMTX_RTSP_BASE?.trim();
  if (!base) return null;
  return base.replace(/\/+$/, '');
}

/**
 * Shared secret for MediaMTX → app publisher webhooks (optional).
 * When unset, the publisher route rejects requests; RTMP auth can still start pullers.
 * @returns Secret string, or null when unset.
 */
export function getRtmpHookSecret(): string | null {
  const secret = process.env.TRANSLATION_RTMP_HOOK_SECRET?.trim();
  return secret || null;
}

/**
 * Path prefix used in RTMP/RTSP URLs (default `live`).
 * @returns Normalized path prefix without leading/trailing slashes.
 */
export function getTranslationRtmpPathPrefix(): string {
  return (process.env.TRANSLATION_RTMP_PATH_PREFIX?.trim() || 'live').replace(/^\/+|\/+$/g, '');
}

/**
 * Builds the owner-facing RTMP publish URL for a stream key when MediaMTX is configured.
 * @param streamKeyPlaintext - Plaintext stream key (only when freshly minted).
 * @returns Full rtmp:// URL, or null when RTMP host env is not set.
 */
export function buildRtmpPublishUrl(streamKeyPlaintext: string): string | null {
  const host = getTranslationRtmpPublicHost();
  if (!host) return null;
  const pathPrefix = getTranslationRtmpPathPrefix();
  // Allow host to include scheme or port (e.g. example.com:1935)
  if (host.startsWith('rtmp://') || host.startsWith('rtmps://')) {
    return `${host.replace(/\/+$/, '')}/${pathPrefix}/${streamKeyPlaintext}`;
  }
  return `rtmp://${host.replace(/\/+$/, '')}/${pathPrefix}/${streamKeyPlaintext}`;
}

/**
 * Builds the RTSP URL the app uses to pull a published MediaMTX path as PCM.
 * @param mtxPath - MediaMTX path (e.g. `live/<streamKey>` or bare stream key).
 * @returns Absolute RTSP URL, or null when RTSP base is not configured.
 */
export function buildMediamtxRtspUrl(mtxPath: string): string | null {
  const base = getMediamtxRtspBase();
  if (!base) return null;
  const cleaned = mtxPath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!cleaned) return null;
  return `${base}/${cleaned}`;
}

/**
 * Extracts the stream key segment from a MediaMTX path.
 * @param mtxPath - Path such as `live/abc123` or `abc123`.
 * @returns Last path segment, or empty string.
 */
export function streamKeyFromMtxPath(mtxPath: string): string {
  const segments = mtxPath.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

/**
 * Returns whether optional RTMP/MediaMTX public host env is present.
 * @returns True when TRANSLATION_RTMP_PUBLIC_HOST is set.
 */
export function isRtmpConfigured(): boolean {
  return getTranslationRtmpPublicHost() !== null;
}
