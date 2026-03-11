/**
 * POST /api/uploads/presign
 *
 * Generate a presigned URL for direct browser-to-R2 upload
 *
 * Request body:
 * {
 *   filename: string          - Original filename (e.g., "my-video.mp4")
 *   contentType: string       - MIME type (e.g., "video/mp4")
 *   uploadJobId?: string      - Link to upload job record (optional for now)
 * }
 *
 * Response (200 OK):
 * {
 *   uploadUrl: string         - Presigned PUT URL (expires 15 min)
 *   key: string               - Object key used in R2 (for tracking)
 *   bucketName: string        - Bucket name
 *   expiresIn: number         - URL expiry in seconds (900)
 * }
 *
 * Error responses:
 * - 400 Bad Request: Missing or invalid fields
 * - 401 Unauthorized: Not authenticated
 * - 500 Internal Server Error: R2 service error
 *
 * Security:
 * - Only authenticated users can request presigned URLs
 * - URLs expire in 15 minutes (NF-08)
 * - ContentType is locked in signature to prevent abuse
 */

import { NextRequest, NextResponse } from 'next/server';
import { Client, Account } from 'node-appwrite';
import { getPresignedUploadUrl } from '@/lib/r2';
import { getSessionCookieName } from '@/lib/auth-session-cookie';

interface PresignRequestBody {
  filename: string;
  contentType: string;
  uploadJobId?: string;
}

interface PresignResponse {
  uploadUrl: string;
  key: string;
  bucketName: string;
  expiresIn: number;
}

/**
 * Validate request body
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

  // Validate filename
  if (typeof req.filename !== 'string' || req.filename.trim() === '') {
    return { valid: false, error: 'filename is required and must be non-empty' };
  }

  // Validate contentType
  if (typeof req.contentType !== 'string' || req.contentType.trim() === '') {
    return {
      valid: false,
      error: 'contentType is required and must be non-empty',
    };
  }

  // Validate contentType format (must contain /)
  if (!req.contentType.includes('/')) {
    return {
      valid: false,
      error: 'contentType must be a valid MIME type (e.g., video/mp4)',
    };
  }

  return {
    valid: true,
    data: {
      filename: req.filename as string,
      contentType: req.contentType as string,
      uploadJobId: typeof req.uploadJobId === 'string' ? req.uploadJobId : undefined,
    },
  };
}

/**
 * Generate R2 object key from filename and user
 *
 * Format: temp/uploads/{userId}/{timestamp}/{filename}
 * This keeps temp files organized by time
 */
function generateObjectKey(userId: string, filename: string): string {
  // Remove path separators from filename to prevent directory traversal
  const sanitized = filename.replace(/[\/\\]/g, '_');

  // Generate timestamp-based path for organization
  const timestamp = Date.now();

  return `temp/uploads/${userId}/${timestamp}/${sanitized}`;
}

/**
 * Handle POST request for presigned URL
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Check authentication
    const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
    const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
    const cookieName = projectId ? getSessionCookieName(projectId) : null;
    const sessionSecret = cookieName ? request.cookies.get(cookieName)?.value : null;

    if (!endpoint || !projectId || !sessionSecret) {
      return NextResponse.json(
        { error: 'Unauthorized: Please log in to upload videos' },
        { status: 401 }
      );
    }

    // Get user from session
    let userId: string;
    try {
      const client = new Client()
        .setEndpoint(endpoint)
        .setProject(projectId)
        .setSession(sessionSecret);
      const account = new Account(client);
      const user = await account.get();
      userId = user.$id;
    } catch {
      return NextResponse.json({ error: 'Unauthorized: Invalid session' }, { status: 401 });
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

    const { filename, contentType, uploadJobId: _uploadJobId } = validation.data!;

    // Generate R2 object key
    const key = generateObjectKey(userId, filename);

    // Get presigned upload URL from R2
    const uploadUrl = await getPresignedUploadUrl(key, contentType);

    // TODO: Create upload job record in Appwrite database
    // This would track:
    // - uploadJobId (unique ID for this upload attempt)
    // - userId (who uploaded)
    // - filename (original name)
    // - key (R2 object key)
    // - status: 'pending' | 'uploading' | 'failed'
    // - createdAt, updatedAt

    const response: PresignResponse = {
      uploadUrl,
      key,
      bucketName: process.env.R2_BUCKET_NAME || 'unknown',
      expiresIn: 900, // 15 minutes
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    // Log error for debugging
    console.error('Presigned URL generation error:', error);

    // Return generic error to client (don't leak internal details)
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
