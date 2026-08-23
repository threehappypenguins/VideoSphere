import {
  SERMONAUDIO_API_BASE,
  resolveSermonAudioSignedPartUrl,
  sermonAudioJsonHeaders,
} from '@/lib/platforms/sermon-audio-http';
import { messageFromThrown } from '@/lib/utils/error-message';

/** Use SermonAudio's multipart S3 API instead of a single POST for files this size or larger. */
export const SERMONAUDIO_MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;

/** Multipart part size (S3 requires at least 5 MiB except for the last part). */
export const SERMONAUDIO_MULTIPART_PART_SIZE_BYTES = 32 * 1024 * 1024;

const SERMONAUDIO_S3_ENDPOINT = 'r2';
const SERMONAUDIO_S3_CREATE_URL = `${SERMONAUDIO_API_BASE}/v2/s3/create`;
const SERMONAUDIO_S3_SIGN_PART_URL = `${SERMONAUDIO_API_BASE}/v2/s3/sign_part`;
const SERMONAUDIO_S3_COMPLETE_URL = `${SERMONAUDIO_API_BASE}/v2/s3/complete_upload`;
const PART_PUT_MAX_ATTEMPTS = 3;
const PART_PUT_MAX_REDIRECTS = 2;
const PART_PUT_REDIRECT_STATUSES = new Set([307, 308]);

/**
 * Result of a SermonAudio multipart S3 video upload.
 */
export type SermonAudioS3UploadResult =
  | { ok: true }
  | {
      ok: false;
      code: string;
      message: string;
      statusCode?: number;
      details?: string;
    };

interface UploadSermonAudioVideoViaS3Input {
  apiKey: string;
  guid: string;
  videoStream: ReadableStream<Uint8Array>;
  contentLength: number;
  signal?: AbortSignal;
}

interface S3CreateResponse {
  uploadId?: string;
  upload_id?: string;
}

interface S3SignPartResponse {
  url?: string;
}

/**
 * Returns whether a SermonAudio video should use chunked S3 upload instead of a single POST.
 * @param contentLength - Declared video size in bytes.
 * @returns True when the file is large enough that a single POST commonly 502s on SermonAudio's nginx.
 */
export function shouldUseSermonAudioS3Multipart(contentLength: number): boolean {
  return contentLength >= SERMONAUDIO_MULTIPART_THRESHOLD_BYTES;
}

type SermonAudioS3UploadFailure = Extract<SermonAudioS3UploadResult, { ok: false }>;

/**
 * Flattens Node `fetch` failures so `error.cause` (e.g. unexpected redirect, ECONNRESET) is visible.
 * @param error - Thrown value from `fetch` or stream reads.
 * @returns Human-readable message including nested causes.
 */
function describeThrownError(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current != null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      const text = current.message.trim();
      if (text !== '' && !parts.includes(text)) {
        parts.push(text);
      }
      current = current.cause;
      continue;
    }
    const text = String(current).trim();
    if (text !== '' && !parts.includes(text)) {
      parts.push(text);
    }
    break;
  }

  return parts.join(': ') || 'Unknown error';
}

function toS3Error(
  code: string,
  message: string,
  statusCode?: number,
  details?: string
): SermonAudioS3UploadFailure {
  return {
    ok: false,
    code,
    message,
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(details !== undefined ? { details } : {}),
  };
}

async function readErrorDetails(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

async function postSermonAudioJson(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: sermonAudioJsonHeaders(apiKey),
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Reads the next multipart part from a video stream, up to `maxBytes`.
 * @param reader - Locked video stream reader.
 * @param carry - Unused bytes from the previous read.
 * @param maxBytes - Maximum part size in bytes.
 * @returns Part bytes and leftover carry, or `null` when the stream is exhausted.
 */
async function readNextPart(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  carry: Uint8Array,
  maxBytes: number
): Promise<{ part: Uint8Array; carry: Uint8Array } | null> {
  const chunks: Uint8Array[] = [];
  let buffered = 0;
  let rest = carry;

  while (buffered < maxBytes) {
    if (rest.byteLength === 0) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }
      rest = value;
    }

    const take = Math.min(rest.byteLength, maxBytes - buffered);
    chunks.push(rest.subarray(0, take));
    buffered += take;
    rest = take < rest.byteLength ? rest.subarray(take) : new Uint8Array(0);
  }

  if (buffered === 0) {
    return null;
  }

  return { part: concatChunks(chunks), carry: rest };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shouldRetryPartPut(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * PUTs one part, following a small number of 307/308 redirects to trusted S3/R2 hosts.
 * S3 and R2 commonly 307 to the canonical endpoint; `redirect: 'error'` turns that into
 * Node's opaque `fetch failed`.
 * @param url - Trusted signed PUT URL.
 * @param part - Part bytes.
 * @param signal - Optional abort signal.
 * @returns HTTP response, or a structured error when a redirect is untrusted.
 */
async function putPartFollowingTrustedRedirects(
  url: string,
  part: Uint8Array,
  signal?: AbortSignal
): Promise<Response | SermonAudioS3UploadFailure> {
  const headers = {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(part.byteLength),
  };
  let currentUrl = url;

  for (let hop = 0; hop <= PART_PUT_MAX_REDIRECTS; hop += 1) {
    const response = await fetch(currentUrl, {
      method: 'PUT',
      headers,
      body: Buffer.from(part),
      redirect: 'manual',
      ...(signal ? { signal } : {}),
    });

    if (!PART_PUT_REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get('Location')?.trim();
    await response.body?.cancel().catch(() => undefined);
    if (!location) {
      return response;
    }

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      return toS3Error(
        'SERMONAUDIO_S3_PART_URL_INVALID',
        'SermonAudio part PUT redirected to an invalid URL.',
        response.status,
        location
      );
    }

    const trusted = resolveSermonAudioSignedPartUrl(nextUrl.toString());
    if (!trusted) {
      return toS3Error(
        'SERMONAUDIO_S3_PART_URL_INVALID',
        'SermonAudio part PUT redirected to an invalid or untrusted URL.',
        response.status,
        nextUrl.origin
      );
    }

    currentUrl = trusted;
  }

  return toS3Error(
    'SERMONAUDIO_S3_PART_UPLOAD_FAILED',
    'SermonAudio part PUT redirected too many times.'
  );
}

/**
 * PUTs one S3 part to a signed URL, retrying transient HTTP and network failures.
 * @param url - Trusted signed PUT URL.
 * @param part - Part bytes.
 * @param signal - Optional abort signal.
 * @returns ETag on success, or a structured S3 error.
 */
async function putPartWithRetry(
  url: string,
  part: Uint8Array,
  signal?: AbortSignal
): Promise<{ ok: true; etag: string } | SermonAudioS3UploadFailure> {
  let lastStatus: number | undefined;
  let lastDetails: string | undefined;

  for (let attempt = 1; attempt <= PART_PUT_MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) {
      return toS3Error(
        'SERMONAUDIO_S3_PART_UPLOAD_FAILED',
        'SermonAudio multipart part upload was aborted.',
        undefined,
        messageFromThrown(signal.reason)
      );
    }

    try {
      const response = await putPartFollowingTrustedRedirects(url, part, signal);
      if (!(response instanceof Response)) {
        return response;
      }

      if (response.ok) {
        const etag = response.headers.get('ETag')?.trim();
        if (!etag) {
          return toS3Error(
            'SERMONAUDIO_S3_PART_UPLOAD_FAILED',
            'SermonAudio multipart part upload succeeded but no ETag was returned.'
          );
        }
        return { ok: true, etag };
      }

      lastStatus = response.status;
      lastDetails = await readErrorDetails(response);
      if (!shouldRetryPartPut(response.status) || attempt >= PART_PUT_MAX_ATTEMPTS) {
        break;
      }
    } catch (error) {
      lastStatus = undefined;
      lastDetails = describeThrownError(error);
      if (attempt >= PART_PUT_MAX_ATTEMPTS) {
        break;
      }
    }
    await delay(250 * 2 ** (attempt - 1));
  }

  return toS3Error(
    'SERMONAUDIO_S3_PART_UPLOAD_FAILED',
    'SermonAudio multipart part upload failed.',
    lastStatus,
    lastDetails
  );
}

/**
 * Uploads sermon video bytes through SermonAudio's documented chunked S3 API.
 * Creates a multipart upload named `{guid}.upload`, PUTs signed parts, then completes.
 * @param input - API key, media `guid`, video stream, declared length, and optional abort signal.
 * @returns Success, or a structured error with a SermonAudio S3 error code.
 */
export async function uploadSermonAudioVideoViaS3(
  input: UploadSermonAudioVideoViaS3Input
): Promise<SermonAudioS3UploadResult> {
  const guid = input.guid.trim();
  if (!guid) {
    return toS3Error(
      'SERMONAUDIO_MEDIA_GUID_MISSING',
      'SermonAudio media create succeeded but no guid was returned for multipart upload.'
    );
  }

  const filename = `${guid}.upload`;
  const { apiKey, videoStream, contentLength, signal } = input;
  const reader = videoStream.getReader();

  try {
    const createResponse = await postSermonAudioJson(
      SERMONAUDIO_S3_CREATE_URL,
      apiKey,
      { filename, s3Endpoint: SERMONAUDIO_S3_ENDPOINT },
      signal
    );
    if (!createResponse.ok) {
      return toS3Error(
        'SERMONAUDIO_S3_CREATE_FAILED',
        'Failed to create SermonAudio multipart upload.',
        createResponse.status,
        await readErrorDetails(createResponse)
      );
    }

    const created = (await createResponse.json().catch(() => ({}))) as S3CreateResponse;
    const uploadId = created.uploadId?.trim() || created.upload_id?.trim();
    if (!uploadId) {
      return toS3Error(
        'SERMONAUDIO_S3_CREATE_FAILED',
        'SermonAudio multipart create succeeded but no uploadId was returned.'
      );
    }

    const completedParts: Array<{ PartNumber: number; ETag: string }> = [];
    let carry = new Uint8Array(0);
    let partNumber = 1;
    let uploadedBytes = 0;

    for (;;) {
      const next = await readNextPart(reader, carry, SERMONAUDIO_MULTIPART_PART_SIZE_BYTES);
      if (!next) {
        break;
      }
      carry = Uint8Array.from(next.carry);
      const part = next.part;
      uploadedBytes += part.byteLength;

      const signResponse = await postSermonAudioJson(
        SERMONAUDIO_S3_SIGN_PART_URL,
        apiKey,
        {
          uploadId,
          partNumber,
          filename,
          s3Endpoint: SERMONAUDIO_S3_ENDPOINT,
        },
        signal
      );
      if (!signResponse.ok) {
        return toS3Error(
          'SERMONAUDIO_S3_SIGN_PART_FAILED',
          'Failed to sign SermonAudio multipart part.',
          signResponse.status,
          await readErrorDetails(signResponse)
        );
      }

      const signed = (await signResponse.json().catch(() => ({}))) as S3SignPartResponse;
      const rawPartUrl = signed.url?.trim();
      if (!rawPartUrl) {
        return toS3Error(
          'SERMONAUDIO_S3_SIGN_PART_FAILED',
          'SermonAudio part sign succeeded but no url was returned.'
        );
      }

      const partUrl = resolveSermonAudioSignedPartUrl(rawPartUrl);
      if (!partUrl) {
        return toS3Error(
          'SERMONAUDIO_S3_PART_URL_INVALID',
          'SermonAudio part sign returned an invalid or untrusted URL.'
        );
      }

      const putResult = await putPartWithRetry(partUrl, part, signal);
      if (putResult.ok !== true) {
        return putResult;
      }

      completedParts.push({ PartNumber: partNumber, ETag: putResult.etag });
      partNumber += 1;
    }

    if (completedParts.length === 0) {
      return toS3Error(
        'SERMONAUDIO_S3_PART_UPLOAD_FAILED',
        'SermonAudio multipart upload received no video bytes.'
      );
    }

    if (uploadedBytes !== contentLength) {
      return toS3Error(
        'SERMONAUDIO_S3_PART_UPLOAD_FAILED',
        `SermonAudio multipart upload size mismatch (sent ${uploadedBytes} bytes, expected ${contentLength}).`
      );
    }

    const completeResponse = await postSermonAudioJson(
      SERMONAUDIO_S3_COMPLETE_URL,
      apiKey,
      {
        uploadId,
        filename,
        upload_data: { upload_parts: completedParts },
        size: contentLength,
        s3Endpoint: SERMONAUDIO_S3_ENDPOINT,
      },
      signal
    );
    if (!completeResponse.ok) {
      return toS3Error(
        'SERMONAUDIO_S3_COMPLETE_FAILED',
        'Failed to complete SermonAudio multipart upload.',
        completeResponse.status,
        await readErrorDetails(completeResponse)
      );
    }

    return { ok: true };
  } catch (error) {
    return toS3Error(
      'SERMONAUDIO_S3_UPLOAD_UNEXPECTED',
      'Unexpected error during SermonAudio multipart upload.',
      undefined,
      describeThrownError(error)
    );
  } finally {
    reader.releaseLock();
    await videoStream.cancel().catch(() => undefined);
  }
}
