import type { UpdateLivestreamPatch } from '@/lib/repositories/livestreams';
import type { YouTubeLiveBroadcastPullMetadata } from '@/lib/platforms/youtube-livestream-api';
import { localStatusForYouTubeLifecycle } from '@/lib/livestreams/youtube-lifecycle';
import type { Livestream, PlatformUploadVisibility, YouTubeLivestreamFields } from '@/types';

function tagsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((tag, index) => tag === b[index]);
}

function playlistMembershipEqual(
  currentIds: readonly string[] | undefined,
  currentTitles: readonly string[] | undefined,
  nextIds: readonly string[],
  nextTitles: readonly string[]
): boolean {
  return tagsEqual(currentIds ?? [], nextIds) && tagsEqual(currentTitles ?? [], nextTitles);
}

/**
 * Builds a partial livestream update from metadata fetched on YouTube.
 * YouTube is treated as the source of truth on pull — only changed fields are included.
 * @param livestream - Current local livestream row.
 * @param metadata - Metadata from {@link getYouTubeLiveBroadcastMetadata}.
 * @returns Patch to apply, or `null` when the local row already matches YouTube.
 */
export function buildLivestreamPatchFromYouTubeMetadata(
  livestream: Livestream,
  metadata: YouTubeLiveBroadcastPullMetadata
): UpdateLivestreamPatch | null {
  const patch: UpdateLivestreamPatch = {};
  const youtubePatch: Partial<YouTubeLivestreamFields> = {};
  let hasChanges = false;

  if (metadata.title !== livestream.title) {
    patch.title = metadata.title;
    hasChanges = true;
  }

  if (metadata.description !== livestream.description) {
    patch.description = metadata.description;
    hasChanges = true;
  }

  if (!tagsEqual(metadata.tags, livestream.tags)) {
    patch.tags = [...metadata.tags];
    hasChanges = true;
  }

  const nextVisibility = metadata.privacyStatus as PlatformUploadVisibility;
  if (nextVisibility !== livestream.visibility) {
    patch.visibility = nextVisibility;
    hasChanges = true;
  }

  if (metadata.scheduledStartTime) {
    const currentStart = livestream.scheduledStartTime?.trim() ?? '';
    if (metadata.scheduledStartTime !== currentStart) {
      patch.scheduledStartTime = metadata.scheduledStartTime;
      hasChanges = true;
    }
  }

  const nextLifecycle = metadata.lifeCycleStatus;
  const currentLifecycle = livestream.youtubeLifecycleStatus ?? null;
  if (nextLifecycle !== currentLifecycle) {
    patch.youtubeLifecycleStatus = nextLifecycle;
    hasChanges = true;
  }

  const nextStatus = localStatusForYouTubeLifecycle(nextLifecycle);
  if (nextStatus !== undefined && nextStatus !== livestream.status) {
    patch.status = nextStatus;
    hasChanges = true;
  }

  const currentYoutube = livestream.platforms.youtube ?? {};

  if (metadata.categoryId && metadata.categoryId !== (currentYoutube.categoryId?.trim() ?? '')) {
    youtubePatch.categoryId = metadata.categoryId;
    hasChanges = true;
  }

  if (
    metadata.defaultAudioLanguage &&
    metadata.defaultAudioLanguage !== (currentYoutube.defaultAudioLanguage?.trim() ?? '')
  ) {
    youtubePatch.defaultAudioLanguage = metadata.defaultAudioLanguage;
    hasChanges = true;
  }

  if (
    typeof metadata.madeForKids === 'boolean' &&
    metadata.madeForKids !== currentYoutube.madeForKids
  ) {
    youtubePatch.madeForKids = metadata.madeForKids;
    hasChanges = true;
  }

  if (metadata.license && metadata.license !== currentYoutube.license) {
    youtubePatch.license = metadata.license;
    hasChanges = true;
  }

  if (
    typeof metadata.embeddable === 'boolean' &&
    metadata.embeddable !== currentYoutube.embeddable
  ) {
    youtubePatch.embeddable = metadata.embeddable;
    hasChanges = true;
  }

  if (
    metadata.playlistIds !== undefined &&
    metadata.playlistTitles !== undefined &&
    !playlistMembershipEqual(
      currentYoutube.playlistIds,
      currentYoutube.playlistTitles,
      metadata.playlistIds,
      metadata.playlistTitles
    )
  ) {
    youtubePatch.playlistIds = [...metadata.playlistIds];
    youtubePatch.playlistTitles = [...metadata.playlistTitles];
    hasChanges = true;
  }

  if (Object.keys(youtubePatch).length > 0) {
    patch.platformsPatch = { youtube: youtubePatch };
  }

  return hasChanges ? patch : null;
}
