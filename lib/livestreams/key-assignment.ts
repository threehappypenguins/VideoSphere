import type { ConnectedAccount, LivestreamKeySlot } from '@/types';

/** Minutes before scheduled start when a temp-slot livestream may be promoted to main. */
export const TEMP_TO_MAIN_PROMOTION_WINDOW_MS = 30 * 60 * 1000;

/**
 * Only one livestream is ever actually being streamed to at a time. The very first scheduled
 * livestream gets the main key. Every livestream scheduled after that gets the same temporary
 * key — they are queued, not concurrent — and each one is promoted to the main key in turn (see
 * `shouldPromoteTempToMain`) once the livestream ahead of it has ended and its own start time
 * is approaching. There is intentionally no cap on how many livestreams can be scheduled
 * this way.
 *
 * @param armed - Currently armed livestreams (each holding a main or temp key slot).
 * @returns Assigned key slot for a newly scheduled livestream.
 */
export function decideKeySlotForNewSchedule(armed: { keySlot: LivestreamKeySlot }[]): {
  ok: true;
  keySlot: LivestreamKeySlot;
} {
  if (armed.length === 0) {
    return { ok: true, keySlot: 'main' };
  }
  return { ok: true, keySlot: 'temp' };
}

/**
 * Picks the temp-slot livestream with the earliest scheduled start (next in line for main-key promotion).
 * @param tempSlotStreams - Armed temp-slot livestreams for one user.
 * @returns The earliest candidate, or null when the list is empty.
 */
export function pickNextTempCandidateForPromotion(
  tempSlotStreams: { id: string; scheduledStartTime: string }[]
): { id: string; scheduledStartTime: string } | null {
  if (tempSlotStreams.length === 0) return null;

  let best: { id: string; scheduledStartTime: string } | null = null;
  let bestTime = Number.POSITIVE_INFINITY;

  for (const stream of tempSlotStreams) {
    const parsed = Date.parse(stream.scheduledStartTime);
    const timeMs = Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
    if (timeMs < bestTime) {
      bestTime = timeMs;
      best = stream;
    }
  }

  return best;
}

/**
 * Returns whether a temp-slot livestream should be promoted to the main key slot now.
 * @param input - Next temp candidate and the current main-slot holder (if any).
 * @param now - Current time (injected for testability).
 * @returns True when the main slot is free and the candidate start is within the promotion window.
 */
export function shouldPromoteTempToMain(
  input: {
    tempCandidate: { scheduledStartTime: string };
    currentMainSlotStream: { youtubeLifecycleStatus?: string } | null;
  },
  now: Date
): boolean {
  const mainIsFree =
    input.currentMainSlotStream == null ||
    input.currentMainSlotStream.youtubeLifecycleStatus?.trim() === 'complete';

  if (!mainIsFree) return false;

  const startMs = Date.parse(input.tempCandidate.scheduledStartTime);
  if (Number.isNaN(startMs)) return false;

  return startMs - now.getTime() <= TEMP_TO_MAIN_PROMOTION_WINDOW_MS;
}

/**
 * Resolves the decrypted YouTube stream key for a slot from a connected account.
 * @param account - Server-side connected account including decrypted stream keys.
 * @param slot - Target key slot (`main` or `temp`).
 * @returns Plaintext stream key, or a user-facing reason when the key is missing.
 */
export function requireYouTubeStreamKeyForSlot(
  account: ConnectedAccount,
  slot: LivestreamKeySlot
): { ok: true; key: string } | { ok: false; reason: string } {
  const key =
    slot === 'main'
      ? (account.youtubeMainStreamKey?.trim() ?? '')
      : (account.youtubeTempStreamKey?.trim() ?? '');

  if (key.length > 0) {
    return { ok: true, key };
  }

  if (slot === 'main') {
    return {
      ok: false,
      reason: 'Add a main stream key on the Connections page before scheduling a livestream.',
    };
  }

  return {
    ok: false,
    reason:
      'Add a temporary stream key on the Connections page before scheduling another livestream.',
  };
}
