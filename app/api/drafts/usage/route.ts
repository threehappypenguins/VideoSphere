import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { listUploadJobsByUser } from '@/lib/repositories/upload-jobs';

export async function GET(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Not authenticated', statusCode: 401 },
      { status: 401 }
    );
  }

  try {
    const jobs = await listUploadJobsByUser(userId);
    const usageByDraftId: Record<string, boolean> = {};

    for (const job of jobs) {
      if (job.draftId) {
        usageByDraftId[job.draftId] = true;
      }
    }

    return NextResponse.json({ data: usageByDraftId });
  } catch (error) {
    console.error('[GET /api/drafts/usage]', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to load draft usage', statusCode: 500 },
      { status: 500 }
    );
  }
}
