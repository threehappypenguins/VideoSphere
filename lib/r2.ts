/**
 * Cloudflare R2 Storage Integration
 * S3-compatible client for temporary video upload staging
 *
 * Features:
 * - Presigned upload URLs (15 minute expiry)
 * - Presigned download URLs (1 hour expiry)
 * - Object deletion
 *
 * Environment variables:
 * - R2_ACCOUNT_ID: Cloudflare account ID
 * - R2_ACCESS_KEY_ID: R2 API access key
 * - R2_SECRET_ACCESS_KEY: R2 API secret key
 * - R2_BUCKET_NAME: R2 bucket name
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Constants
const UPLOAD_URL_EXPIRY = 900; // 15 minutes
const DOWNLOAD_URL_EXPIRY = 3600; // 1 hour
const CONTENT_TYPE_HEADER = 'content-type';

/**
 * Validate required R2 environment variables
 */
function validateEnvironment(): void {
  const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];

  for (const envVar of required) {
    if (!process.env[envVar]) {
      throw new Error(
        `Missing required environment variable: ${envVar}. ` +
          `Configure R2 credentials in .env or .env.local`
      );
    }
  }
}

/**
 * Initialize S3 client for Cloudflare R2
 * Creates a singleton instance to avoid recreating on every request
 */
function createR2Client(): S3Client {
  validateEnvironment();

  return new S3Client({
    region: 'auto', // Required by SDK but not used by R2
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

// Singleton instance
let s3Client: S3Client | null = null;

/**
 * Get or create S3 client for R2
 */
function getR2Client(): S3Client {
  if (!s3Client) {
    s3Client = createR2Client();
  }
  return s3Client;
}

/**
 * Generate presigned upload URL for direct browser uploads
 *
 * @param key - Object key in R2 bucket (e.g., "users/123/videos/abc.mp4")
 * @param contentType - MIME type of file being uploaded (e.g., "video/mp4")
 * @param contentLength - Exact file size in bytes; locked into the URL signature
 * @returns Presigned PUT URL that expires in 15 minutes
 *
 * Security:
 * - Content-Type is part of the signature, preventing upload of wrong file types
 * - Content-Length is part of the signature; the PUT must declare the exact byte
 *   count that was signed — a mismatched Content-Length on the PUT request will
 *   fail R2's signature verification and the upload will be rejected
 *
 * @example
 * const url = await getPresignedUploadUrl("users/123/video.mp4", "video/mp4", 1024 * 1024);
 * // Client can now PUT file directly to R2 with this URL
 * fetch(url, { method: "PUT", body: file, headers: { "content-type": "video/mp4" } })
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  contentLength: number
): Promise<string> {
  if (!key) {
    throw new Error('Object key is required');
  }
  if (!contentType) {
    throw new Error('Content type is required');
  }
  if (!contentLength || contentLength <= 0) {
    throw new Error('Content length must be a positive number');
  }

  const client = getR2Client();

  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });

  try {
    const url = await getSignedUrl(client, command, {
      expiresIn: UPLOAD_URL_EXPIRY,
      // Include both content-type and content-length in the signature:
      // - content-type: prevents MIME-type abuse
      // - content-length: binds the URL to the exact declared byte count
      signableHeaders: new Set([CONTENT_TYPE_HEADER, 'content-length']),
    });

    return url;
  } catch (error) {
    throw new Error(
      `Failed to generate upload URL for key "${key}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Generate presigned download URL for file retrieval
 * Used by distribution engine to read video files
 *
 * @param key - Object key in R2 bucket
 * @returns Presigned GET URL that expires in 1 hour
 *
 * @example
 * const url = await getObjectUrl("users/123/video.mp4");
 * // Distribution engine can fetch from this URL
 * const response = await fetch(url);
 */
export async function getObjectUrl(key: string): Promise<string> {
  if (!key) {
    throw new Error('Object key is required');
  }

  const client = getR2Client();

  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
  });

  try {
    const url = await getSignedUrl(client, command, {
      expiresIn: DOWNLOAD_URL_EXPIRY,
    });

    return url;
  } catch (error) {
    throw new Error(
      `Failed to generate download URL for key "${key}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Delete object from R2 bucket
 * Used for cleanup after distribution completion or upload failures
 *
 * @param key - Object key to delete
 *
 * @example
 * await deleteObject("users/123/video.mp4");
 */
export async function deleteObject(key: string): Promise<void> {
  if (!key) {
    throw new Error('Object key is required');
  }

  const client = getR2Client();

  const command = new DeleteObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
  });

  try {
    await client.send(command);
  } catch (error) {
    throw new Error(
      `Failed to delete object "${key}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Retrieve object metadata (HEAD request) from R2 bucket.
 * Used by the upload complete endpoint to verify the actual stored byte size
 * before the quota counter is incremented.
 *
 * @param key - Object key in R2 bucket
 * @returns Actual size of the stored object in bytes (0 if ContentLength is absent)
 * @throws When the object does not exist or the HEAD request fails
 */
export async function headObject(key: string): Promise<number> {
  if (!key) {
    throw new Error('Object key is required');
  }

  const client = getR2Client();

  const command = new HeadObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
  });

  try {
    const response = await client.send(command);
    return response.ContentLength ?? 0;
  } catch (error) {
    throw new Error(
      `Failed to HEAD object "${key}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get bucket information (for health checks or diagnostics)
 * @returns Bucket name
 */
export function getBucketName(): string {
  return process.env.R2_BUCKET_NAME || '';
}

/**
 * Get R2 endpoint (for debugging/logging)
 * @returns R2 endpoint URL, or empty string if R2_ACCOUNT_ID is not set
 */
export function getR2Endpoint(): string {
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId) {
    return '';
  }
  return `https://${accountId}.r2.cloudflarestorage.com`;
}
