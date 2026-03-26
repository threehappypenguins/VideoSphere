import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getDraftById } from '@/lib/repositories/drafts';
import { getUploadJobsWithPlatformUploadsForDraft } from '@/lib/repositories/upload-jobs';
import type {
  ApiError,
  ApiResponse,
  ConnectedAccountPlatform,
  PlatformUploadStatus,
} from '@/types';

interface DraftUploadHistoryItem {
  uploadJobId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  platforms: Array<{
    platform: ConnectedAccountPlatform;
    status: PlatformUploadStatus;
    updatedAt: string;
  }>;
}

function latestPlatformStatuses(
  platforms: Array<{
    platform: ConnectedAccountPlatform;
    status: PlatformUploadStatus;
    updatedAt: string;
  }>
) {
  const byPlatform = new Map<
    ConnectedAccountPlatform,
    { platform: ConnectedAccountPlatform; status: PlatformUploadStatus; updatedAt: string }
  >();

  for (const item of platforms) {
    const current = byPlatform.get(item.platform);
    if (!current) {
      byPlatform.set(item.platform, item);
      continue;
    }
    const currentTs = Date.parse(current.updatedAt);
    const nextTs = Date.parse(item.updatedAt);
    if (Number.isNaN(currentTs) || (!Number.isNaN(nextTs) && nextTs >= currentTs)) {
      byPlatform.set(item.platform, item);
    }
  }

  return Array.from(byPlatform.values());
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
    const jobs = await getUploadJobsWithPlatformUploadsForDraft(userId, id);
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
