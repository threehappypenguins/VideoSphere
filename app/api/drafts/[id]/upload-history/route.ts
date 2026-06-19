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
import { assessPlatformUploadRetryability } from '@/lib/utils/retryability';
import { latestPlatformUploadsPerPlatform } from '@/lib/utils/platform-uploads';
import {
  r2FileAvailableForRetryJob,
  resolveR2AvailabilityForKeys,
} from '@/lib/uploads/r2-availability';

/**
 * Defines one upload-history row returned for a draft.
 */
export interface DraftUploadHistoryItem {
  uploadJobId: string;
  status: UploadJobStatus;
  createdAt: string;
  updatedAt: string;
  r2FileAvailable: boolean | null;
  platforms: Array<{
    platform: ConnectedAccountPlatform;
    status: PlatformUploadStatus;
    updatedAt: string;
    errorMessage: string | null;
    retryable: boolean;
    retryReason: string;
    sermonAudioAutoPublishOnProcessed?: boolean;
  }>;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MIN_LIMIT = 1;

function parseLimitParam(raw: string | null): number {
  if (raw == null) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, parsed));
}

function parseOffsetParam(raw: string | null): number {
  if (raw == null) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, parsed);
}

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
    const errRes: ApiError = { error: 'Not Found', message: 'Draft not found', statusCode: 404 };
    return NextResponse.json(errRes, { status: 404 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const limit = parseLimitParam(searchParams.get('limit'));
    const offset = parseOffsetParam(searchParams.get('offset'));

    const jobs = await getUploadJobsWithPlatformUploadsForDraft(userId, id, { limit, offset });

    const perJob = jobs.map((job) => {
      const latestPlatforms = latestPlatformUploadsPerPlatform(job.platformUploads);
      const platformItems = latestPlatforms.map((platformUpload) => {
        const retryability = assessPlatformUploadRetryability(platformUpload.errorMessage);
        return {
          platform: platformUpload.platform,
          status: platformUpload.status,
          updatedAt: platformUpload.$updatedAt,
          errorMessage: platformUpload.errorMessage,
          retryable: platformUpload.status === 'failed',
          retryReason: platformUpload.status === 'failed' ? retryability.reason : '',
          ...(platformUpload.platform === 'sermon_audio'
            ? {
                sermonAudioAutoPublishOnProcessed:
                  platformUpload.sermonAudioAutoPublishOnProcessed === true,
              }
            : {}),
        };
      });
      const needsR2Head = platformItems.some((p) => p.status === 'failed');
      return { job, platformItems, needsR2Head };
    });

    const keysToHead = perJob
      .filter((p) => p.needsR2Head && p.job.r2Key)
      .map((p) => p.job.r2Key as string);
    const r2AvailabilityByKey = await resolveR2AvailabilityForKeys(keysToHead);

    const history: DraftUploadHistoryItem[] = perJob.map(({ job, platformItems, needsR2Head }) => {
      const r2FileAvailable = r2FileAvailableForRetryJob(
        needsR2Head,
        job.r2Key,
        r2AvailabilityByKey
      );

      return {
        uploadJobId: job.id,
        status: job.status,
        createdAt: job.$createdAt,
        updatedAt: job.$updatedAt,
        r2FileAvailable,
        platforms: platformItems,
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
