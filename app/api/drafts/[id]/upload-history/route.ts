import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getDraftById } from '@/lib/repositories/drafts';
import { getUploadJobsWithPlatformUploadsForDraft } from '@/lib/repositories/upload-jobs';
import type {
  ApiError,
  ApiResponse,
  ConnectedAccountPlatform,
  PlatformUploadStatus,
  UploadJobStatus,
} from '@/types';
import { latestPlatformStatuses } from '@/lib/uploads/status';

interface DraftUploadHistoryItem {
  uploadJobId: string;
  status: UploadJobStatus;
  createdAt: string;
  updatedAt: string;
  platforms: Array<{
    platform: ConnectedAccountPlatform;
    status: PlatformUploadStatus;
    updatedAt: string;
  }>;
}

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
    const errRes: ApiError = { error: 'Not Found', message: 'Draft not found', statusCode: 404 };
    return NextResponse.json(errRes, { status: 404 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const rawLimit = searchParams.get('limit');
    const rawOffset = searchParams.get('offset');

    const limit =
      rawLimit == null ? 20 : Math.min(100, Math.max(1, Number.parseInt(rawLimit, 10) || 20));
    const offset = rawOffset == null ? 0 : Math.max(0, Number.parseInt(rawOffset, 10) || 0);

    const jobs = await getUploadJobsWithPlatformUploadsForDraft(userId, id, { limit, offset });
    const history: DraftUploadHistoryItem[] = jobs.map((job) => {
      const latestPlatforms = latestPlatformStatuses(
        job.platformUploads.map((platformUpload) => ({
          platform: platformUpload.platform,
          status: platformUpload.status,
          updatedAt: platformUpload.$updatedAt,
        }))
      );

      return {
        uploadJobId: job.id,
        status: job.status,
        createdAt: job.$createdAt,
        updatedAt: job.$updatedAt,
        platforms:
          job.status === 'completed'
            ? latestPlatforms.map((platform) => ({
                ...platform,
                status: 'completed' as PlatformUploadStatus,
              }))
            : latestPlatforms,
      };
    });

    const response: ApiResponse<DraftUploadHistoryItem[]> = { data: history };
    return NextResponse.json(response);
  } catch (error) {
    console.error('[GET /api/drafts/:id/upload-history]', error);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load draft upload history',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
