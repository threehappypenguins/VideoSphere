import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getDraftById } from '@/lib/repositories/drafts';
import { getUploadJobsWithPlatformUploadsForDraft } from '@/lib/repositories/upload-jobs';
import type { ApiError, ApiResponse, ConnectedAccountPlatform } from '@/types';
import { CONNECTED_ACCOUNT_PLATFORMS } from '@/types';

const USED_PLATFORMS_DEFAULT_LIMIT = 100;
const USED_PLATFORMS_MAX_LIMIT = 300;

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @param props - Component props.
 * @returns A response describing the request result.
 */
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
    const limitParam = Number.parseInt(req.nextUrl.searchParams.get('limit') ?? '', 10);
    const offsetParam = Number.parseInt(req.nextUrl.searchParams.get('offset') ?? '', 10);
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(limitParam, USED_PLATFORMS_MAX_LIMIT))
      : USED_PLATFORMS_DEFAULT_LIMIT;
    const offset = Number.isFinite(offsetParam) ? Math.max(0, offsetParam) : 0;

    const jobs = await getUploadJobsWithPlatformUploadsForDraft(userId, id, { limit, offset });
    const platforms = new Set<ConnectedAccountPlatform>();

    const targetCount = CONNECTED_ACCOUNT_PLATFORMS.length;
    for (const job of jobs) {
      for (const upload of job.platformUploads) {
        platforms.add(upload.platform);
        if (platforms.size >= targetCount) break;
      }
      if (platforms.size >= targetCount) break;
    }

    // Stable order: Set iteration is unspecified; use canonical list order (same as UI toggles).
    const data = CONNECTED_ACCOUNT_PLATFORMS.filter((p) => platforms.has(p));

    const response: ApiResponse<ConnectedAccountPlatform[]> = { data };
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
