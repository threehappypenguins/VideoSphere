import { requireYouTubeStreamKeyForSlot } from '@/lib/livestreams/key-assignment';
import {
  bindYouTubeBroadcastToStream,
  findYouTubeLiveStreamIdByKey,
} from '@/lib/platforms/youtube-livestream-api';
import { updateLivestream } from '@/lib/repositories/livestreams';
import type { ConnectedAccount, Livestream } from '@/types';

/**
 * Whether the main key slot is free, actively blocking promotion, or eligible for stale release.
 * Evaluated only when a temp-slot livestream reaches its auto-promote window.
 * @property free - No armed main holder, or YouTube reports the broadcast complete.
 * @property blocked - Main holder is live, testing, or not yet due for the slot.
 * @property stale - Main holder has never gone live on YouTube (still ready/created).
 */
export type MainSlotPromotionState = 'free' | 'blocked' | 'stale';

type MainSlotSnapshot = Pick<
  Livestream,
  'status' | 'scheduledStartTime' | 'youtubeLifecycleStatus' | 'keySlot'
>;

/**
 * Returns true when a temp candidate's scheduled start is within the promotion lead time.
 * @param tempCandidate - Temp-slot livestream awaiting promotion.
 * @param now - Current time.
 * @param promotionWindowMs - Lead time before start in milliseconds.
 * @returns True when promotion timing has been reached.
 */
export function isWithinTempPromotionWindow(
  tempCandidate: { scheduledStartTime: string },
  now: Date,
  promotionWindowMs: number
): boolean {
  const startMs = Date.parse(tempCandidate.scheduledStartTime);
  if (Number.isNaN(startMs)) {
    return false;
  }
  return startMs - now.getTime() <= promotionWindowMs;
}

/**
 * Returns true when YouTube still shows the main-slot broadcast as never having gone live.
 * @param mainSlotStream - Main-slot livestream snapshot with a fresh lifecycle poll.
 * @returns True when lifecycle is `ready`, `created`, or unset.
 */
export function mainSlotNeverWentLive(mainSlotStream: MainSlotSnapshot): boolean {
  if (mainSlotStream.keySlot !== 'main' || mainSlotStream.status !== 'scheduled') {
    return false;
  }

  const lifecycle = mainSlotStream.youtubeLifecycleStatus?.trim().toLowerCase() ?? '';
  if (lifecycle === 'live' || lifecycle === 'testing' || lifecycle === 'complete') {
    return false;
  }

  return lifecycle === 'ready' || lifecycle === 'created' || lifecycle === '';
}

/**
 * Classifies the current main-slot holder when a temp stream reaches its auto-promote window.
 * Call only after polling YouTube for the main holder's current lifecycle status.
 * @param mainSlotStream - Armed main-slot livestream, if any.
 * @param now - Current time; used only to avoid releasing a main stream before its scheduled start.
 * @returns Whether the slot is free, blocked, or stale.
 */
export function classifyMainSlotForPromotion(
  mainSlotStream: MainSlotSnapshot | null,
  now: Date
): MainSlotPromotionState {
  if (!mainSlotStream || mainSlotStream.keySlot !== 'main') {
    return 'free';
  }

  const lifecycle = mainSlotStream.youtubeLifecycleStatus?.trim().toLowerCase() ?? '';

  if (lifecycle === 'complete') {
    return 'free';
  }

  if (lifecycle === 'live' || lifecycle === 'testing') {
    return 'blocked';
  }

  const startMs = Date.parse(mainSlotStream.scheduledStartTime ?? '');
  if (!Number.isNaN(startMs) && startMs > now.getTime()) {
    return 'blocked';
  }

  if (mainSlotNeverWentLive(mainSlotStream)) {
    return 'stale';
  }

  return 'blocked';
}

/**
 * Returns true when a stale release should run for a never-live main-slot row.
 * Intended to be called only after {@link classifyMainSlotForPromotion} returns `stale`.
 * @param mainSlotStream - Main-slot livestream snapshot with a fresh lifecycle poll.
 * @returns True when the main slot should be released for promotion.
 */
export function shouldReleaseStaleMainSlot(mainSlotStream: MainSlotSnapshot): boolean {
  return mainSlotNeverWentLive(mainSlotStream);
}

/**
 * Result of releasing a stale main-slot livestream back to the temp key.
 * @property livestream - Updated stale row.
 */
export type ReleaseStaleMainSlotResult =
  | { ok: true; livestream: Livestream }
  | { ok: false; details: string };

/**
 * Moves a never-live main-slot broadcast off the main key: rebinds YouTube to temp, marks the
 * row ended, and records {@link Livestream.keySlotStaleAt}.
 * @param accessToken - OAuth access token with YouTube live scopes.
 * @param account - Connected YouTube account with decrypted stream keys.
 * @param livestream - Stale main-slot livestream to release.
 * @param now - Timestamp stored on the row.
 * @returns Updated livestream row or upstream error details.
 */
export async function releaseStaleMainSlot(
  accessToken: string,
  account: ConnectedAccount,
  livestream: Livestream,
  now: Date
): Promise<ReleaseStaleMainSlotResult> {
  if (!shouldReleaseStaleMainSlot(livestream)) {
    return { ok: false, details: 'Livestream is not eligible for stale main-slot release.' };
  }

  const broadcastId = livestream.youtubeBroadcastId?.trim();
  if (!broadcastId) {
    return { ok: false, details: 'Livestream is not linked to a YouTube broadcast.' };
  }

  const tempKeyResult = requireYouTubeStreamKeyForSlot(account, 'temp');
  if (tempKeyResult.ok === false) {
    return { ok: false, details: tempKeyResult.reason };
  }

  const streamLookup = await findYouTubeLiveStreamIdByKey(accessToken, tempKeyResult.key);
  if (streamLookup.ok === false) {
    return { ok: false, details: streamLookup.details };
  }

  const bindResult = await bindYouTubeBroadcastToStream(
    accessToken,
    broadcastId,
    streamLookup.streamId
  );
  if (bindResult.ok === false) {
    return { ok: false, details: bindResult.details };
  }

  const updated = await updateLivestream(livestream.id, {
    status: 'ended',
    keySlot: 'temp',
    keySlotStaleAt: now.toISOString(),
    youtubeBoundStreamId: streamLookup.streamId,
    keySwapPromotedAt: null,
  });

  if (!updated) {
    return { ok: false, details: 'Livestream not found.' };
  }

  return { ok: true, livestream: updated };
}
