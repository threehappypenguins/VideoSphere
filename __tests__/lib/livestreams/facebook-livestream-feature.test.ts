import { describe, expect, it } from 'vitest';
import {
  FACEBOOK_LIVESTREAM_SCHEDULING_ENABLED,
  isFacebookLivestreamSchedulingEnabled,
  preserveDisabledLivestreamTargets,
} from '@/lib/livestreams/facebook-livestream-feature';

describe('facebook livestream feature flag', () => {
  it('is disabled until Meta live API limitations are resolved', () => {
    expect(FACEBOOK_LIVESTREAM_SCHEDULING_ENABLED).toBe(false);
    expect(isFacebookLivestreamSchedulingEnabled()).toBe(false);
  });

  it('preserves existing facebook targets while scheduling is disabled', () => {
    expect(preserveDisabledLivestreamTargets(['youtube', 'facebook'])).toEqual(['facebook']);
    expect(preserveDisabledLivestreamTargets(['youtube'])).toEqual([]);
  });
});
