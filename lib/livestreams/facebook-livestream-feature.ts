import type { ConnectedAccountPlatform } from '@/types';

/**
 * When `true`, users can select Facebook in the livestream editor and schedule
 * Facebook-targeted livestreams. Set to `false` while Meta's Live API lacks a
 * viable persistent stream key workflow for encoder-based restreaming.
 */
export const FACEBOOK_LIVESTREAM_SCHEDULING_ENABLED = false;

/**
 * Whether Facebook livestream scheduling is exposed in the product UI and APIs.
 * @returns `true` when Facebook can be selected and scheduled for livestreams.
 */
export function isFacebookLivestreamSchedulingEnabled(): boolean {
  return FACEBOOK_LIVESTREAM_SCHEDULING_ENABLED;
}

/**
 * Target platforms that may remain selected while Facebook scheduling is disabled.
 * Preserves existing rows that already target Facebook without showing the toggle.
 * @param targets - Current livestream target platforms.
 * @returns Platforms to keep even when they are not schedulable.
 */
export function preserveDisabledLivestreamTargets(
  targets: readonly ConnectedAccountPlatform[]
): ConnectedAccountPlatform[] {
  if (isFacebookLivestreamSchedulingEnabled()) {
    return [];
  }
  return targets.includes('facebook') ? ['facebook'] : [];
}
