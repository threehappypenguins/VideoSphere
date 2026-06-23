import {
  buildFacebookAppSecretProof,
  FACEBOOK_GRAPH_API_BASE,
  facebookGraphApiFetchInit,
} from '@/lib/platforms/facebook-oauth';

interface FacebookGraphErrorBody {
  error?: { message?: string };
}

interface FacebookLiveVideoCreateResponse extends FacebookGraphErrorBody {
  id?: string;
  stream_url?: string;
  secure_stream_url?: string;
}

interface FacebookLiveVideoStatusResponse extends FacebookGraphErrorBody {
  status?: string;
}

/**
 * Input for creating a Facebook `LiveVideo` via `POST /{page-id}/live_videos`.
 * @property title - Live video title.
 * @property description - Optional live video description.
 */
export interface CreateFacebookLiveVideoInput {
  title: string;
  description?: string;
}

/**
 * Builds a Graph API URL with optional query parameters and `appsecret_proof` when configured.
 * @param path - Graph API path relative to {@link FACEBOOK_GRAPH_API_BASE} (e.g. `{pageId}/live_videos`).
 * @param accessToken - Page access token used to compute `appsecret_proof`.
 * @param params - Optional query parameters (excluding `appsecret_proof`).
 * @returns Fully-qualified Graph API URL.
 */
function buildFacebookGraphApiUrl(
  path: string,
  accessToken: string,
  params?: URLSearchParams
): string {
  const normalizedPath = path.replace(/^\/+/, '');
  const url = new URL(`${FACEBOOK_GRAPH_API_BASE}/${normalizedPath}`);
  if (params) {
    for (const [key, value] of params) {
      url.searchParams.set(key, value);
    }
  }
  const proof = buildFacebookAppSecretProof(accessToken);
  if (proof) {
    url.searchParams.set('appsecret_proof', proof);
  }
  return url.toString();
}

/**
 * Extracts a user-facing error message from a Facebook Graph API JSON body or HTTP response.
 * @param body - Parsed Graph API response body.
 * @param response - Optional fetch response for HTTP status fallback.
 * @returns Error message when present.
 */
function readFacebookGraphApiErrorDetails(
  body: FacebookGraphErrorBody,
  response?: Response
): string {
  const message = body.error?.message?.trim();
  if (message) {
    return message;
  }
  if (response && !response.ok) {
    return `Facebook Graph API returned HTTP ${response.status}.`;
  }
  return 'Facebook Graph API request failed.';
}

/**
 * POSTs form-urlencoded parameters to a Graph API path using Bearer auth.
 * @param path - Graph API path relative to the API base.
 * @param accessToken - Page access token.
 * @param params - Form body parameters (must not include `access_token`).
 * @returns Graph API fetch response and parsed JSON body.
 */
async function postFacebookGraphForm(
  path: string,
  accessToken: string,
  params: URLSearchParams
): Promise<{ response: Response; body: FacebookGraphErrorBody }> {
  const response = await fetch(
    buildFacebookGraphApiUrl(path, accessToken),
    facebookGraphApiFetchInit(accessToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
  );
  const body = (await response.json().catch(() => ({}))) as FacebookGraphErrorBody;
  return { response, body };
}

/**
 * Creates a Facebook `LiveVideo` on a Page for immediate RTMPS ingest (`status=LIVE_NOW`).
 * Callers must pass an already-resolved Page access token.
 * @param pageAccessToken - Page access token with live video permissions.
 * @param pageId - Facebook Page ID that owns the live video.
 * @param input - Live video title and optional description.
 * @returns New live video id and ingest URLs, or upstream error details.
 */
export async function createFacebookLiveVideo(
  pageAccessToken: string,
  pageId: string,
  input: CreateFacebookLiveVideoInput
): Promise<
  | { ok: true; id: string; streamUrl: string; secureStreamUrl: string }
  | { ok: false; details: string }
> {
  const normalizedPageId = pageId.trim();
  if (!normalizedPageId) {
    return { ok: false, details: 'Facebook Page ID is required.' };
  }

  const title = input.title.trim();
  if (!title) {
    return { ok: false, details: 'Live video title is required.' };
  }

  const params = new URLSearchParams({
    status: 'LIVE_NOW',
    title,
    description: input.description?.trim() ?? '',
    persistent_stream_key_status: 'ENABLE',
  });

  const { response, body } = await postFacebookGraphForm(
    `${normalizedPageId}/live_videos`,
    pageAccessToken,
    params
  );

  const createBody = body as FacebookLiveVideoCreateResponse;
  if (!response.ok || createBody.error) {
    return { ok: false, details: readFacebookGraphApiErrorDetails(createBody, response) };
  }

  const id = createBody.id?.trim() ?? '';
  const streamUrl = createBody.stream_url?.trim() ?? '';
  const secureStreamUrl = createBody.secure_stream_url?.trim() ?? '';
  if (!id || !streamUrl || !secureStreamUrl) {
    return {
      ok: false,
      details: 'Facebook live_videos create did not return id and stream URLs.',
    };
  }

  console.log(
    `[facebook-livestream-api] Created Facebook LiveVideo id=${id} (page ${normalizedPageId}).`
  );

  return { ok: true, id, streamUrl, secureStreamUrl };
}

/**
 * Reads the raw `status` field on a Facebook `LiveVideo` object.
 * @param pageAccessToken - Page access token with read access to the live video.
 * @param liveVideoId - Facebook `LiveVideo` object id.
 * @returns Raw status value (`UNPUBLISHED`, `LIVE_NOW`, `VOD`, etc.), or upstream error details.
 */
export async function getFacebookLiveVideoStatus(
  pageAccessToken: string,
  liveVideoId: string
): Promise<{ ok: true; status: string } | { ok: false; details: string }> {
  const normalizedId = liveVideoId.trim();
  if (!normalizedId) {
    return { ok: false, details: 'Facebook LiveVideo id is required.' };
  }

  const params = new URLSearchParams({ fields: 'status' });
  const response = await fetch(
    buildFacebookGraphApiUrl(normalizedId, pageAccessToken, params),
    facebookGraphApiFetchInit(pageAccessToken)
  );
  const body = (await response.json().catch(() => ({}))) as FacebookLiveVideoStatusResponse;

  if (!response.ok || body.error) {
    const details = readFacebookGraphApiErrorDetails(body, response);
    console.warn(`[facebook-livestream-api] GET LiveVideo ${normalizedId} failed: ${details}`);
    return { ok: false, details };
  }

  const status = body.status?.trim() ?? '';
  if (!status) {
    return {
      ok: false,
      details: `Facebook LiveVideo ${normalizedId} did not return a status.`,
    };
  }

  return { ok: true, status };
}

/**
 * Ends an active Facebook `LiveVideo` via `POST /{live-video-id}` with `end_live_video=true`.
 * @param pageAccessToken - Page access token with permission to end the live video.
 * @param liveVideoId - Facebook `LiveVideo` object id.
 * @returns Success, or upstream error details.
 */
export async function endFacebookLiveVideo(
  pageAccessToken: string,
  liveVideoId: string
): Promise<{ ok: true } | { ok: false; details: string }> {
  const normalizedId = liveVideoId.trim();
  if (!normalizedId) {
    return { ok: false, details: 'Facebook LiveVideo id is required.' };
  }

  const params = new URLSearchParams({
    // TODO(verify): confirm `end_live_video=true` in Graph API Explorer against a real LIVE_NOW object before relying on it; if it errors, stop the encoder and let Facebook auto-transition the object to VOD.
    end_live_video: 'true',
  });

  const { response, body } = await postFacebookGraphForm(normalizedId, pageAccessToken, params);

  if (!response.ok || body.error) {
    return { ok: false, details: readFacebookGraphApiErrorDetails(body, response) };
  }

  return { ok: true };
}

/**
 * Deletes a Facebook `LiveVideo` via `DELETE /{live-video-id}`.
 * @param pageAccessToken - Page access token with permission to delete the live video.
 * @param liveVideoId - Facebook `LiveVideo` object id.
 * @returns Success, or upstream error details.
 */
async function deleteFacebookLiveVideoObject(
  pageAccessToken: string,
  liveVideoId: string
): Promise<{ ok: true } | { ok: false; details: string }> {
  const normalizedId = liveVideoId.trim();
  if (!normalizedId) {
    return { ok: false, details: 'Facebook LiveVideo id is required.' };
  }

  const response = await fetch(
    buildFacebookGraphApiUrl(normalizedId, pageAccessToken),
    facebookGraphApiFetchInit(pageAccessToken, { method: 'DELETE' })
  );
  const body = (await response.json().catch(() => ({}))) as FacebookGraphErrorBody;

  if (!response.ok || body.error) {
    return { ok: false, details: readFacebookGraphApiErrorDetails(body, response) };
  }

  return { ok: true };
}

/**
 * Removes a Facebook `LiveVideo` when a local livestream row is deleted.
 * Attempts direct deletion first; if Meta rejects that, ends the broadcast and retries.
 * @param pageAccessToken - Page access token with live video permissions.
 * @param liveVideoId - Facebook `LiveVideo` object id.
 * @returns Success, or upstream error details from the final attempt.
 */
export async function deleteFacebookLiveVideo(
  pageAccessToken: string,
  liveVideoId: string
): Promise<{ ok: true } | { ok: false; details: string }> {
  const normalizedId = liveVideoId.trim();
  if (!normalizedId) {
    return { ok: false, details: 'Facebook LiveVideo id is required.' };
  }

  const directDelete = await deleteFacebookLiveVideoObject(pageAccessToken, normalizedId);
  if (directDelete.ok === true) {
    console.log(`[facebook-livestream-api] Deleted Facebook LiveVideo id=${normalizedId}.`);
    return directDelete;
  }

  const endResult = await endFacebookLiveVideo(pageAccessToken, normalizedId);
  if (endResult.ok === false) {
    return directDelete;
  }

  const deleteAfterEnd = await deleteFacebookLiveVideoObject(pageAccessToken, normalizedId);
  if (deleteAfterEnd.ok === true) {
    console.log(
      `[facebook-livestream-api] Ended and deleted Facebook LiveVideo id=${normalizedId}.`
    );
    return deleteAfterEnd;
  }

  return deleteAfterEnd;
}
