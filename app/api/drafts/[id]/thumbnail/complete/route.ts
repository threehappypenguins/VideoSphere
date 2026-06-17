import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  fileExtensionForThumbnailContentType,
  isAllowedDraftThumbnailContentType,
  isDraftThumbnailPlatform,
  MAX_DRAFT_THUMBNAIL_BYTES,
  type DraftThumbnailPlatform,
} from '@/lib/draft-thumbnail';
import { draftPlatformsWithThumbnailPreviewOverrides } from '@/lib/draft-thumbnail-previews';
import { DraftDocumentTooLargeError } from '@/lib/draft-upload-metadata';
import {
  buildDraftThumbnailFinalKey,
  copyObjectInBucket,
  deleteObject,
  getObjectUrl,
  headObjectMetadata,
  isDraftThumbnailPendingKeyForUser,
  R2ObjectNotFoundError,
  isDraftThumbnailFinalKeyForUser,
} from '@/lib/r2';
import { getDraftById, updateDraft } from '@/lib/repositories/drafts';

interface CompleteBody {
  pendingKey?: unknown;
  /** When set, stores the thumbnail on that platform instead of the shared draft thumbnail. */
  platform?: unknown;
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

  let body: CompleteBody;
  try {
    body = (await req.json()) as CompleteBody;
  } catch {
    return NextResponse.json(
      { error: 'Bad Request', message: 'Invalid JSON body', statusCode: 400 },
      { status: 400 }
    );
  }

  const pendingKey = typeof body.pendingKey === 'string' ? body.pendingKey.trim() : '';
  const platformRaw = typeof body.platform === 'string' ? body.platform.trim() : '';
  const platform: DraftThumbnailPlatform | undefined =
    platformRaw && isDraftThumbnailPlatform(platformRaw) ? platformRaw : undefined;
  if (platformRaw && !platform) {
    return NextResponse.json(
      {
        error: 'Bad Request',
        message: 'platform is invalid for thumbnail upload',
        statusCode: 400,
      },
      { status: 400 }
    );
  }
  if (!pendingKey || !isDraftThumbnailPendingKeyForUser(pendingKey, userId, draftId)) {
    return NextResponse.json(
      { error: 'Bad Request', message: 'pendingKey is invalid for this draft', statusCode: 400 },
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

  let size: number;
  let headContentType: string | undefined;
  try {
    const meta = await headObjectMetadata(pendingKey);
    size = meta.contentLength;
    headContentType = meta.contentType?.trim().toLowerCase();
  } catch (err) {
    if (err instanceof R2ObjectNotFoundError) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'Uploaded thumbnail not found in storage',
          statusCode: 400,
        },
        { status: 400 }
      );
    }
    console.error('[POST /api/drafts/:id/thumbnail/complete] headObjectMetadata', err);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to verify thumbnail in storage',
        statusCode: 500,
      },
      { status: 500 }
    );
  }

  if (size <= 0 || size > MAX_DRAFT_THUMBNAIL_BYTES) {
    await deleteObject(pendingKey).catch(() => undefined);
    return NextResponse.json(
      {
        error: 'Bad Request',
        message: `Thumbnail must be between 1 and ${MAX_DRAFT_THUMBNAIL_BYTES} bytes`,
        statusCode: 400,
      },
      { status: 400 }
    );
  }

  const ext = pendingKey.includes('.') ? (pendingKey.split('.').pop() ?? 'jpg') : 'jpg';
  const fallbackFromExt = ext === 'png' ? 'image/png' : 'image/jpeg';
  const resolvedType =
    headContentType && isAllowedDraftThumbnailContentType(headContentType)
      ? headContentType
      : fallbackFromExt;
  if (!isAllowedDraftThumbnailContentType(resolvedType)) {
    await deleteObject(pendingKey).catch(() => undefined);
    return NextResponse.json(
      { error: 'Bad Request', message: 'Thumbnail must be JPG or PNG', statusCode: 400 },
      { status: 400 }
    );
  }

  const finalKey = buildDraftThumbnailFinalKey(
    userId,
    draftId,
    randomUUID(),
    fileExtensionForThumbnailContentType(resolvedType)
  );

  const previousKey = platform
    ? draft.platforms[platform]?.thumbnailR2KeyOverride
    : draft.thumbnailR2Key;

  try {
    await copyObjectInBucket(pendingKey, finalKey);
  } catch (err) {
    console.error('[POST /api/drafts/:id/thumbnail/complete] copy', err);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to finalize thumbnail', statusCode: 500 },
      { status: 500 }
    );
  }

  try {
    const updated = await updateDraft(
      draftId,
      platform
        ? {
            platformsPatch: {
              [platform]: {
                thumbnailR2KeyOverride: finalKey,
                thumbnailContentTypeOverride: resolvedType,
              },
            },
          }
        : {
            thumbnailR2Key: finalKey,
            thumbnailContentType: resolvedType,
          }
    );
    if (!updated) {
      await deleteObject(finalKey).catch(() => undefined);
      return NextResponse.json(
        { error: 'Not Found', message: 'Draft not found', statusCode: 404 },
        { status: 404 }
      );
    }

    // Pending object cleaned up only after the draft update is confirmed so that
    // a transient persistence failure leaves the pending key intact for a retry.
    await deleteObject(pendingKey).catch((e) => {
      console.error('[POST /api/drafts/:id/thumbnail/complete] delete pending', e);
    });

    if (
      previousKey &&
      previousKey !== finalKey &&
      isDraftThumbnailFinalKeyForUser(previousKey, userId, draftId)
    ) {
      await deleteObject(previousKey).catch((e) => {
        console.error('[POST /api/drafts/:id/thumbnail/complete] delete previous', e);
      });
    }

    let thumbnailPreviewUrl: string | undefined;
    let thumbnailPreviewUrlOverride: string | undefined;
    try {
      const previewUrl = await getObjectUrl(finalKey);
      if (platform) {
        thumbnailPreviewUrlOverride = previewUrl;
      } else {
        thumbnailPreviewUrl = previewUrl;
      }
    } catch {
      thumbnailPreviewUrl = undefined;
      thumbnailPreviewUrlOverride = undefined;
    }

    const platformsWithPreviews = platform
      ? await draftPlatformsWithThumbnailPreviewOverrides(updated.platforms, userId, draftId)
      : updated.platforms;

    return NextResponse.json({
      data: {
        ...updated,
        platforms: platformsWithPreviews,
        ...(thumbnailPreviewUrl ? { thumbnailPreviewUrl } : {}),
        ...(platform && thumbnailPreviewUrlOverride
          ? {
              thumbnailPlatform: platform,
              thumbnailPreviewUrlOverride,
            }
          : {}),
      },
      message: 'Thumbnail saved',
    });
  } catch (err) {
    await deleteObject(finalKey).catch(() => undefined);
    if (err instanceof DraftDocumentTooLargeError) {
      return NextResponse.json(
        { error: 'Bad Request', message: err.message, statusCode: 400 },
        { status: 400 }
      );
    }
    throw err;
  }
}
