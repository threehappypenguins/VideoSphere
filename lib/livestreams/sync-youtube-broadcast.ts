import {
  isAllowedDraftThumbnailContentType,
  MAX_DRAFT_THUMBNAIL_BYTES,
} from '@/lib/draft-thumbnail';
import { resolveYouTubeCategoryIdForLivestreamSync } from '@/lib/livestreams/resolve-youtube-livestream-sync-fields';
import { cleanupLivestreamThumbnailAfterYouTubeSync } from '@/lib/livestreams/cleanup-livestream-thumbnail-after-youtube-sync';
import {
  setYouTubeBroadcastSnippetMetadata,
  setYouTubeBroadcastVideoStatus,
  updateYouTubeLiveBroadcast,
  uploadYouTubeLivestreamThumbnail,
} from '@/lib/platforms/youtube-livestream-api';
import { addYouTubeVideoToPlaylists } from '@/lib/platforms/youtube';
import { getObjectWebStream, isLivestreamThumbnailFinalKeyForUser } from '@/lib/r2';
import { getUserById } from '@/lib/repositories/users';
import type { Livestream, PlatformUploadVisibility } from '@/types';

/**
 * Result of pushing livestream metadata to an existing YouTube broadcast.
 * @property droppedTags - Tags YouTube omitted after the final snippet update.
 */
export type SyncLivestreamToYouTubeResult =
  | { ok: true; droppedTags: string[] }
  | { ok: false; details: string };

function toYouTubePrivacy(visibility: PlatformUploadVisibility): 'public' | 'unlisted' | 'private' {
  if (visibility === 'private') return 'private';
  if (visibility === 'unlisted') return 'unlisted';
  return 'public';
}

/**
 * Pushes editable livestream metadata to an existing YouTube live broadcast.
 * Used after initial scheduling and on subsequent PATCH saves while still pre-live.
 * @param accessToken - OAuth access token with YouTube write scope.
 * @param userId - Owner user id (thumbnail key validation).
 * @param livestreamId - VideoSphere livestream row id.
 * @param livestream - Current livestream document to sync.
 * @returns Success with any dropped tags, or upstream error details.
 */
export async function syncLivestreamMetadataToYouTube(
  accessToken: string,
  userId: string,
  livestreamId: string,
  livestream: Livestream
): Promise<SyncLivestreamToYouTubeResult> {
  const broadcastId = livestream.youtubeBroadcastId?.trim();
  if (!broadcastId) {
    return { ok: false, details: 'Livestream is not linked to a YouTube broadcast.' };
  }

  const ytPlatforms = livestream.platforms.youtube ?? {};
  const user = await getUserById(userId);
  const categoryId = resolveYouTubeCategoryIdForLivestreamSync(
    ytPlatforms,
    user?.platformDefaults?.youtube
  );
  const defaultAudioLanguage = ytPlatforms.defaultAudioLanguage?.trim();
  const license =
    ytPlatforms.license === 'youtube' || ytPlatforms.license === 'creativeCommon'
      ? ytPlatforms.license
      : undefined;

  const broadcastUpdate = await updateYouTubeLiveBroadcast(accessToken, broadcastId, {
    title: livestream.title,
    description: livestream.description,
    ...(livestream.scheduledStartTime ? { scheduledStartTime: livestream.scheduledStartTime } : {}),
    privacyStatus: toYouTubePrivacy(livestream.visibility),
    madeForKids: ytPlatforms.madeForKids,
  });
  if (broadcastUpdate.ok === false) {
    return broadcastUpdate;
  }

  const statusResult = await setYouTubeBroadcastVideoStatus(accessToken, broadcastId, {
    privacyStatus: toYouTubePrivacy(livestream.visibility),
    ...(license ? { license } : {}),
    ...(typeof ytPlatforms.embeddable === 'boolean' ? { embeddable: ytPlatforms.embeddable } : {}),
  });
  if (statusResult.ok === false) {
    return statusResult;
  }

  const snippetResult = await setYouTubeBroadcastSnippetMetadata(accessToken, broadcastId, {
    categoryId,
    ...(defaultAudioLanguage ? { defaultAudioLanguage } : {}),
  });
  if (snippetResult.ok === false) {
    return snippetResult;
  }

  const thumbKey = livestream.thumbnailR2Key?.trim();
  if (thumbKey && isLivestreamThumbnailFinalKeyForUser(thumbKey, userId, livestreamId)) {
    const draftCt = livestream.thumbnailContentType?.trim().toLowerCase();
    if (draftCt && !isAllowedDraftThumbnailContentType(draftCt)) {
      return {
        ok: false,
        details: 'YouTube custom thumbnails must be JPEG or PNG.',
      };
    }

    let thumbStream: ReadableStream<Uint8Array>;
    let thumbLen: number;
    let thumbR2Ct: string;
    try {
      const opened = await getObjectWebStream(thumbKey);
      thumbStream = opened.stream;
      thumbLen = opened.contentLength;
      thumbR2Ct = opened.contentType?.trim().toLowerCase() ?? '';
    } catch {
      return { ok: false, details: 'Could not read thumbnail from storage for YouTube.' };
    }

    const resolvedCt =
      (draftCt && isAllowedDraftThumbnailContentType(draftCt) ? draftCt : null) ??
      (isAllowedDraftThumbnailContentType(thumbR2Ct) ? thumbR2Ct : 'image/jpeg');

    if (thumbLen <= 0 || thumbLen > MAX_DRAFT_THUMBNAIL_BYTES) {
      await thumbStream.cancel().catch(() => undefined);
      return {
        ok: false,
        details: `Thumbnail must be between 1 and ${MAX_DRAFT_THUMBNAIL_BYTES} bytes`,
      };
    }

    const thumbBody = Buffer.from(await new Response(thumbStream).arrayBuffer());
    const thumbResult = await uploadYouTubeLivestreamThumbnail(
      accessToken,
      broadcastId,
      thumbBody,
      resolvedCt
    );
    if (thumbResult.ok === false) {
      return thumbResult;
    }

    const cleanupError = await cleanupLivestreamThumbnailAfterYouTubeSync(
      userId,
      livestreamId,
      thumbKey,
      thumbResult.thumbnailUrl,
      new Date().toISOString()
    );
    if (cleanupError) {
      return { ok: false, details: cleanupError };
    }
  }

  const hasPlaylistIds = (ytPlatforms.playlistIds?.length ?? 0) > 0;
  const hasPlaylistTitles = (ytPlatforms.playlistTitles?.length ?? 0) > 0;
  if (livestream.status === 'draft' && (hasPlaylistIds || hasPlaylistTitles)) {
    const playlistResult = await addYouTubeVideoToPlaylists(accessToken, broadcastId, {
      playlistIds: ytPlatforms.playlistIds,
      playlistTitles: ytPlatforms.playlistTitles,
      visibility: livestream.visibility,
    });
    if (playlistResult.ok === false) {
      return { ok: false, details: playlistResult.error.message };
    }
  }

  let droppedTags: string[] = [];
  if (livestream.tags.length > 0) {
    const tagsResult = await setYouTubeBroadcastSnippetMetadata(accessToken, broadcastId, {
      categoryId,
      tags: livestream.tags,
    });
    if (tagsResult.ok === false) {
      return tagsResult;
    }
    droppedTags = tagsResult.droppedTags;
  }

  return { ok: true, droppedTags };
}
