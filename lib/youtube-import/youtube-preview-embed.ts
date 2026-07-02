/**
 * Builds the iframe `src` URL for a YouTube preview embed with API controls enabled.
 * @param youtubeVideoId - 11-character YouTube video id.
 * @param pageOrigin - Fully-qualified origin of the page hosting the embed.
 * @returns YouTube embed URL including `origin` and `widget_referrer`.
 */
export function buildYouTubePreviewEmbedUrl(youtubeVideoId: string, pageOrigin: string): string {
  const url = new URL(`https://www.youtube.com/embed/${youtubeVideoId}`);
  url.searchParams.set('enablejsapi', '1');
  url.searchParams.set('origin', pageOrigin);
  url.searchParams.set('widget_referrer', pageOrigin);
  url.searchParams.set('rel', '0');
  url.searchParams.set('modestbranding', '1');
  url.searchParams.set('playsinline', '1');
  return url.toString();
}
