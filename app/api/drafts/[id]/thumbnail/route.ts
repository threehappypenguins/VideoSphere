import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { isDraftThumbnailPlatform, type DraftThumbnailPlatform } from '@/lib/draft-thumbnail';
import { DraftDocumentTooLargeError } from '@/lib/draft-upload-metadata';
import { deleteObject, isDraftThumbnailFinalKeyForUser } from '@/lib/r2';
import { getDraftById, updateDraft } from '@/lib/repositories/drafts';

/**
 * DELETE /api/drafts/[id]/thumbnail — remove custom thumbnail from draft and delete R2 object.
 * Optional `platform` query removes a per-platform thumbnail override instead of the shared thumbnail.
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

  const { id: draftId } = await params;
  const platformRaw = req.nextUrl.searchParams.get('platform')?.trim() ?? '';
  const platform: DraftThumbnailPlatform | undefined =
    platformRaw && isDraftThumbnailPlatform(platformRaw) ? platformRaw : undefined;
  if (platformRaw && !platform) {
    return NextResponse.json(
      {
        error: 'Bad Request',
        message: 'platform is invalid for thumbnail removal',
        statusCode: 400,
      },
      { status: 400 }
    );
  }

  const draft = await getDraftById(draftId);
  if (!draft || draft.userId !== userId) {
    return NextResponse.json(
      { error: 'Not Found', message: 'Draft not found', statusCode: 404 },
      { status: 404 }
    );
  }

  const key = platform
    ? draft.platforms[platform]?.thumbnailR2KeyOverride &&
      isDraftThumbnailFinalKeyForUser(
        draft.platforms[platform]!.thumbnailR2KeyOverride!,
        userId,
        draftId
      )
      ? draft.platforms[platform]!.thumbnailR2KeyOverride!
      : null
    : draft.thumbnailR2Key && isDraftThumbnailFinalKeyForUser(draft.thumbnailR2Key, userId, draftId)
      ? draft.thumbnailR2Key
      : null;

  // Clear the draft fields first. If updateDraft fails the R2 object is still intact and the
  // client can retry. The reverse ordering (R2 delete first) is worse: a successful R2 delete
  // followed by a failed updateDraft leaves the draft referencing a now-deleted object, breaking
  // preview and distribution with no retry path. An orphaned R2 object is far less harmful.
  try {
    const updated = await updateDraft(
      draftId,
      platform
        ? {
            platformsPatch: {
              [platform]: {
                thumbnailR2KeyOverride: '',
                thumbnailContentTypeOverride: '',
              },
            },
          }
        : {
            thumbnailR2Key: null,
            thumbnailContentType: null,
          }
    );
    if (!updated) {
      return NextResponse.json(
        { error: 'Not Found', message: 'Draft not found', statusCode: 404 },
        { status: 404 }
      );
    }
    if (key) {
      await deleteObject(key).catch((e) => {
        console.error('[DELETE /api/drafts/:id/thumbnail] delete object', e);
      });
    }
    return NextResponse.json({ data: updated, message: 'Thumbnail removed' });
  } catch (err) {
    if (err instanceof DraftDocumentTooLargeError) {
      return NextResponse.json(
        { error: 'Bad Request', message: err.message, statusCode: 400 },
        { status: 400 }
      );
    }
    throw err;
  }
}
