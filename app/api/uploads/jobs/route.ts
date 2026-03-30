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
import { headObject, R2ObjectNotFoundError } from '@/lib/r2';
import { assessPlatformUploadRetryability } from '@/lib/api/distribute';
import { latestPlatformUploadsPerPlatform } from '@/lib/utils/platform-uploads';

interface UploadHistoryPlatformItem {
  platform: ConnectedAccountPlatform;
  status: PlatformUploadStatus;
  updatedAt: string;
  errorMessage: string | null;
  retryable: boolean;
  retryReason: string;
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
/** Max parallel R2 HEAD calls per request (unique keys, after retryability filter). */
const R2_HEAD_CONCURRENCY = 8;

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

async function checkR2Availability(key: string, cache: Map<string, boolean>): Promise<boolean> {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    await headObject(key);
    cache.set(key, true);
    return true;
  } catch (error) {
    if (error instanceof R2ObjectNotFoundError) {
      cache.set(key, false);
      return false;
    }
    throw error;
  }
}

/** Run async work on `items` with at most `limit` concurrent executions. */
async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  if (items.length === 0) return;
  const cap = Math.min(Math.max(1, limit), items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: cap }, () => worker()));
}

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
          status: job.status === 'completed' ? 'completed' : platformUpload.status,
          updatedAt: platformUpload.$updatedAt,
          errorMessage: platformUpload.errorMessage,
          retryable: platformUpload.status === 'failed' ? retryability.retryable : false,
          retryReason: platformUpload.status === 'failed' ? retryability.reason : '',
        };
      });
      const needsR2Head = platformItems.some((p) => p.status === 'failed' && p.retryable);
      return { job, platformItems, needsR2Head };
    });

    const r2AvailabilityByKey = new Map<string, boolean>();
    const keysToHead = [
      ...new Set(
        perJob.filter((p) => p.needsR2Head && p.job.r2Key).map((p) => p.job.r2Key as string)
      ),
    ];
    await runWithConcurrency(keysToHead, R2_HEAD_CONCURRENCY, async (key) => {
      await checkR2Availability(key, r2AvailabilityByKey);
    });

    const data: UploadHistoryJobItem[] = perJob.map(({ job, platformItems, needsR2Head }) => {
      let r2FileAvailable: boolean | null = null;
      if (needsR2Head) {
        if (job.r2Key) {
          r2FileAvailable = r2AvailabilityByKey.get(job.r2Key) ?? false;
        } else {
          r2FileAvailable = false;
        }
      }

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
