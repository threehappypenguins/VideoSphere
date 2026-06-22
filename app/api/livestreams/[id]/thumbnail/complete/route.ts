import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  fileExtensionForThumbnailContentType,
  isAllowedDraftThumbnailContentType,
  MAX_DRAFT_THUMBNAIL_BYTES,
} from '@/lib/draft-thumbnail';
import { livestreamWithThumbnailPreview } from '@/lib/livestreams/livestream-thumbnail-preview';
import { shouldSyncLivestreamMetadataToYouTube } from '@/lib/livestreams/livestream-edit-policy';
import { syncLivestreamMetadataToYouTube } from '@/lib/livestreams/sync-youtube-broadcast';
import {
  requireYouTubeConnection,
  youtubeUpstreamErrorResponse,
} from '@/lib/platforms/youtube-api';
import {
  buildLivestreamThumbnailFinalKey,
  copyObjectInBucket,
  deleteObject,
  headObjectMetadata,
  isLivestreamThumbnailPendingKeyForUser,
  R2ObjectNotFoundError,
  isLivestreamThumbnailFinalKeyForUser,
} from '@/lib/r2';
import {
  getLivestreamById,
  updateLivestream,
  LivestreamDocumentTooLargeError,
} from '@/lib/repositories/livestreams';

interface CompleteBody {
  pendingKey?: unknown;
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
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Not authenticated', statusCode: 401 },
      { status: 401 }
    );
  }

  const { id: livestreamId } = await params;

  let body: CompleteBody;
  try {
    body = (await req.json()) as CompleteBody;
  } catch {
    return NextResponse.json(
      { error: 'Bad Request', message: 'Invalid JSON body', statusCode: 400 },
      { status: 400 }
    );
  }

  const pendingKey = typeof body.pendingKey === 'string' ? body.pendingKey.trim() : '';
  if (!pendingKey || !isLivestreamThumbnailPendingKeyForUser(pendingKey, userId, livestreamId)) {
    return NextResponse.json(
      {
        error: 'Bad Request',
        message: 'pendingKey is invalid for this livestream',
        statusCode: 400,
      },
      { status: 400 }
    );
  }

  const livestream = await getLivestreamById(livestreamId);
  if (!livestream || livestream.userId !== userId) {
    return NextResponse.json(
      { error: 'Not Found', message: 'Livestream not found', statusCode: 404 },
      { status: 404 }
    );
  }

  if (
    livestream.status !== 'draft' &&
    livestream.status !== 'scheduled' &&
    livestream.status !== 'live'
  ) {
    return NextResponse.json(
      {
        error: 'Conflict',
        message: 'Cannot change the thumbnail after the livestream has ended.',
        statusCode: 409,
      },
      { status: 409 }
    );
  }

  let size: number;
  let headContentType: string | undefined;
  try {
    const meta = await headObjectMetadata(pendingKey);
    size = meta.contentLength;
    headContentType = meta.contentType?.trim().toLowerCase();
  } catch (err) {
    if (err instanceof R2ObjectNotFoundError) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'Uploaded thumbnail not found in storage',
          statusCode: 400,
        },
        { status: 400 }
      );
    }
    console.error('[POST /api/livestreams/:id/thumbnail/complete] headObjectMetadata', err);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to verify thumbnail in storage',
        statusCode: 500,
      },
      { status: 500 }
    );
  }

  if (size <= 0 || size > MAX_DRAFT_THUMBNAIL_BYTES) {
    await deleteObject(pendingKey).catch(() => undefined);
    return NextResponse.json(
      {
        error: 'Bad Request',
        message: `Thumbnail must be between 1 and ${MAX_DRAFT_THUMBNAIL_BYTES} bytes`,
        statusCode: 400,
      },
      { status: 400 }
    );
  }

  const ext = pendingKey.includes('.') ? (pendingKey.split('.').pop() ?? 'jpg') : 'jpg';
  const fallbackFromExt = ext === 'png' ? 'image/png' : 'image/jpeg';
  const resolvedType =
    headContentType && isAllowedDraftThumbnailContentType(headContentType)
      ? headContentType
      : fallbackFromExt;
  if (!isAllowedDraftThumbnailContentType(resolvedType)) {
    await deleteObject(pendingKey).catch(() => undefined);
    return NextResponse.json(
      { error: 'Bad Request', message: 'Thumbnail must be JPG or PNG', statusCode: 400 },
      { status: 400 }
    );
  }

  const finalKey = buildLivestreamThumbnailFinalKey(
    userId,
    livestreamId,
    randomUUID(),
    fileExtensionForThumbnailContentType(resolvedType)
  );

  const previousKey = livestream.thumbnailR2Key;

  try {
    await copyObjectInBucket(pendingKey, finalKey);
  } catch (err) {
    console.error('[POST /api/livestreams/:id/thumbnail/complete] copy', err);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to finalize thumbnail', statusCode: 500 },
      { status: 500 }
    );
  }

  try {
    const updated = await updateLivestream(livestreamId, {
      thumbnailR2Key: finalKey,
      thumbnailContentType: resolvedType,
    });
    if (!updated) {
      await deleteObject(finalKey).catch(() => undefined);
      return NextResponse.json(
        { error: 'Not Found', message: 'Livestream not found', statusCode: 404 },
        { status: 404 }
      );
    }

    // Pending object cleaned up only after the livestream update is confirmed so that
    // a transient persistence failure leaves the pending key intact for a retry.
    await deleteObject(pendingKey).catch((e) => {
      console.error('[POST /api/livestreams/:id/thumbnail/complete] delete pending', e);
    });

    if (
      previousKey &&
      previousKey !== finalKey &&
      isLivestreamThumbnailFinalKeyForUser(previousKey, userId, livestreamId)
    ) {
      await deleteObject(previousKey).catch((e) => {
        console.error('[POST /api/livestreams/:id/thumbnail/complete] delete previous', e);
      });
    }

    let responseLivestream = updated;

    if (shouldSyncLivestreamMetadataToYouTube(updated)) {
      const youtubeConnection = await requireYouTubeConnection(req);
      if (youtubeConnection.ok === false) {
        return youtubeConnection.response;
      }

      const syncResult = await syncLivestreamMetadataToYouTube(
        youtubeConnection.accessToken,
        userId,
        livestreamId,
        updated
      );
      if (syncResult.ok === false) {
        return youtubeUpstreamErrorResponse(syncResult.details);
      }

      responseLivestream = (await getLivestreamById(livestreamId)) ?? updated;
    }

    const data = await livestreamWithThumbnailPreview(responseLivestream, userId, livestreamId);

    return NextResponse.json({
      data,
      message:
        updated.status === 'scheduled' || updated.status === 'live'
          ? 'Thumbnail updated on YouTube'
          : 'Thumbnail saved',
    });
  } catch (err) {
    await deleteObject(finalKey).catch(() => undefined);
    if (err instanceof LivestreamDocumentTooLargeError) {
      return NextResponse.json(
        { error: 'Bad Request', message: err.message, statusCode: 400 },
        { status: 400 }
      );
    }
    throw err;
  }
}
