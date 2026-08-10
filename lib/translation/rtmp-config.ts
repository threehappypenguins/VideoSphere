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
 * Builds the owner-facing RTMP publish URL for a stream key when MediaMTX is configured.
 * @param streamKeyPlaintext - Plaintext stream key (only when freshly minted).
 * @returns Full rtmp:// URL, or null when RTMP host env is not set.
 */
export function buildRtmpPublishUrl(streamKeyPlaintext: string): string | null {
  const host = getTranslationRtmpPublicHost();
  if (!host) return null;
  const pathPrefix = (process.env.TRANSLATION_RTMP_PATH_PREFIX?.trim() || 'live').replace(
    /^\/+|\/+$/g,
    ''
  );
  // Allow host to include scheme or port (e.g. example.com:1935)
  if (host.startsWith('rtmp://') || host.startsWith('rtmps://')) {
    return `${host.replace(/\/+$/, '')}/${pathPrefix}/${streamKeyPlaintext}`;
  }
  return `rtmp://${host.replace(/\/+$/, '')}/${pathPrefix}/${streamKeyPlaintext}`;
}

/**
 * Returns whether optional RTMP/MediaMTX public host env is present.
 * @returns True when TRANSLATION_RTMP_PUBLIC_HOST is set.
 */
export function isRtmpConfigured(): boolean {
  return getTranslationRtmpPublicHost() !== null;
}
