const PASSTHROUGH_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
] as const;

/**
 * Proxies a ranged media request to a YouTube CDN URL for browser preview playback.
 * @param upstreamUrl - Direct media URL from yt-dlp.
 * @param rangeHeader - Optional HTTP Range request header from the browser.
 * @returns Upstream response body and status streamed to the client.
 */
export async function fetchProxiedPreviewMedia(
  upstreamUrl: string,
  rangeHeader: string | null
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: '*/*',
  };

  if (rangeHeader) {
    headers.Range = rangeHeader;
  }

  const upstream = await fetch(upstreamUrl, {
    headers,
    redirect: 'follow',
  });

  const responseHeaders = new Headers();
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) {
      responseHeaders.set(name, value);
    }
  }
  responseHeaders.set('Cache-Control', 'no-store');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
