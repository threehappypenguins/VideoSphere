// =============================================================================
// POST /api/livestreams/[id]/schedule — schedule a draft livestream on YouTube
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  isAllowedDraftThumbnailContentType,
  MAX_DRAFT_THUMBNAIL_BYTES,
} from '@/lib/draft-thumbnail';
import {
  decideKeySlotForNewSchedule,
  requireYouTubeStreamKeyForSlot,
} from '@/lib/livestreams/key-assignment';
import {
  requireYouTubeConnection,
  youtubeUpstreamErrorResponse,
} from '@/lib/platforms/youtube-api';
import {
  bindYouTubeBroadcastToStream,
  findYouTubeLiveStreamIdByKey,
  getYouTubeBroadcastLifecycleStatus,
  scheduleYouTubeLiveBroadcast,
  setYouTubeBroadcastSnippetMetadata,
  setYouTubeBroadcastVideoStatus,
  uploadYouTubeLivestreamThumbnail,
} from '@/lib/platforms/youtube-livestream-api';
import { addYouTubeVideoToPlaylists } from '@/lib/platforms/youtube';
import { getObjectWebStream, isLivestreamThumbnailFinalKeyForUser } from '@/lib/r2';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import {
  getLivestreamById,
  listArmedYouTubeLivestreamsForUser,
  updateLivestream,
  type UpdateLivestreamPatch,
} from '@/lib/repositories/livestreams';
import { persistUserYouTubePlatformDefaults } from '@/lib/platforms/youtube-user-defaults-persist';
import type {
  ApiError,
  ApiResponse,
  Livestream,
  LivestreamKeySlot,
  PlatformUploadVisibility,
} from '@/types';

interface ScheduleBody {
  scheduledStartTime?: unknown;
}

function parseScheduledStartTime(
  value: unknown
): { ok: true; iso: string } | { ok: false; message: string } {
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, message: 'scheduledStartTime is required' };
  }
  const trimmed = value.trim();
  const parsedMs = Date.parse(trimmed);
  if (Number.isNaN(parsedMs)) {
    return { ok: false, message: 'scheduledStartTime must be a parseable ISO datetime' };
  }
  return { ok: true, iso: new Date(parsedMs).toISOString() };
}

function toYouTubePrivacy(visibility: PlatformUploadVisibility): 'public' | 'unlisted' | 'private' {
  if (visibility === 'private') return 'private';
  if (visibility === 'unlisted') return 'unlisted';
  return 'public';
}

async function persistScheduleProgress(
  livestreamId: string,
  patch: UpdateLivestreamPatch
): Promise<void> {
  try {
    await updateLivestream(livestreamId, patch);
  } catch (err) {
    console.error('[POST /api/livestreams/:id/schedule] partial persist', err);
  }
}

/**
 * Handles POST requests for this route.
 * @param req - The incoming request object.
 * @param props - Route params.
 * @returns A response describing the request result.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  const { id: livestreamId } = await params;

  let livestream: Livestream | null;
  try {
    livestream = await getLivestreamById(livestreamId);
  } catch (err) {
    console.error('[POST /api/livestreams/:id/schedule] getLivestreamById', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to fetch livestream',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }

  if (!livestream || livestream.userId !== userId) {
    const errRes: ApiError = {
      error: 'Not Found',
      message: 'Livestream not found',
      statusCode: 404,
    };
    return NextResponse.json(errRes, { status: 404 });
  }

  if (livestream.status !== 'draft') {
    const errRes: ApiError = {
      error: 'Conflict',
      message: 'This livestream has already been scheduled.',
      statusCode: 409,
    };
    return NextResponse.json(errRes, { status: 409 });
  }

  let body: ScheduleBody;
  try {
    body = (await req.json()) as ScheduleBody;
  } catch {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'Invalid JSON body',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  const startParse = parseScheduledStartTime(body.scheduledStartTime);
  if (startParse.ok === false) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: startParse.message,
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (!livestream.targets.includes('youtube')) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'Livestream targets must include youtube to schedule on YouTube',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  const youtubeConnection = await requireYouTubeConnection(req);
  if (youtubeConnection.ok === false) {
    return youtubeConnection.response;
  }
  const accessToken = youtubeConnection.accessToken;

  const account = await getConnectedAccountWithTokens(userId, 'youtube');
  if (!account) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'YouTube is not connected',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  const armed = await listArmedYouTubeLivestreamsForUser(userId);
  const slotDecision = decideKeySlotForNewSchedule(
    armed.filter(
      (stream): stream is Livestream & { keySlot: LivestreamKeySlot } => stream.keySlot != null
    )
  );
  const keySlot = slotDecision.keySlot;

  const streamKeyResult = requireYouTubeStreamKeyForSlot(account, keySlot);
  if (streamKeyResult.ok === false) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: streamKeyResult.reason,
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }
  const streamKey = streamKeyResult.key;

  let broadcastId = livestream.youtubeBroadcastId?.trim() ?? '';
  let boundStreamId = livestream.youtubeBoundStreamId?.trim() ?? '';
  let youtubeDroppedTags: string[] = [];

  if (!broadcastId) {
    const scheduled = await scheduleYouTubeLiveBroadcast(accessToken, {
      title: livestream.title,
      description: livestream.description,
      scheduledStartTime: startParse.iso,
      privacyStatus: toYouTubePrivacy(livestream.visibility),
      madeForKids: livestream.platforms.youtube?.madeForKids,
    });
    if (scheduled.ok === false) {
      return youtubeUpstreamErrorResponse(scheduled.details);
    }
    broadcastId = scheduled.broadcastId;
    await persistScheduleProgress(livestreamId, { youtubeBroadcastId: broadcastId });
  }

  if (!boundStreamId) {
    const streamLookup = await findYouTubeLiveStreamIdByKey(accessToken, streamKey);
    if (streamLookup.ok === false) {
      await persistScheduleProgress(livestreamId, { youtubeBroadcastId: broadcastId });
      return youtubeUpstreamErrorResponse(streamLookup.details);
    }

    const bindResult = await bindYouTubeBroadcastToStream(
      accessToken,
      broadcastId,
      streamLookup.streamId
    );
    if (bindResult.ok === false) {
      await persistScheduleProgress(livestreamId, { youtubeBroadcastId: broadcastId });
      return youtubeUpstreamErrorResponse(bindResult.details);
    }

    boundStreamId = streamLookup.streamId;
    await persistScheduleProgress(livestreamId, {
      youtubeBroadcastId: broadcastId,
      youtubeBoundStreamId: boundStreamId,
    });
  }

  const ytPlatforms = livestream.platforms.youtube ?? {};
  const categoryId = ytPlatforms.categoryId?.trim();
  const defaultAudioLanguage = ytPlatforms.defaultAudioLanguage?.trim();
  const license =
    ytPlatforms.license === 'youtube' || ytPlatforms.license === 'creativeCommon'
      ? ytPlatforms.license
      : undefined;

  // Video status (privacy, license, embeddable) must be set before snippet metadata.
  const statusResult = await setYouTubeBroadcastVideoStatus(accessToken, broadcastId, {
    privacyStatus: toYouTubePrivacy(livestream.visibility),
    ...(license ? { license } : {}),
    ...(typeof ytPlatforms.embeddable === 'boolean' ? { embeddable: ytPlatforms.embeddable } : {}),
  });
  if (statusResult.ok === false) {
    await persistScheduleProgress(livestreamId, {
      youtubeBroadcastId: broadcastId,
      youtubeBoundStreamId: boundStreamId,
    });
    return youtubeUpstreamErrorResponse(statusResult.details);
  }

  if (defaultAudioLanguage || categoryId) {
    const snippetResult = await setYouTubeBroadcastSnippetMetadata(accessToken, broadcastId, {
      ...(defaultAudioLanguage ? { defaultAudioLanguage } : {}),
      ...(categoryId ? { categoryId } : {}),
    });
    if (snippetResult.ok === false) {
      await persistScheduleProgress(livestreamId, {
        youtubeBroadcastId: broadcastId,
        youtubeBoundStreamId: boundStreamId,
      });
      return youtubeUpstreamErrorResponse(snippetResult.details);
    }
  }

  const thumbKey = livestream.thumbnailR2Key?.trim();
  if (thumbKey && isLivestreamThumbnailFinalKeyForUser(thumbKey, userId, livestreamId)) {
    const draftCt = livestream.thumbnailContentType?.trim().toLowerCase();
    if (draftCt && !isAllowedDraftThumbnailContentType(draftCt)) {
      await persistScheduleProgress(livestreamId, {
        youtubeBroadcastId: broadcastId,
        youtubeBoundStreamId: boundStreamId,
      });
      const errRes: ApiError = {
        error: 'Bad Request',
        message: 'YouTube custom thumbnails must be JPEG or PNG.',
        statusCode: 400,
      };
      return NextResponse.json(errRes, { status: 400 });
    }

    let thumbStream: ReadableStream<Uint8Array>;
    let thumbLen: number;
    let thumbR2Ct: string;
    try {
      const opened = await getObjectWebStream(thumbKey);
      thumbStream = opened.stream;
      thumbLen = opened.contentLength;
      thumbR2Ct = opened.contentType?.trim().toLowerCase() ?? '';
    } catch (err) {
      console.error('[POST /api/livestreams/:id/schedule] thumbnail R2 read', err);
      await persistScheduleProgress(livestreamId, {
        youtubeBroadcastId: broadcastId,
        youtubeBoundStreamId: boundStreamId,
      });
      const errRes: ApiError = {
        error: 'Internal Server Error',
        message: 'Could not read thumbnail from storage for YouTube.',
        statusCode: 500,
      };
      return NextResponse.json(errRes, { status: 500 });
    }

    const resolvedCt =
      (draftCt && isAllowedDraftThumbnailContentType(draftCt) ? draftCt : null) ??
      (isAllowedDraftThumbnailContentType(thumbR2Ct) ? thumbR2Ct : 'image/jpeg');

    if (thumbLen <= 0 || thumbLen > MAX_DRAFT_THUMBNAIL_BYTES) {
      await thumbStream.cancel().catch(() => undefined);
      await persistScheduleProgress(livestreamId, {
        youtubeBroadcastId: broadcastId,
        youtubeBoundStreamId: boundStreamId,
      });
      const errRes: ApiError = {
        error: 'Bad Request',
        message: `Thumbnail must be between 1 and ${MAX_DRAFT_THUMBNAIL_BYTES} bytes`,
        statusCode: 400,
      };
      return NextResponse.json(errRes, { status: 400 });
    }

    const thumbBody = Buffer.from(await new Response(thumbStream).arrayBuffer());
    const thumbResult = await uploadYouTubeLivestreamThumbnail(
      accessToken,
      broadcastId,
      thumbBody,
      resolvedCt
    );
    if (thumbResult.ok === false) {
      await persistScheduleProgress(livestreamId, {
        youtubeBroadcastId: broadcastId,
        youtubeBoundStreamId: boundStreamId,
      });
      return youtubeUpstreamErrorResponse(thumbResult.details);
    }
  }

  const ytPlatformsForPlaylists = livestream.platforms.youtube;
  const hasPlaylistIds = (ytPlatformsForPlaylists?.playlistIds?.length ?? 0) > 0;
  const hasPlaylistTitles = (ytPlatformsForPlaylists?.playlistTitles?.length ?? 0) > 0;
  if (hasPlaylistIds || hasPlaylistTitles) {
    const playlistResult = await addYouTubeVideoToPlaylists(accessToken, broadcastId, {
      playlistIds: ytPlatformsForPlaylists?.playlistIds,
      playlistTitles: ytPlatformsForPlaylists?.playlistTitles,
      visibility: livestream.visibility,
    });
    if (playlistResult.ok === false) {
      await persistScheduleProgress(livestreamId, {
        youtubeBroadcastId: broadcastId,
        youtubeBoundStreamId: boundStreamId,
      });
      const errRes: ApiError = {
        error: 'Bad Gateway',
        message: playlistResult.error.message,
        statusCode: 502,
      };
      return NextResponse.json(errRes, { status: 502 });
    }
  }

  // Tags must be applied last: earlier snippet updates (category, language) re-fetch the
  // video without tags and would clear them if we sent tags before those updates.
  if (livestream.tags.length > 0) {
    const tagsResult = await setYouTubeBroadcastSnippetMetadata(accessToken, broadcastId, {
      tags: livestream.tags,
    });
    if (tagsResult.ok === false) {
      await persistScheduleProgress(livestreamId, {
        youtubeBroadcastId: broadcastId,
        youtubeBoundStreamId: boundStreamId,
      });
      return youtubeUpstreamErrorResponse(tagsResult.details);
    }
    if (tagsResult.droppedTags.length > 0) {
      youtubeDroppedTags = tagsResult.droppedTags;
      console.warn(
        '[POST /api/livestreams/:id/schedule] YouTube omitted tags after update:',
        tagsResult.droppedTags
      );
    }
  }

  const lifecycleResult = await getYouTubeBroadcastLifecycleStatus(accessToken, broadcastId);
  const youtubeLifecycleStatus =
    lifecycleResult.ok === true ? (lifecycleResult.lifeCycleStatus ?? 'ready') : 'ready';

  try {
    const updated = await updateLivestream(livestreamId, {
      status: 'scheduled',
      scheduledStartTime: startParse.iso,
      keySlot,
      youtubeBroadcastId: broadcastId,
      youtubeBoundStreamId: boundStreamId,
      youtubeLifecycleStatus,
    });

    if (!updated) {
      const errRes: ApiError = {
        error: 'Not Found',
        message: 'Livestream not found',
        statusCode: 404,
      };
      return NextResponse.json(errRes, { status: 404 });
    }

    await persistUserYouTubePlatformDefaults(userId, livestream.platforms.youtube);

    const response: ApiResponse<Livestream> = {
      data: updated,
      message:
        youtubeDroppedTags.length > 0
          ? `Livestream scheduled. YouTube did not keep these tags: ${youtubeDroppedTags.join(', ')}`
          : 'Livestream scheduled',
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error('[POST /api/livestreams/:id/schedule] final update', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to update livestream after scheduling',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
