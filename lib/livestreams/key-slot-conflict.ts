import type { Livestream, LivestreamKeySlot } from '@/types';

/**
 * Summary of another armed livestream blocking a single-platform arm slot.
 * @property id - Conflicting livestream row id.
 * @property title - Display title for warnings.
 */
export interface LivestreamArmConflict {
  id: string;
  title: string;
}

/**
 * Summary of another armed livestream already using a key slot.
 * @property id - Conflicting livestream row id.
 * @property title - Display title for warnings.
 * @property keySlot - Slot already in use (`main` or `temp`).
 */
export interface LivestreamKeySlotConflict extends LivestreamArmConflict {
  keySlot: LivestreamKeySlot;
}

function displayTitle(livestream: Pick<Livestream, 'title'>): string {
  return livestream.title.trim() || 'Untitled livestream';
}

/**
 * Finds another scheduled or live livestream already assigned to the target key slot.
 * @param armedLivestreams - Armed livestreams for the same user.
 * @param slot - Desired key slot.
 * @param excludeLivestreamId - Livestream being edited.
 * @returns Conflict summary when another row holds the slot, otherwise `null`.
 */
export function findLivestreamKeySlotConflict(
  armedLivestreams: readonly Pick<Livestream, 'id' | 'title' | 'keySlot' | 'status'>[],
  slot: LivestreamKeySlot,
  excludeLivestreamId: string
): LivestreamKeySlotConflict | null {
  const conflict = armedLivestreams.find(
    (row) =>
      row.id !== excludeLivestreamId &&
      row.keySlot === slot &&
      (row.status === 'scheduled' || row.status === 'live')
  );

  if (!conflict) {
    return null;
  }

  return {
    id: conflict.id,
    title: displayTitle(conflict),
    keySlot: slot,
  };
}

/**
 * Returns conflict metadata when another Facebook livestream is already armed for this user.
 * @param armedFacebookLivestream - Currently armed Facebook livestream, if any.
 * @param excludeLivestreamId - Livestream being armed.
 * @returns Conflict summary when another row is armed, otherwise `null`.
 */
export function findFacebookLivestreamArmConflict(
  armedFacebookLivestream: Pick<Livestream, 'id' | 'title'> | null,
  excludeLivestreamId: string
): LivestreamArmConflict | null {
  if (!armedFacebookLivestream || armedFacebookLivestream.id === excludeLivestreamId) {
    return null;
  }

  return {
    id: armedFacebookLivestream.id,
    title: displayTitle(armedFacebookLivestream),
  };
}

/**
 * User-facing warning when arming Facebook while another livestream is already armed.
 * @param conflict - Conflicting livestream summary.
 * @returns Warning copy shown before applying the arm anyway.
 */
export function livestreamFacebookArmConflictWarning(conflict: LivestreamArmConflict): string {
  return `"${conflict.title}" is already armed for Facebook livestreaming. Only one Facebook stream can be armed at a time.`;
}

/**
 * User-facing warning when switching to a key slot already used by another scheduled livestream.
 * Wording follows YouTube's "multiple streams using the same stream key" notice.
 * @param conflict - Conflicting livestream summary.
 * @returns Warning copy shown before applying the change anyway.
 */
export function livestreamKeySlotConflictWarning(conflict: LivestreamKeySlotConflict): string {
  const slotLabel = conflict.keySlot === 'main' ? 'main' : 'temporary';
  return `"${conflict.title}" is already scheduled with the ${slotLabel} stream key. YouTube may detect multiple streams using the same stream key.`;
}
