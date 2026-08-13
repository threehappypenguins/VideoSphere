import { describe, expect, it } from 'vitest';
import {
  CAPTION_FOLLOW_NEAR_EDGE_SLACK_PX,
  CAPTION_FOLLOW_SCROLL_UP_PX,
  captionFollowPinKey,
  isCaptionScrollTowardOlderContent,
  isNearCaptionLiveEdge,
} from '@/lib/translation/caption-follow';

describe('isNearCaptionLiveEdge', () => {
  it('treats the mid-pin resting place (distance ≈ pad) as near the edge', () => {
    expect(isNearCaptionLiveEdge(400, 400)).toBe(true);
    expect(isNearCaptionLiveEdge(400 + CAPTION_FOLLOW_NEAR_EDGE_SLACK_PX, 400)).toBe(true);
  });

  it('unfollows once the user scrolls above the pad by more than the slack', () => {
    expect(isNearCaptionLiveEdge(400 + CAPTION_FOLLOW_NEAR_EDGE_SLACK_PX + 1, 400)).toBe(false);
    expect(isNearCaptionLiveEdge(900, 400)).toBe(false);
  });

  it('uses a small threshold when there is no spacer yet', () => {
    expect(isNearCaptionLiveEdge(0, 0)).toBe(true);
    expect(isNearCaptionLiveEdge(CAPTION_FOLLOW_NEAR_EDGE_SLACK_PX, 0)).toBe(true);
    expect(isNearCaptionLiveEdge(CAPTION_FOLLOW_NEAR_EDGE_SLACK_PX + 1, 0)).toBe(false);
  });
});

describe('isCaptionScrollTowardOlderContent', () => {
  it('detects scrollTop decreases beyond the threshold', () => {
    expect(isCaptionScrollTowardOlderContent(200, 200 - CAPTION_FOLLOW_SCROLL_UP_PX)).toBe(true);
    expect(isCaptionScrollTowardOlderContent(200, 150)).toBe(true);
  });

  it('ignores tiny jitter and downward scroll', () => {
    expect(isCaptionScrollTowardOlderContent(200, 199)).toBe(false);
    expect(isCaptionScrollTowardOlderContent(200, 200)).toBe(false);
    expect(isCaptionScrollTowardOlderContent(200, 250)).toBe(false);
  });
});

describe('captionFollowPinKey', () => {
  it('keys partials by line count so text ticks do not re-pin', () => {
    expect(captionFollowPinKey(3, 'a', true)).toBe('partial:3');
    expect(captionFollowPinKey(3, 'a', true)).toBe(captionFollowPinKey(3, 'b', true));
  });

  it('keys finals by last line id', () => {
    expect(captionFollowPinKey(2, 'line-1', false)).toBe('line:line-1');
    expect(captionFollowPinKey(0, null, false)).toBe('empty:0');
  });
});
