import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { DraftDocumentTooLargeError } from '@/lib/draft-upload-metadata';
import { deleteObject, isDraftThumbnailFinalKeyForUser } from '@/lib/r2';
import { getDraftById, updateDraft } from '@/lib/repositories/drafts';

/**
 * DELETE /api/drafts/[id]/thumbnail — remove custom thumbnail from draft and delete R2 object.
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

  const draft = await getDraftById(draftId);
  if (!draft || draft.userId !== userId) {
    return NextResponse.json(
      { error: 'Not Found', message: 'Draft not found', statusCode: 404 },
      { status: 404 }
    );
  }

  const key =
    draft.thumbnailR2Key && isDraftThumbnailFinalKeyForUser(draft.thumbnailR2Key, userId, draftId)
      ? draft.thumbnailR2Key
      : null;

  try {
    const updated = await updateDraft(draftId, {
      thumbnailR2Key: null,
      thumbnailContentType: null,
    });
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
