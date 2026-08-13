// =============================================================================
// Caption list “follow live edge” helpers (mid-viewport pin)
// =============================================================================

/**
 * Slack past the mid-viewport spacer that still counts as “at the live edge”.
 * Kept small so scrolling up a few lines pauses follow; resume requires returning
 * near the pinned position (not merely within half the viewport).
 */
export const CAPTION_FOLLOW_NEAR_EDGE_SLACK_PX = 72;

/**
 * Scroll-top decrease (px) that counts as the user moving toward older content.
 * Small enough to catch a finger flick; ignores sub-pixel jitter.
 */
export const CAPTION_FOLLOW_SCROLL_UP_PX = 2;

/**
 * Whether the scroll position is still at the live caption edge.
 *
 * With a bottom spacer of `followPadPx`, the pinned resting place has
 * `distanceFromBottom ≈ followPadPx`. Anything meaningfully above that means
 * the listener scrolled into older captions.
 * @param distanceFromBottom - `scrollHeight - scrollTop - clientHeight`.
 * @param followPadPx - Height of the mid-viewport spacer below the live line.
 * @param slackPx - Extra pixels allowed below the pad before unfollow.
 * @returns True when auto-follow should stay (or resume) on.
 */
export function isNearCaptionLiveEdge(
  distanceFromBottom: number,
  followPadPx: number,
  slackPx: number = CAPTION_FOLLOW_NEAR_EDGE_SLACK_PX
): boolean {
  const pad = Math.max(0, followPadPx);
  const slack = Math.max(0, slackPx);
  return distanceFromBottom <= pad + slack;
}

/**
 * Whether a scrollTop change means the user moved toward older captions / the page header.
 * @param previousScrollTop - Last observed `scrollTop`.
 * @param nextScrollTop - Current `scrollTop`.
 * @param thresholdPx - Minimum decrease to count as intentional.
 * @returns True when follow should pause.
 */
export function isCaptionScrollTowardOlderContent(
  previousScrollTop: number,
  nextScrollTop: number,
  thresholdPx: number = CAPTION_FOLLOW_SCROLL_UP_PX
): boolean {
  return previousScrollTop - nextScrollTop >= thresholdPx;
}

/**
 * Stable key for when auto-follow should re-pin the live line.
 * Changes when a new final line appears or a partial utterance starts — not on
 * every partial text edit (which would fight mobile touch scrolling).
 * @param lineCount - Number of finalized caption lines.
 * @param lastLineId - Id of the newest finalized line, or null.
 * @param hasPartial - Whether an in-progress partial is shown.
 * @returns Pin identity string.
 */
export function captionFollowPinKey(
  lineCount: number,
  lastLineId: string | null,
  hasPartial: boolean
): string {
  if (hasPartial) return `partial:${lineCount}`;
  return lastLineId ? `line:${lastLineId}` : `empty:${lineCount}`;
}

/**
 * Scrolls `root` so `el` is vertically centered in the root’s viewport.
 * Uses only `root.scrollTop` — never `scrollIntoView`, which on mobile can
 * scroll the wrong ancestor and yank the page after the user scrolled up.
 * @param root - Page scroll container.
 * @param el - Live caption element to pin.
 * @param behavior - Instant or smooth scroll.
 */
export function pinElementInScrollRoot(
  root: HTMLElement,
  el: HTMLElement,
  behavior: ScrollBehavior = 'smooth'
): void {
  const rootRect = root.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const elCenter = elRect.top + elRect.height / 2;
  const rootCenter = rootRect.top + rootRect.height / 2;
  const nextTop = root.scrollTop + (elCenter - rootCenter);
  const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
  const clamped = Math.max(0, Math.min(maxTop, nextTop));
  if (typeof root.scrollTo === 'function') {
    root.scrollTo({ top: clamped, behavior });
  } else {
    root.scrollTop = clamped;
  }
}
