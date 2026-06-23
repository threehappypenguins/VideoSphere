/**
 * Splits a Facebook RTMPS ingest URL into server URL and stream key segments.
 * @param streamUrl - Full ingest URL (`…/rtmp/FB-…`).
 * @returns Parsed segments when the URL contains `/rtmp/`; `serverUrl` includes the `/rtmp/` path for encoders.
 */
export function splitFacebookRtmpIngestUrl(
  streamUrl: string
): { serverUrl: string; streamKey: string } | null {
  const trimmed = streamUrl.trim();
  const marker = '/rtmp/';
  const index = trimmed.indexOf(marker);
  if (index === -1) {
    return null;
  }

  const serverUrl = trimmed.slice(0, index + marker.length);
  const streamKey = trimmed.slice(index + marker.length);
  if (!serverUrl || !streamKey) {
    return null;
  }

  return { serverUrl, streamKey };
}
