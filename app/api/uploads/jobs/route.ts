import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  countUploadJobsByUser,
  getUploadJobsWithPlatformUploadsPage,
} from '@/lib/repositories/upload-jobs';
import { getDraftTitlesByIdsForUser } from '@/lib/repositories/drafts';
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

interface UploadHistoryPlatformItem {
  platform: ConnectedAccountPlatform;
  status: PlatformUploadStatus;
  updatedAt: string;
  errorMessage: string | null;
  retryable: boolean;
  retryReason: string;
  sermonAudioAutoPublishOnProcessed?: boolean;
}

interface UploadHistoryJobItem {
  uploadJobId: string;
  draftId: string | null;
  draftTitle: string | null;
  status: UploadJobStatus;
  createdAt: string;
  updatedAt: string;
  r2FileAvailable: boolean | null;
  platforms: UploadHistoryPlatformItem[];
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
 * @returns A response describing the request result.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const err: ApiError = { error: 'Unauthorized', message: 'Not authenticated', statusCode: 401 };
    return NextResponse.json(err, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const limit = parseLimitParam(searchParams.get('limit'));
    const offset = parseOffsetParam(searchParams.get('offset'));

    const [total, pagedJobs] = await Promise.all([
      countUploadJobsByUser(userId),
      getUploadJobsWithPlatformUploadsPage(userId, { limit, offset }),
    ]);

    const draftTitleById = await getDraftTitlesByIdsForUser(
      userId,
      pagedJobs.map((j) => j.draftId)
    );

    const perJob = pagedJobs.map((job) => {
      const latestPlatforms = latestPlatformUploadsPerPlatform(job.platformUploads);
      const platformItems: UploadHistoryPlatformItem[] = latestPlatforms.map((platformUpload) => {
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

    const data: UploadHistoryJobItem[] = perJob.map(({ job, platformItems, needsR2Head }) => {
      const r2FileAvailable = r2FileAvailableForRetryJob(
        needsR2Head,
        job.r2Key,
        r2AvailabilityByKey
      );

      return {
        uploadJobId: job.id,
        draftId: job.draftId,
        draftTitle: job.draftId ? (draftTitleById.get(job.draftId) ?? null) : null,
        status: job.status,
        createdAt: job.$createdAt,
        updatedAt: job.$updatedAt,
        r2FileAvailable,
        platforms: platformItems,
      };
    });

    const res: ApiResponse<UploadHistoryJobItem[]> & {
      meta: { total: number; limit: number; offset: number };
    } = {
      data,
      meta: {
        total,
        limit,
        offset,
      },
    };
    return NextResponse.json(res);
  } catch (error) {
    console.error('[GET /api/uploads/jobs]', error);
    const err: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load upload history',
      statusCode: 500,
    };
    return NextResponse.json(err, { status: 500 });
  }
}
