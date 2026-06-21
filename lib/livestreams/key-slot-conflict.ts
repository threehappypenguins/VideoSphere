import type { Livestream, LivestreamKeySlot } from '@/types';

/**
 * Summary of another armed livestream already using a key slot.
 * @property id - Conflicting livestream row id.
 * @property title - Display title for warnings.
 * @property keySlot - Slot already in use (`main` or `temp`).
 */
export interface LivestreamKeySlotConflict {
  id: string;
  title: string;
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
 * User-facing warning when switching to a key slot already used by another scheduled livestream.
 * Wording follows YouTube's "multiple streams using the same stream key" notice.
 * @param conflict - Conflicting livestream summary.
 * @returns Warning copy shown before applying the change anyway.
 */
export function livestreamKeySlotConflictWarning(conflict: LivestreamKeySlotConflict): string {
  const slotLabel = conflict.keySlot === 'main' ? 'main' : 'temporary';
  return `"${conflict.title}" is already scheduled with the ${slotLabel} stream key. YouTube may detect multiple streams using the same stream key.`;
}
