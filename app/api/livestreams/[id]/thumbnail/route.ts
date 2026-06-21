import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { deleteObject, isLivestreamThumbnailFinalKeyForUser } from '@/lib/r2';
import {
  getLivestreamById,
  updateLivestream,
  LivestreamDocumentTooLargeError,
} from '@/lib/repositories/livestreams';

/**
 * DELETE /api/livestreams/[id]/thumbnail — remove a draft thumbnail from R2 before scheduling.
 */
export async function DELETE(
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

  const livestream = await getLivestreamById(livestreamId);
  if (!livestream || livestream.userId !== userId) {
    return NextResponse.json(
      { error: 'Not Found', message: 'Livestream not found', statusCode: 404 },
      { status: 404 }
    );
  }

  if (livestream.status !== 'draft') {
    return NextResponse.json(
      {
        error: 'Conflict',
        message: 'Cannot remove a thumbnail after the livestream has been scheduled on YouTube.',
        statusCode: 409,
      },
      { status: 409 }
    );
  }

  const key =
    livestream.thumbnailR2Key &&
    isLivestreamThumbnailFinalKeyForUser(livestream.thumbnailR2Key, userId, livestreamId)
      ? livestream.thumbnailR2Key
      : null;

  if (!key && !livestream.thumbnailR2Key) {
    return NextResponse.json({ data: livestream, message: 'Thumbnail removed' });
  }

  // Clear stored thumbnail fields first. If updateLivestream fails the R2 object is still intact and the
  // client can retry. The reverse ordering (R2 delete first) is worse: a successful R2 delete
  // followed by a failed updateLivestream leaves the livestream referencing a now-deleted object.
  try {
    const updated = await updateLivestream(livestreamId, {
      thumbnailR2Key: null,
      thumbnailContentType: null,
    });
    if (!updated) {
      return NextResponse.json(
        { error: 'Not Found', message: 'Livestream not found', statusCode: 404 },
        { status: 404 }
      );
    }
    if (key) {
      await deleteObject(key).catch((e) => {
        console.error('[DELETE /api/livestreams/:id/thumbnail] delete object', e);
      });
    }
    return NextResponse.json({ data: updated, message: 'Thumbnail removed' });
  } catch (err) {
    if (err instanceof LivestreamDocumentTooLargeError) {
      return NextResponse.json(
        { error: 'Bad Request', message: err.message, statusCode: 400 },
        { status: 400 }
      );
    }
    throw err;
  }
}
