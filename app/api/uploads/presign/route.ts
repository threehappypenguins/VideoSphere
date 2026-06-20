/**
 * POST /api/uploads/presign
 *
 * Initiate a multipart upload to R2 and return presigned PUT URLs for each part,
 * plus an UploadJob record linked to the given draft.
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
 *   uploadId: string          - R2 multipart upload id (required to complete or abort the upload)
 *   key: string               - R2 object key (store this for distribution)
 *   bucketName: string        - R2 bucket name
 *   partSize: number          - Fixed part size in bytes (32 MiB except the last part)
 *   parts: Array<{ partNumber: number; url: string }> - Presigned PUT URL per part
 *   uploadJobId: string       - ID of the created UploadJob record in persistent storage
 * }
 *
 * Error responses:
 * - 400 Bad Request: Missing or invalid fields (filename, contentType, fileSize, draftId),
 *                    unsupported format, or file exceeds 5 GB
 * - 401 Unauthorized: Not authenticated
 * - 403 Forbidden (ownership): Supplied draftId belongs to a different user
 *                  Body: { error }
 * - 404 Not Found: Supplied draftId does not exist
 *                  Body: { error }
 * - 500 Internal Server Error: R2 or persistence service error
 *
 * Security:
 * - Only authenticated users can request presigned URLs
 * - Part URLs expire after {@link MULTIPART_PART_URL_EXPIRY_SECONDS} (see throughput assumption there)
 * - Object Content-Type is set on CreateMultipartUpload and stored on the completed object
 * - Actual byte size is verified server-side in POST /api/uploads/[jobId]/complete via HEAD
 * - Format validated by both MIME type and file extension
 * - draftId is required; ownership is verified (draft.userId === authenticatedUserId)
 *   before creating an UploadJob — prevents IDOR attacks
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  computeMultipartPlan,
  createMultipartUpload,
  DEFAULT_MULTIPART_PART_SIZE_BYTES,
  getPresignedUploadPartUrls,
} from '@/lib/r2';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { createUploadJob } from '@/lib/repositories/upload-jobs';
import { getDraftById, markDraftUsedInUpload } from '@/lib/repositories/drafts';

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB in bytes

/**
 * Presigned multipart part URL lifetime (12 h).
 * Assumes a sustained ~1 Mbps upload (~125 KiB/s): 32 MiB per part ≈ 4.3 min/part;
 * up to ~157 parts at 5 GB ≈ 11 h if parts are uploaded strictly one at a time.
 * Twelve hours keeps later parts valid on slow connections without re-presigning mid-upload.
 */
const MULTIPART_PART_URL_EXPIRY_SECONDS = 12 * 60 * 60;

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
  uploadId: string;
  key: string;
  bucketName: string;
  partSize: number;
  parts: { partNumber: number; url: string }[];
  uploadJobId: string;
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

/**
 * Handles POST requests for this route.
 * @param request - The incoming request object.
 * @returns A response describing the request result.
 */
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

    // Generate R2 multipart upload URLs, then create the UploadJob.
    // These steps are wrapped in a try/catch so failures return a consistent 500.
    const key = generateObjectKey(userId, filename);
    let uploadId: string;
    let parts: { partNumber: number; url: string }[];
    let uploadJob: Awaited<ReturnType<typeof createUploadJob>>;
    try {
      const { partCount, partSize } = computeMultipartPlan(
        fileSize,
        DEFAULT_MULTIPART_PART_SIZE_BYTES
      );
      uploadId = await createMultipartUpload(key, contentType);
      parts = await getPresignedUploadPartUrls(
        key,
        uploadId,
        partCount,
        MULTIPART_PART_URL_EXPIRY_SECONDS
      );
      uploadJob = await createUploadJob({ userId, draftId, r2Key: key });
      await markDraftUsedInUpload(draftId, uploadJob.$createdAt).catch((err) => {
        console.error(
          `[POST /api/uploads/presign] Failed to mark draft ${draftId} usedInUploadAt:`,
          err
        );
      });

      const response: PresignResponse = {
        uploadId,
        key,
        bucketName: process.env.R2_BUCKET_NAME || 'unknown',
        partSize,
        parts,
        uploadJobId: uploadJob.id,
      };

      return NextResponse.json(response, { status: 200 });
    } catch (err) {
      throw err; // fall through to outer catch → 500
    }
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
