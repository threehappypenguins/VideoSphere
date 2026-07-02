import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getDraftById } from '@/lib/repositories/drafts';
import { getYoutubeImportJobForDraftEditor } from '@/lib/repositories/youtube-import-jobs';
import type { ApiError, ApiResponse, YoutubeImportJob } from '@/types';

/**
 * Returns the YouTube import job tied to a draft: in-flight work, or a completed
 * import whose video is staged but not yet distributed.
 * @param req - Incoming GET request.
 * @param context - Route params containing the draft id.
 * @returns Import job snapshot for the draft editor.
 */
export async function GET(
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

  const job = await getYoutubeImportJobForDraftEditor(draftId);
  const response: ApiResponse<YoutubeImportJob | null> = { data: job };
  return NextResponse.json(response, { status: 200 });
}
