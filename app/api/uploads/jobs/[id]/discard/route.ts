import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { discardFailedUploadJob } from '@/lib/api/discard-upload-job';

/**
 * Cancels a failed upload job and deletes its temporary R2 video and draft thumbnails.
 * @param request - Incoming POST request.
 * @param props - Route params containing the upload job id.
 * @returns JSON success or error response.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized: Please log in' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const result = await discardFailedUploadJob(id, userId);
    if (result.ok === false) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ jobId: result.jobId, success: true });
  } catch (error) {
    console.error('[POST /api/uploads/jobs/:id/discard] Unexpected error:', error);
    return NextResponse.json({ error: 'Failed to cancel upload job' }, { status: 500 });
  }
}
