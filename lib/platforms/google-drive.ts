import { messageFromThrown } from '@/lib/utils/error-message';
import type { ConnectedAccount } from '@/types';
import type {
  PlatformUploadError,
  PlatformUploadResult,
  PlatformUploadTokens,
} from '@/lib/platforms/types';
import {
  type GoogleResumablePersistedState,
  type GoogleResumableStateUpdate,
  isRetryableGoogleResumableUploadFailure,
  probeGoogleResumableSession,
  resolveGoogleResumableUploadSession,
  uploadGoogleResumableInChunks,
  uploadGoogleResumableSinglePut,
} from '@/lib/platforms/google-resumable-upload';

type PlatformUploadFailure = Extract<PlatformUploadResult, { ok: false }>;

/** Resumable session fields loaded from a platform_upload row for cross-attempt resume. */
export type GoogleDriveResumablePersistedState = GoogleResumablePersistedState;

/** Resumable session snapshot persisted after upload progress. */
export type GoogleDriveResumableStateUpdate = GoogleResumableStateUpdate;

interface UploadToGoogleDriveInput {
  connectedAccount: ConnectedAccount;
  videoStream: ReadableStream<Uint8Array>;
  contentLength?: number;
  contentType?: string;
  fileName: string;
  /** When set, upload inside this year subfolder under the configured backup root (or My Drive root when unset). */
  yearFolderName?: string;
  tokens: PlatformUploadTokens;
  signal?: AbortSignal;
  /** Stored resumable session from a prior attempt, when present on the platform_upload row. */
  resumableState?: GoogleDriveResumablePersistedState;
  /** Persists resumable progress to the platform_upload row during chunked upload. */
  persistResumableState?: (state: GoogleDriveResumableStateUpdate) => Promise<void>;
  /** Clears resumable fields after terminal success or non-retryable failure. */
  clearResumableState?: () => Promise<void>;
}

interface GoogleDriveRefreshTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
}

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_RESUMABLE_CREATE_URL =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink,webContentLink';
const DRIVE_FILES_LIST_URL =
  'https://www.googleapis.com/drive/v3/files?fields=files(id,name,mimeType,trashed)';
const DRIVE_FILES_CREATE_URL = 'https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType';
const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

const GOOGLE_DRIVE_RESUMABLE_ERROR_CODES = {
  aborted: 'GOOGLE_DRIVE_UPLOAD_ABORTED',
  streamReadFailed: 'GOOGLE_DRIVE_UPLOAD_STREAM_READ_FAILED',
  emptyChunk: 'GOOGLE_DRIVE_UPLOAD_EMPTY_CHUNK',
  noResponse: 'GOOGLE_DRIVE_UPLOAD_NO_RESPONSE',
  uploadFailed: 'GOOGLE_DRIVE_UPLOAD_FAILED',
  rangeInvalid: 'GOOGLE_DRIVE_UPLOAD_RANGE_INVALID',
  rangeMismatch: 'GOOGLE_DRIVE_UPLOAD_RANGE_MISMATCH',
  incomplete: 'GOOGLE_DRIVE_UPLOAD_INCOMPLETE',
} as const;

const GOOGLE_DRIVE_RESUMABLE_MESSAGES = {
  aborted: 'Google Drive upload was aborted.',
  streamReadFailed: 'Failed to read video stream for Google Drive upload.',
  emptyChunk: 'Google Drive resumable upload received an empty chunk.',
  noResponse: 'Google Drive resumable upload received no response.',
  uploadFailed: 'Google Drive video upload failed.',
  rangeInvalid: 'Google Drive resumable upload returned an invalid byte range.',
  rangeMismatch: 'Google Drive resumable upload byte range exceeded file size.',
  incomplete: 'Google Drive resumable upload ended before the full file was sent.',
} as const;

const GOOGLE_DRIVE_RETRYABLE_UPLOAD_CODES = [
  'GOOGLE_DRIVE_UPLOAD_ABORTED',
  'GOOGLE_DRIVE_UPLOAD_STREAM_READ_FAILED',
] as const;

/**
 * Outcome of probing a stored Google Drive resumable session (status query PUT with bytes-star-slash-total).
 * @property status - resume when bytes remain; complete when the session already finished; invalid when the session must be discarded.
 * @property bytesConfirmed - Next byte offset to send when status is resume.
 * @property fileId - Drive file id when status is complete.
 */
export type GoogleDriveResumableProbeResult =
  | { status: 'resume'; bytesConfirmed: number }
  | { status: 'complete'; fileId: string }
  | { status: 'invalid' };

/**
 * Probes a stored resumable upload session to learn the provider-confirmed byte offset.
 * @param input - Session URL, auth, and declared total file size.
 * @returns Whether to resume, treat the upload as already complete, or discard the session.
 */
export async function probeGoogleDriveResumableSession(input: {
  sessionUrl: string;
  accessToken: string;
  totalBytes: number;
  contentType: string;
  signal?: AbortSignal;
}): Promise<GoogleDriveResumableProbeResult> {
  const probe = await probeGoogleResumableSession(input);
  if (probe.status === 'complete') {
    return { status: 'complete', fileId: probe.resourceId };
  }
  return probe;
}

function buildDriveUploadSuccessResult(payload: Record<string, unknown>): PlatformUploadResult {
  const id = typeof payload.id === 'string' ? payload.id : undefined;
  if (!id) {
    return toError(
      'GOOGLE_DRIVE_FILE_ID_MISSING',
      'Google Drive upload succeeded but no file id was returned.'
    );
  }

  const webViewLink = typeof payload.webViewLink === 'string' ? payload.webViewLink : undefined;
  const webContentLink =
    typeof payload.webContentLink === 'string' ? payload.webContentLink : undefined;

  return {
    ok: true,
    platformVideoId: id,
    platformUrl: webViewLink || webContentLink || `https://drive.google.com/file/d/${id}/view`,
  };
}

function isRetryableGoogleDriveUploadFailure(result: PlatformUploadFailure): boolean {
  return isRetryableGoogleResumableUploadFailure(result, GOOGLE_DRIVE_RETRYABLE_UPLOAD_CODES);
}

class GoogleDriveApiError extends Error {
  statusCode: number;
  details?: string;

  constructor(message: string, statusCode: number, details?: string) {
    super(message);
    this.name = 'GoogleDriveApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
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
    // Non-JSON response body; fall back to text.
  }

  return raw.slice(0, 1000);
}

interface ParsedGoogleDrivePlatformUserId {
  permissionId: string;
  rootFolderId?: string;
}

interface DriveFileLookupResponse {
  id?: string;
  name?: string;
  mimeType?: string;
  trashed?: boolean;
}

interface DriveListResponse {
  files?: DriveFileLookupResponse[];
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Executes parse google drive platform user id.
 * @param value - Input value for value.
 * @returns The computed result.
 */
export function parseGoogleDrivePlatformUserId(value: string): ParsedGoogleDrivePlatformUserId {
  const trimmed = value.trim();
  if (!trimmed) {
    return { permissionId: 'google-drive-user' };
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        permissionId?: string;
        rootFolderId?: string;
      };
      const permissionId = parsed.permissionId?.trim();
      const rootFolderId = parsed.rootFolderId?.trim();
      if (permissionId) {
        return {
          permissionId,
          ...(rootFolderId ? { rootFolderId } : {}),
        };
      }
    } catch {
      // Fall through to legacy/plain string handling.
    }
  }

  return { permissionId: trimmed };
}

/**
 * Executes serialize google drive platform user id.
 * @param permissionId - Input value for permission id.
 * @param rootFolderId - Input value for root folder id.
 * @returns The computed result.
 */
export function serializeGoogleDrivePlatformUserId(
  permissionId: string,
  rootFolderId?: string
): string {
  const safePermissionId = permissionId.trim() || 'google-drive-user';
  const safeRootFolderId = rootFolderId?.trim();
  if (!safeRootFolderId) {
    return safePermissionId;
  }
  return JSON.stringify({ permissionId: safePermissionId, rootFolderId: safeRootFolderId });
}

/**
 * Returns whether `path` is a safe Google Drive backup folder path within My Drive.
 * Empty string or `/` means the Drive root.
 * @param path - Candidate folder path using `/` separators.
 * @returns True when the path is allowed.
 */
export function isValidGoogleDriveBackupFolderPath(path: string): boolean {
  const trimmed = path.trim();
  if (trimmed === '' || trimmed === '/') return true;

  const normalized = trimmed.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized) return true;

  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.' || segment === '..') return false;
    if (/[\\/:*?"<>|\u0000-\u001f]/.test(segment)) return false;
  }

  return true;
}

/**
 * Normalizes a Google Drive backup folder path for storage and display.
 * @param path - Raw folder path from the connections form.
 * @returns Normalized path (`''` for Drive root).
 */
export function normalizeGoogleDriveBackupFolderPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === '' || trimmed === '/') return '';

  return trimmed.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

async function readDriveFileById(
  fileId: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<DriveFileLookupResponse | null> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,trashed`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      ...(signal ? { signal } : {}),
    }
  );

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const details = await readApiErrorDetails(res);
    throw new GoogleDriveApiError('Google Drive file lookup failed.', res.status, details);
  }

  return (await res.json().catch(() => ({}))) as DriveFileLookupResponse;
}

async function findDriveFolderIdByName(
  folderName: string,
  accessToken: string,
  opts?: { parentId?: string; signal?: AbortSignal }
): Promise<string | null> {
  const qParts = [
    `name = '${escapeDriveQueryValue(folderName)}'`,
    `mimeType = '${DRIVE_FOLDER_MIME_TYPE}'`,
    'trashed = false',
    `'${opts?.parentId?.trim() || 'root'}' in parents`,
  ];

  const url = new URL(DRIVE_FILES_LIST_URL);
  url.searchParams.set('q', qParts.join(' and '));
  url.searchParams.set('pageSize', '10');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    ...(opts?.signal ? { signal: opts.signal } : {}),
  });

  if (!res.ok) {
    const details = await readApiErrorDetails(res);
    throw new GoogleDriveApiError('Google Drive folder lookup failed.', res.status, details);
  }

  const body = (await res.json().catch(() => ({}))) as DriveListResponse;
  const folderId = body.files?.find((file) => file.id && file.trashed !== true)?.id?.trim();
  return folderId || null;
}

async function createDriveFolder(
  folderName: string,
  accessToken: string,
  opts?: { parentId?: string; signal?: AbortSignal }
): Promise<string> {
  const res = await fetch(DRIVE_FILES_CREATE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      ...(opts?.parentId?.trim() ? { parents: [opts.parentId.trim()] } : {}),
    }),
    ...(opts?.signal ? { signal: opts.signal } : {}),
  });

  if (!res.ok) {
    const details = await readApiErrorDetails(res);
    throw new GoogleDriveApiError('Google Drive folder create failed.', res.status, details);
  }

  const body = (await res.json().catch(() => ({}))) as DriveFileLookupResponse;
  const folderId = body.id?.trim();
  if (!folderId) {
    throw new Error('Google Drive folder creation succeeded but no folder id was returned.');
  }
  return folderId;
}

async function ensureDriveFolder(
  folderName: string,
  accessToken: string,
  opts?: { parentId?: string; signal?: AbortSignal }
): Promise<string> {
  const existingFolderId = await findDriveFolderIdByName(folderName, accessToken, opts);
  if (existingFolderId) {
    return existingFolderId;
  }
  return createDriveFolder(folderName, accessToken, opts);
}

/**
 * Resolves a configured backup folder path to a Drive folder id, creating folders as needed.
 * @param backupFolderPath - Folder path within My Drive; empty means Drive root.
 * @param accessToken - Valid Google Drive access token.
 * @param signal - Optional abort signal.
 * @returns Folder id for the configured path, or undefined for Drive root.
 */
export async function resolveGoogleDriveBackupRootFolderId(
  backupFolderPath: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<string | undefined> {
  const normalized = normalizeGoogleDriveBackupFolderPath(backupFolderPath);
  if (!normalized) {
    return undefined;
  }

  const segments = normalized.split('/').filter(Boolean);
  let parentId: string | undefined;

  for (const segment of segments) {
    parentId = await ensureDriveFolder(segment, accessToken, {
      parentId,
      signal,
    });
  }

  return parentId;
}

/**
 * Executes refresh google drive access token.
 * @param input - Input payload for this operation.
 * @returns The computed result.
 */
export async function refreshGoogleDriveAccessToken(input: {
  refreshToken?: string;
}): Promise<
  | { ok: true; accessToken: string; refreshToken: string; tokenExpiry: string }
  | { ok: false; error: PlatformUploadError }
> {
  if (!input.refreshToken?.trim()) {
    return {
      ok: false,
      error: {
        code: 'GOOGLE_DRIVE_REFRESH_TOKEN_MISSING',
        message: 'Google Drive refresh token is missing.',
      },
    };
  }

  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      ok: false,
      error: {
        code: 'GOOGLE_DRIVE_OAUTH_CONFIG_MISSING',
        message: 'Google Drive OAuth client configuration is missing on the server.',
      },
    };
  }

  try {
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: input.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const details = await readApiErrorDetails(tokenResponse);
      return {
        ok: false,
        error: {
          code: 'GOOGLE_DRIVE_TOKEN_REFRESH_FAILED',
          message: 'Failed to refresh Google Drive access token.',
          statusCode: tokenResponse.status,
          details,
        },
      };
    }

    const payload = (await tokenResponse
      .json()
      .catch(() => ({}))) as GoogleDriveRefreshTokenResponse;
    if (!payload.access_token || !payload.expires_in) {
      return {
        ok: false,
        error: {
          code: 'GOOGLE_DRIVE_TOKEN_REFRESH_INVALID_RESPONSE',
          message: 'Google Drive token refresh response is missing required fields.',
        },
      };
    }

    return {
      ok: true,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? input.refreshToken,
      tokenExpiry: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'GOOGLE_DRIVE_TOKEN_REFRESH_ERROR',
        message: 'Unexpected error while refreshing Google Drive access token.',
        statusCode: 500,
        details: messageFromThrown(error),
      },
    };
  }
}

/**
 * Executes upload to google drive.
 * @param input - Input payload for this operation.
 * @returns The computed result.
 */
export async function uploadToGoogleDrive(
  input: UploadToGoogleDriveInput
): Promise<PlatformUploadResult> {
  if (!input.tokens.accessToken?.trim()) {
    return toError('GOOGLE_DRIVE_TOKEN_MISSING', 'Google Drive access token is missing.');
  }

  try {
    const contentType = input.contentType?.trim() || 'application/octet-stream';
    const fileName = input.fileName.trim() || 'VideoSphere Backup.mp4';
    const driveIdentity = parseGoogleDrivePlatformUserId(input.connectedAccount.platformUserId);

    let backupRootFolderId = driveIdentity.rootFolderId?.trim() || undefined;
    if (backupRootFolderId) {
      const existingRoot = await readDriveFileById(
        backupRootFolderId,
        input.tokens.accessToken,
        input.signal
      );
      const rootMissingOrInvalid =
        !existingRoot ||
        existingRoot.trashed === true ||
        existingRoot.mimeType !== DRIVE_FOLDER_MIME_TYPE;
      if (rootMissingOrInvalid) {
        backupRootFolderId = undefined;
      }
    }

    if (!backupRootFolderId) {
      const configuredPath = normalizeGoogleDriveBackupFolderPath(
        input.connectedAccount.googleDriveBackupFolderPath ?? ''
      );
      if (configuredPath) {
        backupRootFolderId = await resolveGoogleDriveBackupRootFolderId(
          configuredPath,
          input.tokens.accessToken,
          input.signal
        );
      }
    }

    let uploadParentFolderId: string | undefined = backupRootFolderId;
    const yearFolderName = input.yearFolderName?.trim();
    if (yearFolderName) {
      uploadParentFolderId = await ensureDriveFolder(yearFolderName, input.tokens.accessToken, {
        parentId: backupRootFolderId,
        signal: input.signal,
      });
    }

    const sessionResolution = await resolveGoogleResumableUploadSession({
      storedSessionUrl: input.resumableState?.resumableUploadUrl,
      accessToken: input.tokens.accessToken,
      totalBytes: input.contentLength ?? 0,
      contentType,
      signal: input.signal,
      clearResumableState: input.clearResumableState,
      createSession: async () => {
        const createRes = await fetch(DRIVE_RESUMABLE_CREATE_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${input.tokens.accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': contentType,
            ...(input.contentLength
              ? { 'X-Upload-Content-Length': String(input.contentLength) }
              : {}),
          },
          body: JSON.stringify({
            name: fileName,
            mimeType: contentType,
            ...(uploadParentFolderId ? { parents: [uploadParentFolderId] } : {}),
          }),
          ...(input.signal ? { signal: input.signal } : {}),
        });

        if (!createRes.ok) {
          const details = await readApiErrorDetails(createRes);
          return {
            ok: false,
            error: {
              code: 'GOOGLE_DRIVE_RESUMABLE_INIT_FAILED',
              message: 'Failed to initialize Google Drive upload.',
              statusCode: createRes.status,
              details,
            },
          };
        }

        const location = createRes.headers.get('location');
        if (!location) {
          return {
            ok: false,
            error: {
              code: 'GOOGLE_DRIVE_UPLOAD_URL_MISSING',
              message: 'Google Drive did not return a resumable upload URL.',
            },
          };
        }

        return location;
      },
      persistNewSession:
        input.contentLength && input.contentLength > 0
          ? async (sessionUrl) => {
              await input.persistResumableState?.({
                resumableUploadUrl: sessionUrl,
                resumableBytesConfirmed: 0,
                resumableUpdatedAt: new Date().toISOString(),
              });
            }
          : undefined,
    });

    if (sessionResolution.kind === 'error') {
      return sessionResolution.result;
    }

    let uploadResult: PlatformUploadResult;

    if (sessionResolution.kind === 'complete') {
      uploadResult = {
        ok: true,
        platformVideoId: sessionResolution.resourceId,
        platformUrl: `https://drive.google.com/file/d/${sessionResolution.resourceId}/view`,
      };
    } else {
      const { sessionUrl, startOffset } = sessionResolution.session;

      if (input.contentLength && input.contentLength > 0) {
        uploadResult = await uploadGoogleResumableInChunks({
          sessionUrl,
          accessToken: input.tokens.accessToken,
          stream: input.videoStream,
          totalBytes: input.contentLength,
          contentType,
          startOffset,
          onBytesConfirmed: input.persistResumableState
            ? async (bytesConfirmed) => {
                await input.persistResumableState?.({
                  resumableUploadUrl: sessionUrl,
                  resumableBytesConfirmed: bytesConfirmed,
                  resumableUpdatedAt: new Date().toISOString(),
                });
              }
            : undefined,
          signal: input.signal,
          errorCodes: GOOGLE_DRIVE_RESUMABLE_ERROR_CODES,
          messages: GOOGLE_DRIVE_RESUMABLE_MESSAGES,
          buildSuccessResult: buildDriveUploadSuccessResult,
        });
      } else {
        uploadResult = await uploadGoogleResumableSinglePut({
          sessionUrl,
          accessToken: input.tokens.accessToken,
          stream: input.videoStream,
          contentLength: input.contentLength,
          contentType,
          signal: input.signal,
          uploadFailedCode: 'GOOGLE_DRIVE_UPLOAD_FAILED',
          uploadFailedMessage: 'Google Drive video upload failed.',
          buildSuccessResult: buildDriveUploadSuccessResult,
        });
      }
    }

    if (uploadResult.ok === false) {
      if (!isRetryableGoogleDriveUploadFailure(uploadResult)) {
        await input.clearResumableState?.();
      }
      return uploadResult;
    }

    await input.clearResumableState?.();
    return uploadResult;
  } catch (error) {
    if (error instanceof GoogleDriveApiError) {
      return toError(
        'GOOGLE_DRIVE_UPLOAD_FAILED',
        'Google Drive upload failed.',
        error.statusCode,
        error.details ?? error.message
      );
    }

    return toError(
      'GOOGLE_DRIVE_UPLOAD_ERROR',
      'Unexpected Google Drive upload error.',
      500,
      messageFromThrown(error)
    );
  }
}
