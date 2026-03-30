import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUploadJobsWithPlatformUploads } from '@/lib/repositories/upload-jobs';
import { listDraftsByUser } from '@/lib/repositories/drafts';
import type {
  ApiError,
  ApiResponse,
  ConnectedAccountPlatform,
  PlatformUpload,
  PlatformUploadStatus,
  UploadJobStatus,
} from '@/types';
import { headObject, R2ObjectNotFoundError } from '@/lib/r2';
import { assessPlatformUploadRetryability } from '@/lib/api/distribute';

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

function latestPlatformUploadsPerPlatform(platformUploads: PlatformUpload[]): PlatformUpload[] {
  const byPlatform = new Map<ConnectedAccountPlatform, PlatformUpload>();
  for (const item of platformUploads) {
    const current = byPlatform.get(item.platform);
    if (!current) {
      byPlatform.set(item.platform, item);
      continue;
    }
    const currentTs = Date.parse(current.$updatedAt);
    const nextTs = Date.parse(item.$updatedAt);
    if (Number.isNaN(currentTs) || (!Number.isNaN(nextTs) && nextTs >= currentTs)) {
      byPlatform.set(item.platform, item);
    }
  }
  return [...byPlatform.values()];
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

    const [jobs, drafts] = await Promise.all([
      getUploadJobsWithPlatformUploads(userId),
      listDraftsByUser(userId),
    ]);
    const draftTitleById = new Map(drafts.map((draft) => [draft.id, draft.title]));
    const pagedJobs = jobs.slice(offset, offset + limit);
    const r2AvailabilityByKey = new Map<string, boolean>();

    const data: UploadHistoryJobItem[] = await Promise.all(
      pagedJobs.map(async (job) => {
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

        const hasFailedPlatform = platformItems.some((p) => p.status === 'failed');
        const r2FileAvailable =
          hasFailedPlatform && job.r2Key
            ? await checkR2Availability(job.r2Key, r2AvailabilityByKey)
            : null;

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
      })
    );

    const res: ApiResponse<UploadHistoryJobItem[]> & {
      meta: { total: number; limit: number; offset: number };
    } = {
      data,
      meta: {
        total: jobs.length,
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
