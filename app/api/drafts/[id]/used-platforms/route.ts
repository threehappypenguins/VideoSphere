import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getDraftById } from '@/lib/repositories/drafts';
import { getUploadJobsWithPlatformUploads } from '@/lib/repositories/upload-jobs';
import type { ApiError, ApiResponse, ConnectedAccountPlatform } from '@/types';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  const { id } = await params;
  const draft = await getDraftById(id);
  if (!draft || draft.userId !== userId) {
    const errRes: ApiError = {
      error: 'Not Found',
      message: 'Draft not found',
      statusCode: 404,
    };
    return NextResponse.json(errRes, { status: 404 });
  }

  try {
    const jobs = await getUploadJobsWithPlatformUploads(userId);
    const platforms = new Set<ConnectedAccountPlatform>();

    for (const job of jobs) {
      if (job.draftId !== id) continue;
      for (const upload of job.platformUploads) {
        platforms.add(upload.platform);
      }
    }

    const response: ApiResponse<ConnectedAccountPlatform[]> = { data: Array.from(platforms) };
    return NextResponse.json(response);
  } catch (error) {
    console.error('[GET /api/drafts/:id/used-platforms]', error);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load draft upload platforms',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
