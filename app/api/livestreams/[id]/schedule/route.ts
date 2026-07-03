// =============================================================================
// POST /api/livestreams/[id]/schedule — schedule a draft livestream locally and on YouTube
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  decideKeySlotForNewSchedule,
  requireYouTubeStreamKeyForSlot,
} from '@/lib/livestreams/key-assignment';
import { syncLivestreamMetadataToYouTube } from '@/lib/livestreams/sync-youtube-broadcast';
import { resolveAutoPromoteToMainKeyMinutes } from '@/lib/livestreams/auto-promote-main-key';
import { armFacebookLivestream } from '@/lib/livestreams/arm-facebook-livestream';
import {
  decideFacebookArmForNewSchedule,
  facebookDeferredArmDisabledMessage,
} from '@/lib/livestreams/facebook-arm-assignment';
import { syncFacebookDeferredArmSchedule } from '@/lib/livestreams/facebook-deferred-arm-scheduler';
import { isFacebookLivestreamSchedulingEnabled } from '@/lib/livestreams/facebook-livestream-feature';
import {
  requireYouTubeConnection,
  youtubeUpstreamErrorResponse,
} from '@/lib/platforms/youtube-api';
import {
  bindYouTubeBroadcastToStream,
  findYouTubeLiveStreamIdByKey,
  getYouTubeBroadcastLifecycleStatus,
  scheduleYouTubeLiveBroadcast,
} from '@/lib/platforms/youtube-livestream-api';
import { resolveFacebookPageId } from '@/lib/platforms/facebook-oauth';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import {
  getArmedFacebookLivestreamForUser,
  getLivestreamById,
  listArmedYouTubeLivestreamsForUser,
  listScheduledOrLiveFacebookLivestreamsForUser,
  updateLivestream,
  type UpdateLivestreamPatch,
} from '@/lib/repositories/livestreams';
import { syncTempToMainPromotionSchedule } from '@/lib/livestreams/temp-to-main-promotion-scheduler';
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

async function rollbackScheduleToDraft(livestreamId: string): Promise<void> {
  try {
    await updateLivestream(livestreamId, { status: 'draft' });
  } catch (err) {
    console.error(
      '[POST /api/livestreams/:id/schedule] failed to roll back livestream to draft after Facebook arm failure',
      err
    );
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

  if (!livestream.targets.includes('youtube') && !livestream.targets.includes('facebook')) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'Livestream targets must include youtube or facebook to schedule',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  const targetsYouTube = livestream.targets.includes('youtube');
  const targetsFacebook = livestream.targets.includes('facebook');

  if (targetsFacebook && !isFacebookLivestreamSchedulingEnabled()) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'Facebook livestreaming is temporarily unavailable.',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  let facebookArmDecision: ReturnType<typeof decideFacebookArmForNewSchedule> | null = null;
  if (targetsFacebook) {
    const otherFacebookLivestreams = await listScheduledOrLiveFacebookLivestreamsForUser(
      userId,
      livestreamId
    );
    facebookArmDecision = decideFacebookArmForNewSchedule(otherFacebookLivestreams);
    if (facebookArmDecision.kind === 'deferred' && livestream.autoPromoteToMainKey === false) {
      const errRes: ApiError = {
        error: 'Bad Request',
        message: facebookDeferredArmDisabledMessage(),
        statusCode: 400,
      };
      return NextResponse.json(errRes, { status: 400 });
    }
  }

  let keySlot: LivestreamKeySlot | undefined;
  let broadcastId = '';
  let boundStreamId = '';
  let youtubeLifecycleStatus: string | undefined;

  if (targetsYouTube) {
    const youtubeConnection = await requireYouTubeConnection(req, { forceRefresh: true });
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
    keySlot = slotDecision.keySlot;

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

    broadcastId = livestream.youtubeBroadcastId?.trim() ?? '';
    boundStreamId = livestream.youtubeBoundStreamId?.trim() ?? '';

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

    const syncResult = await syncLivestreamMetadataToYouTube(accessToken, userId, livestreamId, {
      ...livestream,
      youtubeBroadcastId: broadcastId,
      ...(boundStreamId ? { youtubeBoundStreamId: boundStreamId } : {}),
    });
    if (syncResult.ok === false) {
      await persistScheduleProgress(livestreamId, {
        youtubeBroadcastId: broadcastId,
        youtubeBoundStreamId: boundStreamId,
      });
      return youtubeUpstreamErrorResponse(syncResult.details);
    }

    const youtubeDroppedTags = syncResult.droppedTags;
    if (youtubeDroppedTags.length > 0) {
      console.warn(
        '[POST /api/livestreams/:id/schedule] YouTube omitted tags after update:',
        youtubeDroppedTags
      );
    }

    const lifecycleResult = await getYouTubeBroadcastLifecycleStatus(accessToken, broadcastId);
    youtubeLifecycleStatus =
      lifecycleResult.ok === true ? (lifecycleResult.lifeCycleStatus ?? 'ready') : 'ready';
  }

  let facebookImmediateArm: { pageAccessToken: string; pageId: string } | null = null;
  if (targetsFacebook && facebookArmDecision?.kind === 'immediate') {
    const facebookAccount = await getConnectedAccountWithTokens(userId, 'facebook');
    if (!facebookAccount) {
      const errRes: ApiError = {
        error: 'Unauthorized',
        message: 'Facebook is not connected',
        statusCode: 401,
      };
      return NextResponse.json(errRes, { status: 401 });
    }

    let pageAccessToken: string;
    try {
      const tokens = await refreshTokenIfNeeded(facebookAccount);
      pageAccessToken = tokens.accessToken.trim();
    } catch (err) {
      console.error('[POST /api/livestreams/:id/schedule] Facebook token refresh failed', err);
      const errRes: ApiError = {
        error: 'Unauthorized',
        message: 'Facebook access token expired. Reconnect Facebook in Settings → Connections.',
        statusCode: 401,
      };
      return NextResponse.json(errRes, { status: 401 });
    }

    const pageId = resolveFacebookPageId(facebookAccount);
    if (!pageId) {
      const errRes: ApiError = {
        error: 'Bad Request',
        message:
          'Facebook livestreaming requires a connected Facebook Page. Reconnect and select a Page in Settings → Connections.',
        statusCode: 400,
      };
      return NextResponse.json(errRes, { status: 400 });
    }

    facebookImmediateArm = { pageAccessToken, pageId };
  }

  try {
    const schedulePatch: UpdateLivestreamPatch = {
      status: 'scheduled',
      scheduledStartTime: startParse.iso,
      ...(targetsYouTube
        ? {
            keySlot,
            youtubeBroadcastId: broadcastId,
            youtubeBoundStreamId: boundStreamId,
            youtubeLifecycleStatus,
            ...(keySlot === 'temp'
              ? {
                  autoPromoteToMainKey: livestream.autoPromoteToMainKey !== false,
                  autoPromoteToMainKeyMinutes: resolveAutoPromoteToMainKeyMinutes(livestream),
                }
              : {}),
          }
        : {}),
      ...(targetsFacebook && facebookArmDecision?.kind === 'deferred'
        ? {
            autoPromoteToMainKey: livestream.autoPromoteToMainKey !== false,
            autoPromoteToMainKeyMinutes: resolveAutoPromoteToMainKeyMinutes(livestream),
          }
        : {}),
    };

    let updated = await updateLivestream(livestreamId, schedulePatch);

    if (!updated) {
      const errRes: ApiError = {
        error: 'Not Found',
        message: 'Livestream not found',
        statusCode: 404,
      };
      return NextResponse.json(errRes, { status: 404 });
    }

    if (targetsYouTube) {
      await persistUserYouTubePlatformDefaults(userId, livestream.platforms.youtube);
      syncTempToMainPromotionSchedule(updated);
    }

    if (targetsFacebook && facebookArmDecision) {
      if (facebookImmediateArm) {
        const armedFacebookLivestream = await getArmedFacebookLivestreamForUser(userId);
        const armResult = await armFacebookLivestream(
          facebookImmediateArm.pageAccessToken,
          facebookImmediateArm.pageId,
          updated,
          armedFacebookLivestream
        );
        if (armResult.ok === false) {
          await rollbackScheduleToDraft(livestreamId);
          if (armResult.statusCode === 502) {
            const errRes: ApiError = {
              error: 'Bad Gateway',
              message: armResult.details,
              statusCode: 502,
            };
            return NextResponse.json(errRes, { status: 502 });
          }
          const errRes: ApiError = {
            error: armResult.statusCode === 409 ? 'Conflict' : 'Bad Request',
            message: armResult.details,
            statusCode: armResult.statusCode,
          };
          return NextResponse.json(errRes, { status: armResult.statusCode });
        }
        updated = armResult.livestream;
      } else {
        syncFacebookDeferredArmSchedule(updated);
      }
    }

    const response: ApiResponse<Livestream> = {
      data: updated,
      message: 'Livestream scheduled',
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
