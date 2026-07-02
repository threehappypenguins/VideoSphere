import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getDraftById } from '@/lib/repositories/drafts';
import { discardBlockingDraftYoutubeImport } from '@/lib/youtube-import/discard-draft-import';
import type { ApiError } from '@/types';

/**
 * Clears active, staged, or failed YouTube import state for a draft so the user can
 * start over on the same draft.
 * @param req - Incoming POST request.
 * @param context - Route params containing the draft id.
 * @returns Empty success response when discard completes.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
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

  const { id: draftId } = await context.params;
  const draft = await getDraftById(draftId);
  if (!draft) {
    const errRes: ApiError = {
      error: 'Not Found',
      message: 'Draft not found',
      statusCode: 404,
    };
    return NextResponse.json(errRes, { status: 404 });
  }
  if (draft.userId !== userId) {
    const errRes: ApiError = {
      error: 'Forbidden',
      message: 'Forbidden: you do not own this draft',
      statusCode: 403,
    };
    return NextResponse.json(errRes, { status: 403 });
  }

  try {
    await discardBlockingDraftYoutubeImport(draftId, userId);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[POST /api/drafts/${draftId}/youtube-import/discard]`, error);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message,
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
