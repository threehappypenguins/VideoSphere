import {
  findLivestreamKeySlotConflict,
  type LivestreamKeySlotConflict,
} from '@/lib/livestreams/key-slot-conflict';
import { requireYouTubeStreamKeyForSlot } from '@/lib/livestreams/key-assignment';
import {
  bindYouTubeBroadcastToStream,
  findYouTubeLiveStreamIdByKey,
} from '@/lib/platforms/youtube-livestream-api';
import { updateLivestream } from '@/lib/repositories/livestreams';
import type { ConnectedAccount, Livestream, LivestreamKeySlot } from '@/types';

/**
 * Result of changing a scheduled livestream's YouTube key slot.
 * @property livestream - Updated livestream row.
 * @property conflict - Another armed livestream already using the target slot, if any.
 */
export type ChangeLivestreamKeySlotResult =
  | {
      ok: true;
      livestream: Livestream;
      conflict: LivestreamKeySlotConflict | null;
    }
  | { ok: false; details: string };

/**
 * Switches a scheduled livestream between the main and temporary YouTube stream keys and rebinds YouTube.
 * @param accessToken - OAuth access token with YouTube live scopes.
 * @param account - Connected YouTube account with decrypted stream keys.
 * @param livestream - Livestream row to update (must be scheduled with a broadcast id).
 * @param armedLivestreams - Other armed livestreams for conflict detection.
 * @param nextSlot - Target key slot.
 * @returns Updated row and optional conflict metadata, or upstream error details.
 */
export async function changeLivestreamKeySlot(
  accessToken: string,
  account: ConnectedAccount,
  livestream: Livestream,
  armedLivestreams: readonly Livestream[],
  nextSlot: LivestreamKeySlot
): Promise<ChangeLivestreamKeySlotResult> {
  if (livestream.status !== 'scheduled') {
    return { ok: false, details: 'Only scheduled livestreams can change stream keys.' };
  }

  const broadcastId = livestream.youtubeBroadcastId?.trim();
  if (!broadcastId) {
    return { ok: false, details: 'Livestream is not linked to a YouTube broadcast.' };
  }

  const currentSlot = livestream.keySlot;
  if (currentSlot === nextSlot) {
    return {
      ok: true,
      livestream,
      conflict: findLivestreamKeySlotConflict(armedLivestreams, nextSlot, livestream.id),
    };
  }

  const streamKeyResult = requireYouTubeStreamKeyForSlot(account, nextSlot);
  if (streamKeyResult.ok === false) {
    return { ok: false, details: streamKeyResult.reason };
  }

  const conflict = findLivestreamKeySlotConflict(armedLivestreams, nextSlot, livestream.id);

  const streamLookup = await findYouTubeLiveStreamIdByKey(accessToken, streamKeyResult.key);
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
    keySlot: nextSlot,
    youtubeBoundStreamId: streamLookup.streamId,
    keySwapPromotedAt: null,
  });

  if (!updated) {
    return { ok: false, details: 'Livestream not found.' };
  }

  return { ok: true, livestream: updated, conflict };
}
