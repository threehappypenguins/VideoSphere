import type { PlatformUploadError, PlatformUploadResult } from '@/lib/platforms/types';

type PlatformUploadFailure = Extract<PlatformUploadResult, { ok: false }>;

/** Resumable session fields loaded from a platform_upload row for cross-attempt resume. */
export interface GoogleResumablePersistedState {
  resumableUploadUrl?: string | null;
  resumableBytesConfirmed?: number | null;
  resumableUpdatedAt?: string | null;
}

/** Resumable session snapshot persisted after upload progress. */
export interface GoogleResumableStateUpdate {
  resumableUploadUrl: string;
  resumableBytesConfirmed: number;
  resumableUpdatedAt: string;
}

/** Google requires each chunk (except the last) to be a multiple of 256 KiB. */
const GOOGLE_RESUMABLE_CHUNK_MULTIPLE = 256 * 1024;
const GOOGLE_RESUMABLE_CHUNK_TARGET = 8 * 1024 * 1024;

/**
 * Computes the next resumable upload chunk size for Google's protocol.
 * @param remaining - Bytes remaining in the object.
 * @returns Chunk size in bytes.
 */
export function nextGoogleResumableChunkSize(remaining: number): number {
  if (remaining <= 0) return 0;
  if (remaining < GOOGLE_RESUMABLE_CHUNK_MULTIPLE) return remaining;
  const capped = Math.min(GOOGLE_RESUMABLE_CHUNK_TARGET, remaining);
  const aligned =
    Math.floor(capped / GOOGLE_RESUMABLE_CHUNK_MULTIPLE) * GOOGLE_RESUMABLE_CHUNK_MULTIPLE;
  return aligned >= GOOGLE_RESUMABLE_CHUNK_MULTIPLE ? aligned : remaining;
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

async function readExactFromStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  carry: Uint8Array,
  need: number
): Promise<{ data: Uint8Array; carry: Uint8Array }> {
  if (need === 0) return { data: new Uint8Array(0), carry };
  const chunks: Uint8Array[] = [];
  let buf = carry;

  while (need > 0) {
    if (buf.length > 0) {
      const take = Math.min(buf.length, need);
      chunks.push(buf.subarray(0, take));
      buf = buf.subarray(take);
      need -= take;
      continue;
    }
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length > 0) {
      buf = value;
    }
  }

  if (need > 0) {
    throw new Error(`Video stream ended ${need} byte(s) earlier than Content-Length.`);
  }
  return { data: concatUint8Arrays(chunks), carry: buf };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readApiErrorDetails(response: Response): Promise<string | undefined> {
  const raw = await response.text().catch(() => '');
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string; errors?: Array<{ reason?: string; message?: string }> };
    };
    const topMessage = parsed.error?.message?.trim();
    const firstError = parsed.error?.errors?.[0];
    const reason = firstError?.reason?.trim();
    const reasonMessage = firstError?.message?.trim();

    if (reason && reasonMessage) return `${reason}: ${reasonMessage}`;
    if (reasonMessage) return reasonMessage;
    if (topMessage) return topMessage;
  } catch {
    // non-JSON response body; fall back to text
  }

  return raw.slice(0, 1000);
}

function toFailure(
  code: string,
  message: string,
  statusCode?: number,
  details?: string
): PlatformUploadFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      statusCode,
      details,
    },
  };
}

/**
 * Parse the Range header on a 308 Resume Incomplete from Google resumable upload.
 * @param headerValue - Raw Range response header.
 * @returns Last byte index received (inclusive), or null when missing/invalid.
 */
export function parseGoogleResumable308RangeLastByteInclusive(
  headerValue: string | null
): number | null {
  if (headerValue == null || headerValue.trim() === '') return null;
  const s = headerValue.trim();
  if (s.includes('*')) return null;
  const m = /^bytes[\t ]*[= ][\t ]*(\d+)[\t ]*-[ \t]*(\d+)\s*$/i.exec(s);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
  return end;
}

/**
 * Outcome of probing a stored Google resumable session (status query PUT with bytes-star-slash-total).
 * @property status - resume when bytes remain; complete when the session already finished; invalid when the session must be discarded; unconfirmed when the probe failed transiently and the stored offset should be used.
 * @property bytesConfirmed - Next byte offset to send when status is resume.
 * @property resourceId - Provider resource id when status is complete.
 */
export type GoogleResumableProbeResult =
  | { status: 'resume'; bytesConfirmed: number }
  | { status: 'complete'; resourceId: string }
  | { status: 'invalid' }
  | { status: 'unconfirmed' };

/** HTTP statuses that mean the resumable session URI is gone and must not be reused. */
const CONFIRMED_GONE_RESUMABLE_SESSION_STATUSES = new Set([404, 410]);

function isTransientResumableProbeHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

export function resumeOffsetFromStored(
  bytesConfirmed: number | null | undefined,
  totalBytes: number
): number {
  if (
    typeof bytesConfirmed !== 'number' ||
    !Number.isFinite(bytesConfirmed) ||
    bytesConfirmed < 0
  ) {
    return 0;
  }
  const offset = Math.floor(bytesConfirmed);
  if (totalBytes > 0 && offset >= totalBytes) {
    return 0;
  }
  return offset;
}

/**
 * Probes a stored resumable upload session to learn the provider-confirmed byte offset.
 * @param input - Session URL, auth, and declared total file size.
 * @returns Whether to resume, treat the upload as already complete, discard the session, or fall back to the stored offset when the probe is inconclusive.
 */
export async function probeGoogleResumableSession(input: {
  sessionUrl: string;
  accessToken: string;
  totalBytes: number;
  contentType: string;
  signal?: AbortSignal;
}): Promise<GoogleResumableProbeResult> {
  try {
    let res: Response | null = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      res = await fetch(input.sessionUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Length': '0',
          'Content-Range': `bytes */${input.totalBytes}`,
          'Content-Type': input.contentType,
        },
        ...(input.signal ? { signal: input.signal } : {}),
      });

      if (isTransientResumableProbeHttpStatus(res.status)) {
        if (attempt < 4) {
          await sleep(2 ** (attempt - 1) * 1000);
          continue;
        }
        return { status: 'unconfirmed' };
      }
      break;
    }

    if (!res) {
      return { status: 'unconfirmed' };
    }

    if (CONFIRMED_GONE_RESUMABLE_SESSION_STATUSES.has(res.status)) {
      return { status: 'invalid' };
    }

    if (res.status === 308) {
      const lastReceived = parseGoogleResumable308RangeLastByteInclusive(res.headers.get('Range'));
      const bytesConfirmed = lastReceived === null ? 0 : lastReceived + 1;
      if (bytesConfirmed >= input.totalBytes) {
        return { status: 'invalid' };
      }
      return { status: 'resume', bytesConfirmed };
    }

    if (res.status === 200 || res.status === 201) {
      const raw = await res.text().catch(() => '');
      let uploadPayload: { id?: string } = {};
      if (raw) {
        try {
          uploadPayload = JSON.parse(raw) as { id?: string };
        } catch {
          /* ignore */
        }
      }
      const resourceId = uploadPayload.id?.trim();
      if (resourceId) {
        return { status: 'complete', resourceId };
      }
      return { status: 'unconfirmed' };
    }

    return { status: 'unconfirmed' };
  } catch {
    return { status: 'unconfirmed' };
  }
}

/**
 * Error codes passed to {@link uploadGoogleResumableInChunks}.
 */
export interface GoogleResumableUploadErrorCodes {
  aborted: string;
  streamReadFailed: string;
  emptyChunk: string;
  noResponse: string;
  uploadFailed: string;
  rangeInvalid: string;
  rangeMismatch: string;
  incomplete: string;
}

/**
 * User-facing messages passed to {@link uploadGoogleResumableInChunks}.
 */
export interface GoogleResumableUploadMessages {
  aborted: string;
  streamReadFailed: string;
  emptyChunk: string;
  noResponse: string;
  uploadFailed: string;
  rangeInvalid: string;
  rangeMismatch: string;
  incomplete: string;
}

/**
 * Returns whether a resumable upload failure should keep the persisted session for a later retry.
 * @param result - Structured upload failure.
 * @param extraRetryableCodes - Platform-specific error codes that remain retryable.
 * @returns True when the session should be retained across attempts.
 */
export function isRetryableGoogleResumableUploadFailure(
  result: PlatformUploadFailure,
  extraRetryableCodes: readonly string[]
): boolean {
  const status = result.error.statusCode;
  if (status === 408 || status === 429) return true;
  if (status !== undefined && status >= 500 && status < 600) return true;
  return extraRetryableCodes.includes(result.error.code);
}

async function skipStreamBytes(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  initialCarry: Uint8Array,
  bytesToSkip: number
): Promise<Uint8Array> {
  let carry = initialCarry;
  let remaining = bytesToSkip;

  while (remaining > 0) {
    const take = Math.min(remaining, GOOGLE_RESUMABLE_CHUNK_TARGET);
    const skipped = await readExactFromStream(reader, carry, take);
    carry = skipped.carry;
    remaining -= take;
  }

  return carry;
}

/**
 * Resumable upload in 256 KiB–aligned chunks (Google's recommended protocol).
 * @param input - Session URL, stream, and platform-specific error mapping.
 * @returns Platform upload result on success or failure.
 */
export async function uploadGoogleResumableInChunks(input: {
  sessionUrl: string;
  accessToken: string;
  stream: ReadableStream<Uint8Array>;
  totalBytes: number;
  contentType: string;
  startOffset?: number;
  onBytesConfirmed?: (bytesConfirmed: number) => Promise<void>;
  signal?: AbortSignal;
  errorCodes: GoogleResumableUploadErrorCodes;
  messages: GoogleResumableUploadMessages;
  buildSuccessResult: (payload: Record<string, unknown>) => PlatformUploadResult;
}): Promise<PlatformUploadResult> {
  const reader = input.stream.getReader();
  let carry: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let offset = input.startOffset ?? 0;
  const {
    sessionUrl,
    accessToken,
    contentType,
    totalBytes: total,
    signal,
    onBytesConfirmed,
    errorCodes,
    messages,
    buildSuccessResult,
  } = input;

  const notifyBytesConfirmed = async (nextOffset: number) => {
    if (!onBytesConfirmed) return;
    await onBytesConfirmed(nextOffset);
  };

  try {
    if (offset > 0) {
      carry = await skipStreamBytes(reader, carry, offset);
    }

    while (offset < total) {
      if (signal?.aborted) {
        const reason = signal.reason;
        return toFailure(
          errorCodes.aborted,
          reason instanceof Error ? reason.message : messages.aborted,
          499
        );
      }
      const remaining = total - offset;
      const chunkSize = nextGoogleResumableChunkSize(remaining);
      let chunk: Uint8Array<ArrayBufferLike>;
      try {
        const r = await readExactFromStream(reader, carry, chunkSize);
        chunk = r.data;
        carry = r.carry;
      } catch (e) {
        return toFailure(
          errorCodes.streamReadFailed,
          e instanceof Error ? e.message : messages.streamReadFailed,
          500
        );
      }

      if (chunk.length === 0) {
        return toFailure(errorCodes.emptyChunk, messages.emptyChunk, 400);
      }

      const lastByte = offset + chunk.length - 1;
      const contentRange = `bytes ${offset}-${lastByte}/${total}`;

      let res: Response | null = null;
      for (let attempt = 1; attempt <= 4; attempt++) {
        res = await fetch(sessionUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': contentType,
            'Content-Length': String(chunk.length),
            'Content-Range': contentRange,
          },
          body: chunk as BodyInit,
          ...(signal ? { signal } : {}),
        });

        if (res.status === 408 || (res.status >= 500 && res.status < 600)) {
          if (attempt < 4) {
            await sleep(2 ** (attempt - 1) * 1000);
            continue;
          }
        }
        break;
      }

      if (!res) {
        return toFailure(errorCodes.noResponse, messages.noResponse, 500);
      }

      if (res.status === 200 || res.status === 201) {
        const raw = await res.text().catch(() => '');
        let uploadPayload: Record<string, unknown> = {};
        if (raw) {
          try {
            uploadPayload = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            /* ignore */
          }
        }
        await notifyBytesConfirmed(total);
        return buildSuccessResult(uploadPayload);
      }

      if (res.status === 308) {
        const chunkStart = offset;
        const lastReceived = parseGoogleResumable308RangeLastByteInclusive(
          res.headers.get('Range')
        );
        let nextAbsolute: number;
        if (lastReceived === null) {
          nextAbsolute = chunkStart + chunk.length;
        } else {
          nextAbsolute = lastReceived + 1;
          if (nextAbsolute < chunkStart) {
            return toFailure(errorCodes.rangeInvalid, messages.rangeInvalid, 502);
          }
          if (nextAbsolute > chunkStart + chunk.length) {
            nextAbsolute = chunkStart + chunk.length;
          }
        }

        if (nextAbsolute > total) {
          return toFailure(errorCodes.rangeMismatch, messages.rangeMismatch, 502);
        }

        if (nextAbsolute < chunkStart + chunk.length) {
          const remainder = chunk.subarray(nextAbsolute - chunkStart);
          carry = concatUint8Arrays([remainder, carry]);
        }

        offset = nextAbsolute;
        await notifyBytesConfirmed(offset);
        continue;
      }

      const details = await readApiErrorDetails(res);
      return toFailure(errorCodes.uploadFailed, messages.uploadFailed, res.status, details);
    }

    return toFailure(errorCodes.incomplete, messages.incomplete, 500);
  } finally {
    reader.releaseLock();
  }
}

/**
 * Resolved resumable session ready for chunked upload.
 * @property sessionUrl - Active resumable session URL.
 * @property startOffset - Byte offset confirmed by the provider.
 */
export interface GoogleResumableUploadSession {
  sessionUrl: string;
  startOffset: number;
}

/**
 * Resolves a resumable session from persisted state or by creating a new one.
 * @param input - Probe/create callbacks and persisted session snapshot.
 * @returns Session to upload, completed resource id, or init failure.
 */
export async function resolveGoogleResumableUploadSession(input: {
  storedSessionUrl?: string | null;
  storedBytesConfirmed?: number | null;
  accessToken: string;
  totalBytes: number;
  contentType: string;
  signal?: AbortSignal;
  clearResumableState?: () => Promise<void>;
  createSession: () => Promise<string | PlatformUploadFailure>;
  persistNewSession?: (sessionUrl: string) => Promise<void>;
}): Promise<
  | { kind: 'upload'; session: GoogleResumableUploadSession }
  | { kind: 'complete'; resourceId: string }
  | { kind: 'error'; result: PlatformUploadFailure }
> {
  const storedSessionUrl = input.storedSessionUrl?.trim();
  if (storedSessionUrl && input.totalBytes > 0) {
    const probe = await probeGoogleResumableSession({
      sessionUrl: storedSessionUrl,
      accessToken: input.accessToken,
      totalBytes: input.totalBytes,
      contentType: input.contentType,
      signal: input.signal,
    });

    if (probe.status === 'resume') {
      return {
        kind: 'upload',
        session: { sessionUrl: storedSessionUrl, startOffset: probe.bytesConfirmed },
      };
    }
    if (probe.status === 'complete') {
      await input.clearResumableState?.();
      return { kind: 'complete', resourceId: probe.resourceId };
    }
    if (probe.status === 'unconfirmed') {
      return {
        kind: 'upload',
        session: {
          sessionUrl: storedSessionUrl,
          startOffset: resumeOffsetFromStored(input.storedBytesConfirmed, input.totalBytes),
        },
      };
    }
    await input.clearResumableState?.();
  }

  const created = await input.createSession();
  if (typeof created !== 'string') {
    return { kind: 'error', result: created };
  }

  await input.persistNewSession?.(created);

  return {
    kind: 'upload',
    session: { sessionUrl: created, startOffset: 0 },
  };
}

/**
 * Executes a single PUT resumable upload when total size is unknown.
 * @param input - Session URL, stream, and success builder.
 * @returns Platform upload result on success or failure.
 */
export async function uploadGoogleResumableSinglePut(input: {
  sessionUrl: string;
  accessToken: string;
  stream: ReadableStream<Uint8Array>;
  contentLength?: number;
  contentType: string;
  signal?: AbortSignal;
  uploadFailedCode: string;
  uploadFailedMessage: string;
  buildSuccessResult: (payload: Record<string, unknown>) => PlatformUploadResult;
}): Promise<PlatformUploadResult> {
  const uploadRequestInit: RequestInit & { duplex: 'half' } = {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': input.contentType,
      ...(input.contentLength !== undefined
        ? { 'Content-Length': String(input.contentLength) }
        : {}),
    },
    body: input.stream,
    duplex: 'half',
    ...(input.signal ? { signal: input.signal } : {}),
  };

  const uploadResponse = await fetch(input.sessionUrl, uploadRequestInit);

  if (!uploadResponse.ok) {
    const details = await readApiErrorDetails(uploadResponse);
    return toFailure(
      input.uploadFailedCode,
      input.uploadFailedMessage,
      uploadResponse.status,
      details
    );
  }

  const uploadPayload = (await uploadResponse.json().catch(() => ({}))) as Record<string, unknown>;
  return input.buildSuccessResult(uploadPayload);
}
