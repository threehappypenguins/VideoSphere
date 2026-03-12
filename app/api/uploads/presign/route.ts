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
 * - 403 Forbidden (quota): Free-tier upload limit reached
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
 * - ContentType AND ContentLength are locked in the presigned signature; a PUT
 *   with a mismatched Content-Length header fails R2's signature check
 *   (server-side size enforcement — layer 1)
 * - Actual object byte size is verified server-side in POST /api/uploads/[jobId]/complete
 *   via a HEAD request after the upload completes (layer 2)
 * - Format validated by both MIME type and file extension
 * - draftId is required; ownership is verified (draft.userId === authenticatedUserId)
 *   before creating an UploadJob — prevents IDOR attacks
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPresignedUploadUrl } from '@/lib/r2';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { canUpload, getMonthlyUsage } from '@/lib/repositories/upload-usage';
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
    return { valid: false, error: 'filename is required and must be non-empty' };
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

  // Validate file size — required to enforce the 5 GB server-side limit
  if (typeof req.fileSize !== 'number' || req.fileSize <= 0) {
    return { valid: false, error: 'fileSize is required and must be a positive number' };
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

    // Pre-flight quota check — provides fast UX feedback before issuing a
    // presigned URL. This check is advisory only (non-atomic read); the
    // authoritative atomic enforcement is in POST /api/uploads/[jobId]/complete.
    const user = await getUserById(userId);
    const isSupporter = user?.isSupporter ?? false;
    const allowed = await canUpload(userId, isSupporter);

    if (!allowed) {
      const monthlyUsage = await getMonthlyUsage(userId);
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

    // Generate R2 object key and presigned upload URL
    const key = generateObjectKey(userId, filename);
    const uploadUrl = await getPresignedUploadUrl(key, contentType, fileSize);

    // Create an UploadJob record to track this upload, storing the R2 key so the
    // distribution step can locate the uploaded object without an extra round-trip.
    const uploadJob = await createUploadJob({ userId, draftId, r2Key: key });

    // NOTE: usage is incremented in POST /api/uploads/[jobId]/complete (called by
    // the client after a successful PUT to R2) so that cancelled or failed uploads
    // do not consume the user's monthly quota.

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
