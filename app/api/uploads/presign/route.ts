/**
 * POST /api/uploads/presign
 *
 * Generate a presigned URL for direct browser-to-R2 upload and create an
 * UploadJob record linked to the given draft.
 *
 * Request body:
 * {
 *   fileName: string          - Original filename (e.g., "my-video.mp4"); also accepts "filename"
 *   contentType: string       - MIME type (e.g., "video/mp4")
 *   fileSize: number          - File size in bytes (required; must be > 0 and ≤ 5 GB)
 *   draftId: string           - Draft ID to associate this upload with (required)
 * }
 *
 * Response (200 OK):
 * {
 *   uploadUrl: string         - Presigned PUT URL (expires 15 min); PUT the file directly to this URL
 *   key: string               - R2 object key (store this for distribution)
 *   bucketName: string        - R2 bucket name
 *   expiresIn: number         - URL expiry in seconds (900)
 *   uploadJobId: string       - ID of the created UploadJob record in Appwrite
 *   isSupporter: boolean      - Whether the authenticated user is a Supporter (for UI display)
 * }
 *
 * Error responses:
 * - 400 Bad Request: Missing or invalid fields (filename, contentType, fileSize, draftId),
 *                    unsupported format, or file exceeds 5 GB
 * - 401 Unauthorized: Not authenticated
 * - 403 Forbidden (quota): Free-tier monthly upload limit reached (claimed atomically at
 *                  presign time — a slot is reserved even if the upload is later cancelled
 *                  or the presigned URL expires unused; the slot is rolled back if
 *                  URL generation or UploadJob creation fails server-side)
 *                  Body: { error, message, monthlyUsage, limit, isSupporter }
 * - 403 Forbidden (ownership): Supplied draftId belongs to a different user
 *                  Body: { error }
 * - 404 Not Found: Supplied draftId does not exist
 *                  Body: { error }
 * - 500 Internal Server Error: R2 or Appwrite service error
 *
 * Security:
 * - Only authenticated users can request presigned URLs
 * - URLs expire in 15 minutes (NF-08)
 * - ContentType is locked in the presigned signature; a PUT with a mismatched
 *   Content-Type header fails R2's signature check
 * - ContentLength is NOT signed (browsers treat it as a forbidden header and
 *   set it automatically — signing it would cause SignatureDoesNotMatch on every
 *   browser upload). Actual byte size is verified server-side in
 *   POST /api/uploads/[jobId]/complete via a HEAD request after upload (layer 2)
 * - Format validated by both MIME type and file extension
 * - draftId is required; ownership is verified (draft.userId === authenticatedUserId)
 *   before creating an UploadJob — prevents IDOR attacks
 * - Quota is enforced atomically at presign time (increment-first strategy) so that
 *   the limit cannot be bypassed by omitting the /complete call
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPresignedUploadUrl } from '@/lib/r2';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { incrementUsageIfAllowed, decrementUsage } from '@/lib/repositories/upload-usage';
import { getUserById } from '@/lib/repositories/users';
import { createUploadJob } from '@/lib/repositories/upload-jobs';
import { getDraftById } from '@/lib/repositories/drafts';

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB in bytes
const FREE_TIER_LIMIT = 10;

const ALLOWED_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime', // MOV
  'video/x-msvideo', // AVI
  'video/x-matroska', // MKV
  'video/webm',
]);

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);

interface PresignRequestBody {
  filename: string;
  contentType: string;
  fileSize: number;
  draftId: string;
}

interface PresignResponse {
  uploadUrl: string;
  key: string;
  bucketName: string;
  expiresIn: number;
  uploadJobId: string;
  isSupporter: boolean;
}

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : '';
}

/**
 * Validate request body — accepts both "fileName" and "filename" for compatibility.
 */
function validateRequest(body: unknown): {
  valid: boolean;
  error?: string;
  data?: PresignRequestBody;
} {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const req = body as Record<string, unknown>;

  // Accept both "fileName" (issue spec) and "filename" (backward compat)
  const rawFilename = req.fileName ?? req.filename;
  if (typeof rawFilename !== 'string' || rawFilename.trim() === '') {
    return { valid: false, error: 'fileName (or filename) is required and must be non-empty' };
  }

  if (typeof req.contentType !== 'string' || req.contentType.trim() === '') {
    return { valid: false, error: 'contentType is required and must be non-empty' };
  }

  if (!req.contentType.includes('/')) {
    return { valid: false, error: 'contentType must be a valid MIME type (e.g., video/mp4)' };
  }

  // Validate format: both MIME type and extension must be allowed
  const ext = getExtension(rawFilename.trim());
  if (!ALLOWED_MIME_TYPES.has(req.contentType.trim()) || !ALLOWED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: 'Unsupported file format. Accepted formats: MP4, MOV, AVI, MKV, WebM',
    };
  }

  // Validate file size — required to enforce the 5 GB server-side limit.
  // The typeof guard narrows the unknown to number so the subsequent
  // Number.isFinite / Number.isInteger checks (which reject NaN, Infinity, and
  // fractional byte counts) can operate on the narrowed type.
  if (
    typeof req.fileSize !== 'number' ||
    !Number.isFinite(req.fileSize) ||
    !Number.isInteger(req.fileSize) ||
    req.fileSize <= 0
  ) {
    return { valid: false, error: 'fileSize is required and must be a positive integer' };
  }
  if (req.fileSize > MAX_FILE_SIZE) {
    return { valid: false, error: 'File exceeds the 5 GB maximum size limit' };
  }

  // draftId is required — all uploads must be associated with a draft
  if (typeof req.draftId !== 'string' || req.draftId.trim() === '') {
    return { valid: false, error: 'draftId is required and must be non-empty' };
  }

  return {
    valid: true,
    data: {
      filename: rawFilename.trim(),
      contentType: req.contentType.trim(),
      fileSize: req.fileSize as number,
      draftId: req.draftId.trim(),
    },
  };
}

/**
 * Generate R2 object key: temp/uploads/{userId}/{timestamp}-{uuid}/{sanitized_filename}
 * - Timestamp prefix keeps objects coarsely sorted by upload time
 * - UUID suffix guarantees uniqueness even for concurrent same-millisecond requests
 * - Path separators are stripped from the filename to prevent directory traversal
 */
function generateObjectKey(userId: string, filename: string): string {
  const sanitized = filename.replace(/[/\\]/g, '_');
  const timestamp = Date.now();
  const uid = crypto.randomUUID();
  return `temp/uploads/${userId}/${timestamp}-${uid}/${sanitized}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Verify session
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized: Please log in to upload videos' },
        { status: 401 }
      );
    }

    // Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }

    const validation = validateRequest(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { filename, contentType, fileSize, draftId } = validation.data!;

    // Verify the authenticated user owns the draft (draftId is always present after validation)
    const draft = await getDraftById(draftId);
    if (!draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }
    if (draft.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden: you do not own this draft' }, { status: 403 });
    }

    // Atomically claim a quota slot before issuing the presigned URL.
    // Using incrementUsageIfAllowed here (not canUpload) ensures the limit is
    // enforced server-side regardless of whether the client ever calls /complete.
    // Cancelled or expired uploads consume the slot for the month; the 15-minute
    // URL expiry naturally bounds how long a slot can be "in flight" without use.
    const user = await getUserById(userId);
    const isSupporter = user?.isSupporter ?? false;
    const { allowed, monthlyUsage } = await incrementUsageIfAllowed(userId, isSupporter);

    if (!allowed) {
      return NextResponse.json(
        {
          error: 'Upload limit reached',
          message: `Free-tier users are limited to ${FREE_TIER_LIMIT} uploads per month. Upgrade to Supporter for unlimited uploads.`,
          monthlyUsage,
          limit: FREE_TIER_LIMIT,
          isSupporter,
        },
        { status: 403 }
      );
    }

    // Generate R2 object key and presigned upload URL, then create the UploadJob.
    // These steps are wrapped in a try/catch so that any server-side failure after
    // the quota slot was claimed triggers a best-effort rollback of that slot.
    // Supporters bypass the counter entirely, so no rollback is needed for them.
    const key = generateObjectKey(userId, filename);
    let uploadUrl: string;
    let uploadJob: Awaited<ReturnType<typeof createUploadJob>>;
    try {
      uploadUrl = await getPresignedUploadUrl(key, contentType, fileSize);
      uploadJob = await createUploadJob({ userId, draftId, r2Key: key });
    } catch (err) {
      // Roll back the quota slot so the user isn't charged for a failed presign.
      // Best-effort: log but don't let a rollback failure shadow the original error.
      if (!isSupporter) {
        await decrementUsage(userId).catch((rollbackErr) => {
          console.error(
            `Failed to roll back quota slot for user ${userId} after presign error:`,
            rollbackErr
          );
        });
      }
      throw err; // fall through to outer catch → 500
    }

    const response: PresignResponse = {
      uploadUrl,
      key,
      bucketName: process.env.R2_BUCKET_NAME || 'unknown',
      expiresIn: 900,
      uploadJobId: uploadJob.id,
      isSupporter,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Presigned URL generation error:', error);

    return NextResponse.json(
      {
        error: 'Failed to generate upload URL. Please try again.',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * Handle unsupported methods
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST to generate presigned URLs.' },
    { status: 405, headers: { Allow: 'POST' } }
  );
}
