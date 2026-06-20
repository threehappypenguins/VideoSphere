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

import { Readable } from 'node:stream';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Constants
const UPLOAD_URL_EXPIRY = 900; // 15 minutes
const DOWNLOAD_URL_EXPIRY = 3600; // 1 hour
const CONTENT_TYPE_HEADER = 'content-type';

/** Default multipart part size (32 MiB) when callers do not specify one. */
export const DEFAULT_MULTIPART_PART_SIZE_BYTES = 32 * 1024 * 1024;

/** Minimum part size for S3/R2 multipart uploads (except the last part). */
export const MIN_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;

/** Maximum number of parts allowed in a single multipart upload. */
export const MAX_MULTIPART_PART_COUNT = 10_000;

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
 * Thrown by headObject when the requested key does not exist in R2.
 * Callers can catch this specifically to distinguish "object missing" from
 * other R2 failures.
 */
export class R2ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Object not found in R2: "${key}"`);
    this.name = 'R2ObjectNotFoundError';
  }
}

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
 * @param contentLength - Exact file size in bytes (validated server-side after upload via HEAD)
 * @returns Presigned PUT URL that expires in 15 minutes
 *
 * Security:
 * - Content-Type is locked into the signature, preventing upload of wrong file types.
 * - Content-Length is NOT signed here because browsers treat it as a "forbidden"
 *   request header and set it automatically from the body. Signing it would cause
 *   R2 to reject every browser upload with a SignatureDoesNotMatch error.
 *   Size enforcement is handled server-side in POST /api/uploads/[jobId]/complete
 *   via a HEAD request that checks the object's actual byte count against the
 *   declared fileSize (layer 2).
 *
 * @example
 * const url = await getPresignedUploadUrl("users/123/video.mp4", "video/mp4", 1024 * 1024);
 * // Client can PUT file directly to R2 with this URL
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
    // ContentLength is intentionally not set on the command: browsers set
    // Content-Length automatically from the XHR body and will not honour a
    // manually assigned value, so including it in the signature would cause
    // every preflight/PUT to fail with SignatureDoesNotMatch.
  });

  try {
    const url = await getSignedUrl(client, command, {
      expiresIn: UPLOAD_URL_EXPIRY,
      // Only sign content-type — prevents MIME-type abuse while keeping the
      // signature compatible with the browser's forbidden-header restrictions.
      signableHeaders: new Set([CONTENT_TYPE_HEADER]),
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
 * Computes multipart upload part count and fixed part size for a file.
 * @param fileSize - Total object size in bytes.
 * @param partSizeBytes - Part size in bytes (default {@link DEFAULT_MULTIPART_PART_SIZE_BYTES}).
 * @returns Part count and the part size used for every part except the last (which may be smaller).
 * @throws When `fileSize` is invalid, `partSizeBytes` is below 5 MiB, or the plan would exceed 10,000 parts.
 */
export function computeMultipartPlan(
  fileSize: number,
  partSizeBytes: number = DEFAULT_MULTIPART_PART_SIZE_BYTES
): { partCount: number; partSize: number } {
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw new Error('File size must be a positive number');
  }
  if (!Number.isFinite(partSizeBytes) || partSizeBytes < MIN_MULTIPART_PART_SIZE_BYTES) {
    throw new Error(
      `Part size must be at least ${MIN_MULTIPART_PART_SIZE_BYTES} bytes (5 MiB) for multipart uploads`
    );
  }

  const partCount = Math.ceil(fileSize / partSizeBytes);
  if (partCount > MAX_MULTIPART_PART_COUNT) {
    throw new Error(
      `Multipart upload would require ${partCount} parts (maximum ${MAX_MULTIPART_PART_COUNT}). ` +
        'Increase part size or reduce file size.'
    );
  }

  return { partCount, partSize: partSizeBytes };
}

/**
 * Starts a multipart upload in R2 and returns the provider upload id.
 * @param key - Object key in the bucket.
 * @param contentType - MIME type stored on the completed object.
 * @returns Upload id from CreateMultipartUpload.
 */
export async function createMultipartUpload(key: string, contentType: string): Promise<string> {
  if (!key) {
    throw new Error('Object key is required');
  }
  if (!contentType) {
    throw new Error('Content type is required');
  }

  const client = getR2Client();

  const command = new CreateMultipartUploadCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
    ContentType: contentType,
  });

  try {
    const response = await client.send(command);
    const uploadId = response.UploadId?.trim();
    if (!uploadId) {
      throw new Error('CreateMultipartUpload did not return an UploadId');
    }
    return uploadId;
  } catch (error) {
    if (error instanceof Error && error.message.includes('CreateMultipartUpload did not return')) {
      throw error;
    }
    throw new Error(
      `Failed to create multipart upload for key "${key}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Generates presigned PUT URLs for each part of an in-progress multipart upload.
 * @param key - Object key in the bucket.
 * @param uploadId - Multipart upload id from {@link createMultipartUpload}.
 * @param partCount - Number of parts (1-based part numbers through `partCount`).
 * @param expiresInSeconds - Presigned URL lifetime in seconds.
 * @returns Presigned URLs indexed by part number.
 */
export async function getPresignedUploadPartUrls(
  key: string,
  uploadId: string,
  partCount: number,
  expiresInSeconds: number
): Promise<{ partNumber: number; url: string }[]> {
  if (!key) {
    throw new Error('Object key is required');
  }
  if (!uploadId) {
    throw new Error('Upload ID is required');
  }
  if (!Number.isFinite(partCount) || partCount <= 0) {
    throw new Error('Part count must be a positive number');
  }
  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new Error('Expiry must be a positive number of seconds');
  }

  const client = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME!;

  try {
    return await Promise.all(
      Array.from({ length: partCount }, async (_, index) => {
        const partNumber = index + 1;
        const command = new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        });
        const url = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
        return { partNumber, url };
      })
    );
  } catch (error) {
    throw new Error(
      `Failed to generate multipart part URLs for key "${key}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Completes a multipart upload after all parts have been uploaded.
 * @param key - Object key in the bucket.
 * @param uploadId - Multipart upload id from {@link createMultipartUpload}.
 * @param parts - Uploaded parts with provider ETags, sorted ascending by part number before send.
 */
export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: { partNumber: number; eTag: string }[]
): Promise<void> {
  if (!key) {
    throw new Error('Object key is required');
  }
  if (!uploadId) {
    throw new Error('Upload ID is required');
  }
  if (!parts.length) {
    throw new Error('At least one uploaded part is required');
  }

  for (const part of parts) {
    if (!Number.isFinite(part.partNumber) || part.partNumber <= 0) {
      throw new Error('Each part must have a positive part number');
    }
    if (!part.eTag?.trim()) {
      throw new Error('Each part must include an ETag');
    }
  }

  const client = getR2Client();
  const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);

  const command = new CompleteMultipartUploadCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: sortedParts.map((part) => ({
        PartNumber: part.partNumber,
        ETag: part.eTag,
      })),
    },
  });

  try {
    await client.send(command);
  } catch (error) {
    throw new Error(
      `Failed to complete multipart upload for key "${key}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Aborts an in-progress multipart upload. Errors are logged and not propagated so cleanup
 * paths do not mask the original failure.
 * @param key - Object key in the bucket.
 * @param uploadId - Multipart upload id to abort.
 */
export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  if (!key) {
    throw new Error('Object key is required');
  }
  if (!uploadId) {
    throw new Error('Upload ID is required');
  }

  const client = getR2Client();

  try {
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
        UploadId: uploadId,
      })
    );
  } catch (error) {
    console.warn(
      `Failed to abort multipart upload for key "${key}" (uploadId "${uploadId}"): ${
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
 * against the 5 GB cap. Quota is enforced earlier, at presign time, via
 * incrementUsageIfAllowed in POST /api/uploads/presign.
 *
 * @param key - Object key in R2 bucket
 * @returns Actual size of the stored object in bytes (0 if ContentLength is absent)
 * @throws {R2ObjectNotFoundError} When the object does not exist in R2
 * @throws {Error} When the HEAD request fails for any other reason
 */
export async function headObject(key: string, options?: { signal?: AbortSignal }): Promise<number> {
  const meta = await headObjectMetadata(key, options);
  return meta.contentLength;
}

/**
 * Executes head object metadata.
 * @param key - Input value for key.
 * @param options - Optional configuration values.
 * @returns The computed result.
 */
export async function headObjectMetadata(
  key: string,
  options?: { signal?: AbortSignal }
): Promise<{ contentLength: number; contentType?: string }> {
  if (!key) {
    throw new Error('Object key is required');
  }

  const client = getR2Client();

  const command = new HeadObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
  });

  try {
    const response = await client.send(
      command,
      options?.signal ? { abortSignal: options.signal } : {}
    );
    const contentLength = response.ContentLength ?? 0;
    const ct = response.ContentType?.trim();
    return {
      contentLength,
      ...(ct ? { contentType: ct } : {}),
    };
  } catch (error) {
    const status =
      error != null &&
      typeof error === 'object' &&
      '$metadata' in error &&
      typeof (error as { $metadata: unknown }).$metadata === 'object' &&
      (error as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode;
    if (status === 404) {
      throw new R2ObjectNotFoundError(key);
    }
    throw new Error(
      `Failed to HEAD object "${key}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/** Options for streaming reads from R2 via GetObject. */
export interface GetObjectStreamOptions {
  signal?: AbortSignal;
  /**
   * When set, requests only bytes from this index through EOF (S3 `Range: bytes=N-`).
   * Returned {@link contentLength} is still the full object size for resumable upload headers.
   */
  rangeStart?: number;
}

/**
 * Parses the total object size from an S3 `Content-Range` response header.
 * @param contentRange - Raw `Content-Range` header value.
 * @returns Total object size in bytes, or null when missing or invalid.
 */
function parseS3ContentRangeTotal(contentRange: string | undefined): number | null {
  if (!contentRange) return null;
  const match = /^bytes \d+-\d+\/(\d+)$/.exec(contentRange.trim());
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isFinite(total) && total > 0 ? total : null;
}

/**
 * Opens an R2 object for streaming reads via the S3 GetObject body.
 * @param key - R2 object key.
 * @param options - Optional abort signal and byte range for partial reads.
 * @returns Node readable body, full object content length, and MIME type.
 */
async function openObjectNodeStream(
  key: string,
  options?: GetObjectStreamOptions
): Promise<{
  readable: Readable;
  contentLength: number;
  contentType: string;
}> {
  if (!key) {
    throw new Error('Object key is required');
  }

  const rangeStart = options?.rangeStart ?? 0;
  if (!Number.isInteger(rangeStart) || rangeStart < 0) {
    throw new Error('rangeStart must be a non-negative integer');
  }

  const client = getR2Client();

  let response;
  try {
    response = await client.send(
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
        ...(rangeStart > 0 ? { Range: `bytes=${rangeStart}-` } : {}),
      }),
      options?.signal ? { abortSignal: options.signal } : {}
    );
  } catch (error) {
    const status =
      error != null &&
      typeof error === 'object' &&
      '$metadata' in error &&
      typeof (error as { $metadata: unknown }).$metadata === 'object' &&
      (error as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode;
    if (status === 404) {
      throw new R2ObjectNotFoundError(key);
    }
    throw new Error(
      `Failed to open object stream for key "${key}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!response.Body) {
    throw new Error(`R2 GetObject returned empty body for key "${key}"`);
  }

  let contentLength =
    parseS3ContentRangeTotal(response.ContentRange) ?? response.ContentLength ?? 0;
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    contentLength = await headObject(key, { signal: options?.signal });
  }
  if (contentLength <= 0) {
    throw new Error(`R2 object has invalid or unknown size for key "${key}"`);
  }
  if (rangeStart > 0 && rangeStart >= contentLength) {
    throw new Error(
      `rangeStart ${rangeStart} is at or beyond object size ${contentLength} for key "${key}"`
    );
  }

  const trimmedType = response.ContentType?.trim();
  const contentType =
    trimmedType && trimmedType.length > 0 ? trimmedType : 'application/octet-stream';

  return {
    readable: response.Body as Readable,
    contentLength,
    contentType,
  };
}

/**
 * Stream object bytes from R2 as a Node.js {@link Readable}.
 * Prefer this for ffmpeg stdin piping; avoid converting to a Web ReadableStream first.
 * @param key - R2 object key.
 * @param options - Optional abort signal and byte range for partial reads.
 * @returns Node readable body, full object content length, and MIME type.
 */
export async function getObjectNodeStream(
  key: string,
  options?: GetObjectStreamOptions
): Promise<{
  readable: Readable;
  contentLength: number;
  contentType: string;
}> {
  return openObjectNodeStream(key, options);
}

/**
 * Stream object bytes from R2 using the S3 API (not HTTP fetch to a presigned URL).
 *
 * Each call performs its own GetObject and returns an independent Web ReadableStream.
 * That lets multiple platforms read the same object in parallel without sharing a
 * single fetch() Response body (which can trigger "body disturbed or locked"), and
 * without buffering the entire object in memory (important for multi‑GB files).
 */
export async function getObjectWebStream(
  key: string,
  options?: GetObjectStreamOptions
): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentLength: number;
  contentType: string;
}> {
  const { readable, contentLength, contentType } = await openObjectNodeStream(key, options);
  const stream = Readable.toWeb(readable) as ReadableStream<Uint8Array>;
  return { stream, contentLength, contentType };
}

/**
 * Whether `r2ObjectKey` is under this user's presigned staging prefix.
 * Keys are created by `generateObjectKey` in `app/api/uploads/presign/route.ts`:
 * `temp/uploads/{userId}/{timestamp}-{uuid}/{sanitizedFilename}`.
 *
 * Rejects path traversal (`..`, backslashes) and userIds containing separators so
 * `temp/uploads/../other/` style keys cannot satisfy the check.
 */
export function isTempUploadObjectKeyForUser(r2ObjectKey: string, userId: string): boolean {
  if (userId.length === 0 || r2ObjectKey.length === 0) return false;
  if (userId.includes('/') || userId.includes('\\') || userId.includes('..')) return false;
  if (r2ObjectKey.includes('..') || r2ObjectKey.includes('\\')) return false;
  const prefix = `temp/uploads/${userId}/`;
  if (!r2ObjectKey.startsWith(prefix)) return false;
  return r2ObjectKey.length > prefix.length;
}

/** Staging prefix for draft thumbnail PUTs before `complete` attaches them (lifecycle may expire orphans). */
const DRAFT_THUMBNAIL_PENDING_PREFIX = 'temp/draft-thumbnail-pending/';

/** Final prefix for thumbnails bound to a draft document. */
const DRAFT_THUMBNAIL_FINAL_PREFIX = 'draft-thumbnails/';

function safeUserDraftSegments(userId: string, draftId: string): boolean {
  if (!userId || !draftId) return false;
  if (
    userId.includes('/') ||
    userId.includes('\\') ||
    userId.includes('..') ||
    draftId.includes('/') ||
    draftId.includes('\\') ||
    draftId.includes('..')
  ) {
    return false;
  }
  return true;
}

/**
 * Same rules as {@link safeUserDraftSegments} plus safe filename suffix segments, so
 * generated keys always satisfy {@link isDraftThumbnailPendingKeyForUser} /
 * {@link isDraftThumbnailFinalKeyForUser}.
 */
function assertDraftThumbnailKeyInputs(
  userId: string,
  draftId: string,
  uniqueId: string,
  extension: string
): void {
  if (!safeUserDraftSegments(userId, draftId)) {
    throw new Error(
      'Invalid userId or draftId for draft thumbnail key (must not be empty or contain /, \\, or ..)'
    );
  }
  if (!uniqueId || uniqueId.includes('/') || uniqueId.includes('\\') || uniqueId.includes('..')) {
    throw new Error('Invalid unique id for draft thumbnail key (must not contain /, \\, or ..)');
  }
  const rawExt = extension.startsWith('.') ? extension.slice(1) : extension;
  if (!rawExt || !/^[a-z0-9]+$/i.test(rawExt) || rawExt.length > 16) {
    throw new Error('Invalid file extension for draft thumbnail key');
  }
}

/**
 * Pending thumbnail key after presign (before complete). Use bucket lifecycle rules on
 * `temp/draft-thumbnail-pending/` to prune abandoned uploads.
 */
export function buildDraftThumbnailPendingKey(
  userId: string,
  draftId: string,
  uniqueId: string,
  extension: string
): string {
  assertDraftThumbnailKeyInputs(userId, draftId, uniqueId, extension);
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  return `${DRAFT_THUMBNAIL_PENDING_PREFIX}${userId}/${draftId}/${uniqueId}${ext}`;
}

/**
 * Executes build draft thumbnail final key.
 * @param userId - Input value for user id.
 * @param draftId - Input value for draft id.
 * @param uniqueId - Input value for unique id.
 * @param extension - Input value for extension.
 * @returns The computed result.
 */
export function buildDraftThumbnailFinalKey(
  userId: string,
  draftId: string,
  uniqueId: string,
  extension: string
): string {
  assertDraftThumbnailKeyInputs(userId, draftId, uniqueId, extension);
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  return `${DRAFT_THUMBNAIL_FINAL_PREFIX}${userId}/${draftId}/${uniqueId}${ext}`;
}

/**
 * Executes is draft thumbnail pending key for user.
 * @param key - Input value for key.
 * @param userId - Input value for user id.
 * @param draftId - Input value for draft id.
 * @returns The computed result.
 */
export function isDraftThumbnailPendingKeyForUser(
  key: string,
  userId: string,
  draftId: string
): boolean {
  if (!safeUserDraftSegments(userId, draftId)) return false;
  if (key.includes('..') || key.includes('\\')) return false;
  const prefix = `${DRAFT_THUMBNAIL_PENDING_PREFIX}${userId}/${draftId}/`;
  return key.startsWith(prefix) && key.length > prefix.length;
}

/**
 * Executes is draft thumbnail final key for user.
 * @param key - Input value for key.
 * @param userId - Input value for user id.
 * @param draftId - Input value for draft id.
 * @returns The computed result.
 */
export function isDraftThumbnailFinalKeyForUser(
  key: string,
  userId: string,
  draftId: string
): boolean {
  if (!safeUserDraftSegments(userId, draftId)) return false;
  if (key.includes('..') || key.includes('\\')) return false;
  const prefix = `${DRAFT_THUMBNAIL_FINAL_PREFIX}${userId}/${draftId}/`;
  return key.startsWith(prefix) && key.length > prefix.length;
}

/**
 * Server-side copy within the same bucket (pending → final thumbnail key).
 */
export async function copyObjectInBucket(sourceKey: string, destKey: string): Promise<void> {
  if (!sourceKey || !destKey) {
    throw new Error('Object keys are required');
  }
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME!;
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: destKey,
      CopySource: `${bucket}/${sourceKey}`,
    })
  );
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
