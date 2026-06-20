/**
 * Browser-side helpers for multipart R2 uploads with per-part retry and progress.
 */

/** Maximum PUT attempts per part before the overall upload fails. */
export const MULTIPART_PART_MAX_ATTEMPTS = 5;

/** Base delay in ms for exponential backoff between part retries (1s, 2s, 4s, …). */
export const MULTIPART_PART_BACKOFF_BASE_MS = 1000;

/**
 * Byte range covered by a multipart part (end exclusive, except the last part uses file size).
 * @param partNumber - 1-based part index from the presign response.
 * @param partSize - Fixed part size in bytes from presign.
 * @param fileSize - Total file size in bytes.
 * @returns Start/end offsets for `file.slice(start, end)`.
 */
export function getPartByteRange(
  partNumber: number,
  partSize: number,
  fileSize: number
): { start: number; end: number } {
  const start = (partNumber - 1) * partSize;
  const end = Math.min(partNumber * partSize, fileSize);
  return { start, end };
}

/**
 * Normalizes an `ETag` response header, stripping surrounding quotes when present.
 * @param raw - Raw `ETag` header value from a part PUT response.
 * @returns Normalized tag, or null when missing/blank.
 */
export function normalizePartEtag(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

/**
 * Resolves after the given delay. Injectable in tests via {@link uploadPartWithRetry}.
 * @param ms - Delay in milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Options for {@link uploadPartWithRetry}.
 */
export interface UploadPartWithRetryOptions {
  /** Presigned PUT URL for this part. */
  url: string;
  /** Part payload slice. */
  blob: Blob;
  /** Content-Type header for the part PUT. */
  contentType: string;
  /** Called with loaded bytes for the in-flight part. */
  onProgress: (loaded: number) => void;
  /** Returns true when the overall upload was cancelled. */
  isCancelled: () => boolean;
  /** Tracks the active XHR so callers can abort an in-flight part. */
  setXhr?: (xhr: XMLHttpRequest | null) => void;
  /** Factory for XHR instances (defaults to `() => new XMLHttpRequest()`). */
  xhrFactory?: () => XMLHttpRequest;
  /** Backoff sleep implementation (defaults to {@link sleep}). */
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * PUTs one multipart part via XHR, resolving with the normalized ETag on success.
 * The R2 bucket CORS policy must expose `ETag` (ExposeHeaders) or completion will fail
 * after all parts upload.
 * @param options - Part upload parameters.
 * @returns Normalized ETag from the response.
 */
export function putMultipartPart(
  options: Omit<UploadPartWithRetryOptions, 'isCancelled' | 'sleepFn' | 'xhrFactory' | 'setXhr'> & {
    setXhr?: (xhr: XMLHttpRequest | null) => void;
    xhrFactory?: () => XMLHttpRequest;
  }
): Promise<string> {
  const xhrFactory = options.xhrFactory ?? (() => new XMLHttpRequest());

  return new Promise((resolve, reject) => {
    const xhr = xhrFactory();
    options.setXhr?.(xhr);

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        options.onProgress(event.loaded);
      }
    });

    xhr.addEventListener('load', () => {
      options.setXhr?.(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        const eTag = normalizePartEtag(xhr.getResponseHeader('ETag'));
        if (!eTag) {
          reject(new Error('Missing ETag response header'));
          return;
        }
        resolve(eTag);
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => {
      options.setXhr?.(null);
      reject(new Error('Network error'));
    });

    xhr.addEventListener('abort', () => {
      options.setXhr?.(null);
      reject(new Error('UPLOAD_ABORTED'));
    });

    xhr.open('PUT', options.url);
    xhr.setRequestHeader('Content-Type', options.contentType);
    xhr.send(options.blob);
  });
}

/**
 * Uploads one part with exponential backoff retries. Returns null when cancelled or when all
 * attempts are exhausted.
 * @param options - Part upload and retry parameters.
 * @returns Normalized ETag on success, or null on cancel / exhausted retries.
 */
export async function uploadPartWithRetry(
  options: UploadPartWithRetryOptions
): Promise<string | null> {
  const sleepFn = options.sleepFn ?? sleep;

  for (let attempt = 1; attempt <= MULTIPART_PART_MAX_ATTEMPTS; attempt++) {
    if (options.isCancelled()) {
      return null;
    }

    try {
      return await putMultipartPart(options);
    } catch (error) {
      if (error instanceof Error && error.message === 'UPLOAD_ABORTED') {
        return null;
      }

      if (attempt === MULTIPART_PART_MAX_ATTEMPTS) {
        return null;
      }

      await sleepFn(MULTIPART_PART_BACKOFF_BASE_MS * 2 ** (attempt - 1));
    }
  }

  return null;
}

/**
 * Presign response shape used by the browser multipart upload flow.
 */
export interface MultipartPresignResponse {
  /** R2 multipart upload id. */
  uploadId: string;
  /** Object key in R2. */
  key: string;
  /** Fixed part size in bytes. */
  partSize: number;
  /** Presigned PUT URLs per part. */
  parts: { partNumber: number; url: string }[];
  /** Upload job id for complete/cancel routes. */
  uploadJobId: string;
}

/**
 * Completed part metadata sent to POST /api/uploads/:jobId/complete.
 */
export interface CompletedMultipartPart {
  /** 1-based part number. */
  partNumber: number;
  /** Normalized ETag from the part PUT response. */
  eTag: string;
}

/**
 * Best-effort cancel of an in-progress multipart upload job.
 * @param uploadJobId - Upload job id.
 * @param uploadId - R2 multipart upload id.
 */
export async function cancelMultipartUploadJob(
  uploadJobId: string,
  uploadId: string
): Promise<void> {
  await fetch(`/api/uploads/${uploadJobId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId }),
  }).catch(() => {});
}
