import type { PlatformUploadVisibility, VimeoDraftFields } from '@/types';
import { messageFromThrown } from '@/lib/utils/error-message';
import type {
  PlatformUploadMetadata,
  PlatformUploadResult,
  PlatformUploadTokens,
} from '@/lib/platforms/types';

interface UploadToVimeoInput {
  videoStream: ReadableStream<Uint8Array>;
  contentLength: number;
  contentType?: string;
  metadata: PlatformUploadMetadata;
  tokens: PlatformUploadTokens;
  /** When set (e.g. distribute deadline), aborts R2-backed fetches and polling so timeouts stop real work. */
  signal?: AbortSignal;
}

interface VimeoCreateResponse {
  uri?: string;
  upload?: {
    upload_link?: string;
  };
}

const VIMEO_CREATE_VIDEO_URL = 'https://api.vimeo.com/me/videos';

function visibilityToVimeoPrivacy(
  visibility: PlatformUploadVisibility
): 'anybody' | 'unlisted' | 'nobody' {
  if (visibility === 'private') return 'nobody';
  if (visibility === 'unlisted') return 'unlisted';
  return 'anybody';
}

function toError(
  code: string,
  message: string,
  statusCode?: number,
  details?: string
): PlatformUploadResult {
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

function isLikelyNetworkFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('fetch failed') || msg.includes('network');
}

function extractVimeoVideoId(uri?: string): string | null {
  if (!uri) return null;
  const parts = uri.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

/** API path `videos/{id}` — handles `uri` as `/videos/…` or absolute `https://api.vimeo.com/videos/…`. */
function vimeoVideoApiBasePath(uri: string): string {
  const s = uri.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) {
    try {
      return new URL(s).pathname.replace(/^\/+/, '');
    } catch {
      /* fall through */
    }
  }
  return s.replace(/^\/+/, '');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Like `delay` but rejects promptly when `signal` aborts (used under upload deadlines). */
function delayOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return delay(ms);
  if (signal.aborted) {
    return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };
    const id = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      cleanup();
      reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const vimeoJsonHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
  Accept: 'application/vnd.vimeo.*+json;version=3.4',
});

const vimeoReadHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  Accept: 'application/vnd.vimeo.*+json;version=3.4',
});

/** Category PUT is handled as a bulk-style action; Vimeo requires `application/json`, not vendor MIME. */
const vimeoCategorySuggestHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
  Accept: 'application/vnd.vimeo.*+json;version=3.4',
});

/**
 * `PUT /videos/{id}/categories` expects a batch JSON body (Vimeo Common Formats):
 * `[{ "category": "animation" }, …]` with `Content-Type: application/json`.
 * A single object like `{ "category": ["animation"] }` yields opaque HTTP 500s.
 *
 * @see https://developer.vimeo.com/api/common-formats#working-with-batch-requests
 */
function parseVimeoCategorySlugs(categoryUriOrSlug: string): string[] | null {
  const s = categoryUriOrSlug.trim();
  if (!s) return null;

  const sub = s.match(/\/categories\/([^/]+)\/subcategories\/([^/?#]+)/i);
  if (sub) return [sub[1], sub[2]];

  const top = s.match(/\/categories\/([^/?#]+)/i);
  if (top) return [top[1]];

  try {
    const path = new URL(s).pathname;
    const subU = path.match(/\/categories\/([^/]+)\/subcategories\/([^/?#]+)/i);
    if (subU) return [subU[1], subU[2]];
    const topU = path.match(/\/categories\/([^/?#]+)/i);
    if (topU) return [topU[1]];
  } catch {
    /* not an absolute URL */
  }

  if (!s.includes('/') && !s.toLowerCase().startsWith('http')) {
    return [s];
  }

  return null;
}

/** Batch body for category suggest; exported for unit tests. */
export function buildVimeoCategorySuggestBatchBody(
  categoryUriOrSlug: string
): { category: string }[] | null {
  const slugs = parseVimeoCategorySlugs(categoryUriOrSlug);
  if (!slugs?.length) return null;
  return slugs.map((name) => ({ category: name }));
}

class VimeoIngestWaitFailedError extends Error {
  readonly statusCode?: number;
  readonly details?: string;

  constructor(message: string, opts?: { statusCode?: number; details?: string }) {
    super(message);
    this.name = 'VimeoIngestWaitFailedError';
    this.statusCode = opts?.statusCode;
    this.details = opts?.details;
  }
}

function retryDelayMsAfterRateLimit(res: Response, attemptIndex: number, status: number): number {
  const raw = res.headers.get('Retry-After');
  if (raw) {
    const sec = parseInt(raw, 10);
    if (Number.isFinite(sec) && sec >= 0) {
      return Math.min(Math.max(sec * 1000, 15_000), 180_000);
    }
  }
  if (status === 429) {
    return Math.min(65_000 + attemptIndex * 15_000, 180_000);
  }
  if (status === 503) {
    return Math.min(5000 * 2 ** attemptIndex, 60_000);
  }
  return 10_000;
}

function vimeoStatusProbeRetryDelayMs(res: Response, consecutiveNonOk: number): number {
  const idx = Math.max(0, consecutiveNonOk - 1);
  if (res.status === 429 || res.status === 503) {
    return retryDelayMsAfterRateLimit(res, idx, res.status);
  }
  if (res.status >= 500) {
    return Math.min(5000 * 2 ** Math.min(idx, 6), 45_000);
  }
  return Math.min(3000 * 2 ** Math.min(idx, 5), 30_000);
}

function vimeoStatusProbeNetworkRetryDelayMs(consecutiveNetworkFailures: number): number {
  const idx = Math.max(0, consecutiveNetworkFailures - 1);
  return Math.min(2000 * 2 ** Math.min(idx, 5), 30_000);
}

/**
 * After TUS PATCH, wait until the file is ingested **and** transcoding has finished.
 * Vimeo's docs treat `upload.status` and `transcode.status` separately; tagging right
 * after upload completes (but before transcode) can return HTTP 2xx without tags
 * sticking on the video.
 *
 * Non-2xx status probes are retried with backoff until `deadlineMs`. Vimeo
 * `upload.status` / `transcode.status` of `error` fails immediately.
 */
export async function waitUntilVimeoUploadAndTranscodeComplete(
  videoBasePath: string,
  accessToken: string,
  opts?: { deadlineMs?: number; pollIntervalMs?: number; signal?: AbortSignal }
): Promise<void> {
  const deadlineMs = opts?.deadlineMs ?? 300_000;
  const pollIntervalMs = opts?.pollIntervalMs ?? 2000;
  const signal = opts?.signal;
  const deadline = Date.now() + deadlineMs;
  let probeNonOkStreak = 0;
  let networkFailStreak = 0;

  while (Date.now() < deadline) {
    let res: Response;
    try {
      res = await fetch(
        `https://api.vimeo.com/${videoBasePath}?fields=upload.status,transcode.status`,
        {
          headers: vimeoReadHeaders(accessToken),
          ...(signal ? { signal } : {}),
        }
      );
    } catch {
      networkFailStreak++;
      probeNonOkStreak = 0;
      const waitMs = vimeoStatusProbeNetworkRetryDelayMs(networkFailStreak);
      if (Date.now() + waitMs >= deadline) {
        throw new VimeoIngestWaitFailedError(
          'Timed out waiting for Vimeo upload/transcode status (network errors while polling).'
        );
      }
      await delayOrAbort(waitMs, signal);
      continue;
    }

    networkFailStreak = 0;

    if (!res.ok) {
      probeNonOkStreak++;
      const waitMs = vimeoStatusProbeRetryDelayMs(res, probeNonOkStreak);
      const details = await res.text().catch(() => undefined);
      if (Date.now() + waitMs >= deadline) {
        throw new VimeoIngestWaitFailedError(
          `Vimeo status probe failed (HTTP ${res.status}) before ingest wait deadline.`,
          { statusCode: res.status, details }
        );
      }
      await delayOrAbort(waitMs, signal);
      continue;
    }

    probeNonOkStreak = 0;

    const body = (await res.json().catch(() => ({}))) as {
      upload?: { status?: string } | null;
      transcode?: { status?: string } | null;
    };
    const uploadSt = body.upload?.status;
    if (uploadSt === 'error') {
      throw new VimeoIngestWaitFailedError('Vimeo reported upload.status error.', {
        details: JSON.stringify(body.upload ?? null),
      });
    }

    const transcodeSt = body.transcode?.status;
    if (transcodeSt === 'error') {
      throw new VimeoIngestWaitFailedError('Vimeo reported transcode.status error.', {
        details: JSON.stringify(body.transcode ?? null),
      });
    }

    const uploadDone = uploadSt === 'complete';
    const transcodeDone = transcodeSt === 'complete';
    if (uploadDone && transcodeDone) return;

    if (Date.now() + pollIntervalMs >= deadline) {
      break;
    }
    await delayOrAbort(pollIntervalMs, signal);
  }

  throw new VimeoIngestWaitFailedError(
    'Timed out waiting for Vimeo upload and transcode to complete.'
  );
}

function normalizeVimeoTagKey(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * Vimeo may return tags as a bare array (`[{ "tag": "x" }]`, changelog example),
 * or as `{ data: [...] }` with `name` and/or `tag` on each item.
 */
function parseVimeoTagsListPayload(json: unknown): string[] {
  const out: string[] = [];
  const pushFromItem = (item: unknown) => {
    if (typeof item === 'string') {
      const t = item.trim();
      if (t.length > 0) out.push(t);
      return;
    }
    if (!item || typeof item !== 'object') return;
    const o = item as Record<string, unknown>;
    const raw = o.tag ?? o.name;
    if (typeof raw === 'string') {
      const t = raw.trim();
      if (t.length > 0) out.push(t);
    }
  };

  if (Array.isArray(json)) {
    for (const item of json) pushFromItem(item);
    return out;
  }
  if (json && typeof json === 'object' && Array.isArray((json as { data?: unknown }).data)) {
    for (const item of (json as { data: unknown[] }).data) pushFromItem(item);
  }
  return out;
}

function wantedTagsArePresentOnVideo(wanted: string[], onVideo: string[]): boolean {
  const have = new Set(onVideo.map(normalizeVimeoTagKey));
  return wanted.every((w) => have.has(normalizeVimeoTagKey(w)));
}

/** Vimeo can return 2xx before tags are readable; poll GET /tags briefly. */
async function verifyVimeoTagsApplied(
  videoBasePath: string,
  accessToken: string,
  wanted: string[],
  signal?: AbortSignal
): Promise<boolean> {
  const attempts = 8;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await delayOrAbort(750, signal);
    // Avoid `?per_page=` here — some API builds respond 405 on GET …/tags with unknown query params.
    const res = await fetch(`https://api.vimeo.com/${videoBasePath}/tags`, {
      headers: vimeoReadHeaders(accessToken),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) continue;
    const json: unknown = await res.json().catch(() => null);
    const onVideo = parseVimeoTagsListPayload(json);
    if (wantedTagsArePresentOnVideo(wanted, onVideo)) return true;
  }
  return false;
}

/**
 * Vimeo tags: documented batch POST `{ tags: string[] }` on `/videos/{id}/tags`.
 * Their **categories** API uses **PUT** with a **top-level JSON array** body; some
 * stacks report tags work the same way. Single-tag add is documented as POST on
 * `/videos/{id}/tags/{word}` — we also try PUT there if POST returns 405.
 *
 * Success requires GET `/videos/{id}/tags` to list the tags (writes can 2xx early).
 */
async function setVimeoVideoTagsAllStrategies(
  videoBasePath: string,
  accessToken: string,
  tags: string[],
  signal?: AbortSignal
): Promise<
  { ok: true } | { ok: false; status: number; body: string | undefined; retryAfterMs: number }
> {
  const url = `https://api.vimeo.com/${videoBasePath}/tags`;
  const tagObjectsJson = JSON.stringify(tags.map((name) => ({ name })));

  const tryWrite = async (
    method: string,
    targetUrl: string,
    body: string | undefined,
    useJsonHeaders: boolean
  ): Promise<Response> => {
    const h = useJsonHeaders ? vimeoJsonHeaders(accessToken) : vimeoReadHeaders(accessToken);
    return fetch(targetUrl, {
      method,
      headers: h,
      ...(body !== undefined ? { body } : {}),
      ...(signal ? { signal } : {}),
    });
  };

  const asRateLimitError = async (
    res: Response,
    attemptIndex: number
  ): Promise<{ ok: false; status: number; body: string | undefined; retryAfterMs: number }> => {
    const body = await res.text().catch(() => undefined);
    return {
      ok: false,
      status: res.status,
      body,
      retryAfterMs: retryDelayMsAfterRateLimit(res, attemptIndex, res.status),
    };
  };

  // 1) PUT top-level array (same style as Vimeo’s batch categories examples)
  let res = await tryWrite('PUT', url, tagObjectsJson, true);
  if (res.status === 429 || res.status === 503) {
    return asRateLimitError(res, 0);
  }
  if (res.ok && (await verifyVimeoTagsApplied(videoBasePath, accessToken, tags, signal))) {
    return { ok: true };
  }

  // 2) PUT `{ "data": [ { "name" } ] }` (SDK-style)
  if (res.status !== 405) {
    res = await tryWrite(
      'PUT',
      url,
      JSON.stringify({ data: tags.map((name) => ({ name })) }),
      true
    );
    if (res.status === 429 || res.status === 503) {
      return asRateLimitError(res, 0);
    }
    if (res.ok && (await verifyVimeoTagsApplied(videoBasePath, accessToken, tags, signal))) {
      return { ok: true };
    }
  }

  // 3) Documented batch POST
  res = await tryWrite('POST', url, JSON.stringify({ tags }), true);
  if (res.status === 429 || res.status === 503) {
    return asRateLimitError(res, 0);
  }
  if (res.ok && (await verifyVimeoTagsApplied(videoBasePath, accessToken, tags, signal))) {
    return { ok: true };
  }

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]!;
    const segment = encodeURIComponent(tag);
    const singleUrl = `${url}/${segment}`;

    let r = await tryWrite('POST', singleUrl, '{}', true);
    if (r.status === 429 || r.status === 503) {
      return asRateLimitError(r, i);
    }
    if (r.status === 405) {
      r = await tryWrite('PUT', singleUrl, '{}', true);
    }
    if (r.status === 429 || r.status === 503) {
      return asRateLimitError(r, i);
    }
    if (!r.ok) {
      const body = await r.text().catch(() => undefined);
      return {
        ok: false,
        status: r.status,
        body,
        retryAfterMs: retryDelayMsAfterRateLimit(r, i, r.status),
      };
    }
  }

  if (await verifyVimeoTagsApplied(videoBasePath, accessToken, tags, signal)) {
    return { ok: true };
  }

  const probe = await fetch(url, {
    headers: vimeoReadHeaders(accessToken),
    ...(signal ? { signal } : {}),
  });
  const listed = probe.ok ? await probe.text().catch(() => '') : '';
  return {
    ok: false,
    status: 502,
    body:
      'Vimeo tag endpoints did not leave the requested tags on the video (verified via GET). ' +
      `GET …/tags status=${probe.status} body (truncated): ${listed.slice(0, 800)}`,
    retryAfterMs: 10_000,
  };
}

const VIMEO_TAG_MAX_ATTEMPTS = 5;

async function setVimeoVideoTagsWithRetry(
  videoBasePath: string,
  accessToken: string,
  tags: string[],
  signal?: AbortSignal
): Promise<{ ok: true } | { ok: false; status: number; body: string | undefined }> {
  let lastStatus = 0;
  let lastBody: string | undefined;

  for (let attempt = 0; attempt < VIMEO_TAG_MAX_ATTEMPTS; attempt++) {
    const r = await setVimeoVideoTagsAllStrategies(videoBasePath, accessToken, tags, signal);
    if (r.ok === false) {
      lastStatus = r.status;
      lastBody = r.body;
      const retryable = r.status === 429 || r.status === 503;

      if (!retryable) {
        return { ok: false, status: lastStatus, body: lastBody };
      }

      if (attempt < VIMEO_TAG_MAX_ATTEMPTS - 1) {
        await delayOrAbort(r.retryAfterMs, signal);
      }
      continue;
    }
    return { ok: true };
  }

  return { ok: false, status: lastStatus, body: lastBody };
}

export async function uploadToVimeo(input: UploadToVimeoInput): Promise<PlatformUploadResult> {
  if (!input.tokens.accessToken) {
    return toError('VIMEO_TOKEN_MISSING', 'Vimeo access token is missing.');
  }

  const { signal } = input;

  let createdVideoId: string | null = null;
  let tusUploadAccepted = false;
  // Downstream metadata steps we must not mask failures for.
  // These are used to decide whether a likely-network error is safe to treat as success
  // (only when all required steps have already completed).
  let ingestWaitDone = true;
  let tagsDone = true;
  let categoryDone = true;

  try {
    if (!input.contentLength || input.contentLength <= 0) {
      return toError(
        'VIMEO_CONTENT_LENGTH_REQUIRED',
        'Vimeo uploads require a valid contentLength.'
      );
    }

    const videoSource = {
      stream: input.videoStream,
      contentLength: input.contentLength,
      contentType: input.contentType ?? 'application/octet-stream',
    };

    const safeTitle = input.metadata.title.trim() || 'Untitled video';
    const safeDescription = input.metadata.description.trim();
    const safeTags = input.metadata.tags.map((t) => t.trim()).filter((t) => t.length > 0);

    const vm: VimeoDraftFields | undefined = input.metadata.vimeo;
    const privacy: Record<string, unknown> = {
      view: visibilityToVimeoPrivacy(input.metadata.visibility),
    };
    const vp = vm?.privacy;
    if (vp?.view !== undefined) privacy.view = vp.view;
    if (vp?.comments !== undefined) privacy.comments = vp.comments;
    if (vp?.embed !== undefined) privacy.embed = vp.embed;
    // Omit `privacy.download` on create: Vimeo often rejects it with 2204 (Basic and others).
    // Draft `platforms.vimeo.privacy.download` is ignored here; use Vimeo account/UI if needed.
    if (vp?.add !== undefined) privacy.add = vp.add;

    const createBody: Record<string, unknown> = {
      upload: {
        approach: 'tus',
        size: videoSource.contentLength,
      },
      name: safeTitle,
      description: safeDescription,
      privacy,
    };
    if (vm?.license !== undefined) createBody.license = vm.license;
    if (vm?.locale !== undefined) createBody.locale = vm.locale;
    if (vm?.contentRating !== undefined && vm.contentRating.length > 0) {
      createBody.content_rating = vm.contentRating;
    }
    if (vm?.password !== undefined && vm.password !== '') {
      createBody.password = vm.password;
    }
    if (vm?.reviewPage?.active !== undefined) {
      createBody.review_page = { active: vm.reviewPage.active };
    }
    if (vm?.embed !== undefined && Object.keys(vm.embed).length > 0) {
      createBody.embed = vm.embed;
    }

    const createResponse = await fetch(VIMEO_CREATE_VIDEO_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.tokens.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.vimeo.*+json;version=3.4',
      },
      body: JSON.stringify(createBody),
      ...(signal ? { signal } : {}),
    });

    if (!createResponse.ok) {
      return toError(
        'VIMEO_CREATE_VIDEO_FAILED',
        'Failed to create Vimeo video entry.',
        createResponse.status,
        await createResponse.text().catch(() => undefined)
      );
    }

    const createPayload = (await createResponse.json().catch(() => ({}))) as VimeoCreateResponse;
    const uploadLink = createPayload.upload?.upload_link;
    const videoUri = createPayload.uri;
    const videoBasePath = typeof videoUri === 'string' ? vimeoVideoApiBasePath(videoUri) : '';
    const videoId = extractVimeoVideoId(videoUri);
    createdVideoId = videoId;

    if (!uploadLink || !videoId || !videoBasePath) {
      return toError(
        'VIMEO_UPLOAD_LINK_MISSING',
        'Vimeo upload link or video ID was not returned.'
      );
    }

    const tusUploadInit: RequestInit & { duplex: 'half' } = {
      method: 'PATCH',
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': '0',
        'Content-Type': 'application/offset+octet-stream',
        'Content-Length': String(videoSource.contentLength),
      },
      body: videoSource.stream,
      duplex: 'half',
      ...(signal ? { signal } : {}),
    };

    const tusUploadResponse = await fetch(uploadLink, tusUploadInit);
    if (!tusUploadResponse.ok) {
      return toError(
        'VIMEO_TUS_UPLOAD_FAILED',
        'Vimeo tus upload failed.',
        tusUploadResponse.status,
        await tusUploadResponse.text().catch(() => undefined)
      );
    }
    tusUploadAccepted = true;

    await fetch(uploadLink, {
      method: 'HEAD',
      headers: {
        'Tus-Resumable': '1.0.0',
        Accept: 'application/vnd.vimeo.*+json;version=3.4',
      },
      ...(signal ? { signal } : {}),
    }).catch(() => undefined);

    const categoryUriRaw = vm?.categoryUri?.trim() || input.metadata.vimeoCategoryUri?.trim();
    const needsIngestWait = safeTags.length > 0 || Boolean(categoryUriRaw);
    ingestWaitDone = !needsIngestWait;
    tagsDone = safeTags.length === 0;
    categoryDone = !Boolean(categoryUriRaw);

    if (needsIngestWait) {
      await waitUntilVimeoUploadAndTranscodeComplete(videoBasePath, input.tokens.accessToken, {
        signal,
      });
      ingestWaitDone = true;
    }

    if (safeTags.length > 0) {
      const tagResult = await setVimeoVideoTagsWithRetry(
        videoBasePath,
        input.tokens.accessToken,
        safeTags,
        signal
      );
      if (tagResult.ok === false) {
        return toError(
          'VIMEO_TAGS_UPDATE_FAILED',
          'Vimeo upload succeeded but applying tags failed. If Vimeo returned rate limiting (HTTP 429), wait a few minutes and try distributing again; the video may already exist on Vimeo.',
          tagResult.status,
          tagResult.body
        );
      }
      tagsDone = true;
    }

    if (categoryUriRaw) {
      const batchBody = buildVimeoCategorySuggestBatchBody(categoryUriRaw);
      if (!batchBody) {
        return toError(
          'VIMEO_CATEGORY_INVALID',
          'Invalid platforms.vimeo.categoryUri: use a slug (e.g. "animation"), a path like "/categories/animation", or a full vimeo.com category URL.'
        );
      }
      const catRes = await fetch(`https://api.vimeo.com/${videoBasePath}/categories`, {
        method: 'PUT',
        headers: vimeoCategorySuggestHeaders(input.tokens.accessToken),
        body: JSON.stringify(batchBody),
        ...(signal ? { signal } : {}),
      });
      if (!catRes.ok) {
        const tagsNote =
          safeTags.length > 0 ? ' Tags were already applied to the video on Vimeo.' : '';
        return toError(
          'VIMEO_CATEGORY_FAILED',
          `Vimeo upload succeeded but setting the category failed.${tagsNote}`,
          catRes.status,
          await catRes.text().catch(() => undefined)
        );
      }
      categoryDone = true;
    }

    return {
      ok: true,
      platformVideoId: videoId,
      platformUrl: `https://vimeo.com/${videoId}`,
    };
  } catch (error) {
    if (error instanceof VimeoIngestWaitFailedError) {
      return toError('VIMEO_INGEST_WAIT_FAILED', error.message, error.statusCode, error.details);
    }

    if (
      tusUploadAccepted &&
      createdVideoId &&
      isLikelyNetworkFetchError(error) &&
      ingestWaitDone &&
      tagsDone &&
      categoryDone
    ) {
      // Vimeo can succeed the TUS upload even if a later metadata/status fetch fails transiently.
      // Only treat that as a success if all required metadata steps already completed.
      return {
        ok: true,
        platformVideoId: createdVideoId,
        platformUrl: `https://vimeo.com/${createdVideoId}`,
      };
    }
    return toError(
      'VIMEO_UPLOAD_ERROR',
      'Unexpected Vimeo upload error.',
      500,
      messageFromThrown(error)
    );
  }
}
