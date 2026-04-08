import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  fileExtensionForThumbnailContentType,
  isAllowedDraftThumbnailContentType,
  MAX_DRAFT_THUMBNAIL_BYTES,
} from '@/lib/draft-thumbnail';
import { getDraftById } from '@/lib/repositories/drafts';
import { buildDraftThumbnailPendingKey, getPresignedUploadUrl } from '@/lib/r2';

interface PresignBody {
  contentType?: unknown;
  fileSize?: unknown;
}

/**
 * Handles POST requests for this route.
 * @param req - The incoming request object.
 * @param props - Component props.
 * @returns A response describing the request result.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Not authenticated', statusCode: 401 },
      { status: 401 }
    );
  }

  const { id: draftId } = await params;

  let body: PresignBody;
  try {
    body = (await req.json()) as PresignBody;
  } catch {
    return NextResponse.json(
      { error: 'Bad Request', message: 'Invalid JSON body', statusCode: 400 },
      { status: 400 }
    );
  }

  const contentType =
    typeof body.contentType === 'string' ? body.contentType.trim().toLowerCase() : '';
  const fileSize = typeof body.fileSize === 'number' ? body.fileSize : NaN;

  if (!contentType || !isAllowedDraftThumbnailContentType(contentType)) {
    return NextResponse.json(
      {
        error: 'Bad Request',
        message: 'contentType must be one of: image/jpeg, image/png',
        statusCode: 400,
      },
      { status: 400 }
    );
  }

  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_DRAFT_THUMBNAIL_BYTES) {
    return NextResponse.json(
      {
        error: 'Bad Request',
        message: `fileSize must be between 1 and ${MAX_DRAFT_THUMBNAIL_BYTES} bytes`,
        statusCode: 400,
      },
      { status: 400 }
    );
  }

  const draft = await getDraftById(draftId);
  if (!draft || draft.userId !== userId) {
    return NextResponse.json(
      { error: 'Not Found', message: 'Draft not found', statusCode: 404 },
      { status: 404 }
    );
  }

  const ext = fileExtensionForThumbnailContentType(contentType);
  const pendingKey = buildDraftThumbnailPendingKey(userId, draftId, randomUUID(), ext);

  try {
    const uploadUrl = await getPresignedUploadUrl(pendingKey, contentType, fileSize);
    return NextResponse.json({
      uploadUrl,
      pendingKey,
      expiresIn: 900,
    });
  } catch (err) {
    console.error('[POST /api/drafts/:id/thumbnail/presign]', err);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to presign thumbnail upload',
        statusCode: 500,
      },
      { status: 500 }
    );
  }
}
