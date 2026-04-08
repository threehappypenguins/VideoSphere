import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUploadJobById } from '@/lib/repositories/upload-jobs';
import { getPlatformUploadsByJob } from '@/lib/repositories/platform-uploads';
import type {
  ApiError,
  ApiResponse,
  ConnectedAccountPlatform,
  PlatformUploadStatus,
  UploadJobStatus,
} from '@/types';
import { latestPlatformStatuses } from '@/lib/uploads/status';

/**
 * Defines the upload job status payload returned by the jobs status endpoint.
 */
export interface UploadJobStatusResponse {
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

  try {
    const job = await getUploadJobById(id);
    if (!job || job.userId !== userId) {
      const errRes: ApiError = {
        error: 'Not Found',
        message: 'Upload job not found',
        statusCode: 404,
      };
      return NextResponse.json(errRes, { status: 404 });
    }

    const platformUploads = await getPlatformUploadsByJob(id);
    const platforms = latestPlatformStatuses(
      platformUploads.map((platformUpload) => ({
        platform: platformUpload.platform,
        status: platformUpload.status,
        updatedAt: platformUpload.$updatedAt,
      }))
    );
    const normalizedPlatforms =
      job.status === 'completed'
        ? platforms.map((platform) => ({
            ...platform,
            status: 'completed' as PlatformUploadStatus,
          }))
        : platforms;

    const response: ApiResponse<UploadJobStatusResponse> = {
      data: {
        uploadJobId: job.id,
        status: job.status,
        createdAt: job.$createdAt,
        updatedAt: job.$updatedAt,
        platforms: normalizedPlatforms,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[GET /api/uploads/jobs/:id]', error);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load upload job',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
