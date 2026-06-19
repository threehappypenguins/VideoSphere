import { isIPv6 } from 'node:net';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Writable } from 'node:stream';
import { Client } from 'node-smb2';
import { resolveUniqueBackupFileName } from '@/lib/backup-filename';
import { UploadWriteBuffer } from '@/lib/platforms/upload-write-buffer';
import { messageFromThrown } from '@/lib/utils/error-message';
import type { ConnectedAccount } from '@/types';
import type { PlatformUploadError, PlatformUploadResult } from '@/lib/platforms/types';

interface UploadToSmbInput {
  connectedAccount: ConnectedAccount;
  videoStream: ReadableStream<Uint8Array>;
  contentLength?: number;
  contentType?: string;
  fileName: string;
  /** When set, upload inside this year folder under the configured remote root. */
  yearFolderName?: string;
  signal?: AbortSignal;
}

/**
 * Plaintext SMB connection parameters used for test connections and upload auth.
 * Values are encrypted before persistence on a {@link ConnectedAccount}.
 * @property host - SMB server hostname or IP address.
 * @property share - Share name (without UNC prefix).
 * @property domain - Windows domain or workgroup (optional).
 * @property username - Login username.
 * @property password - Login password.
 * @property remotePath - Directory within the share. Share root: empty string, `/`, or `\`; otherwise a path starting with `/` or `\` (POSIX or Windows separators), without `.` or `..` segments.
 */
interface SmbCredentials {
  host: string;
  share: string;
  domain?: string;
  username: string;
  password: string;
  remotePath: string;
}

/** Far-future expiry for SMB connected accounts (credentials do not expire). */
export const SMB_TOKEN_EXPIRY = '2099-01-01T00:00:00.000Z';

/**
 * Maximum chunk size accepted by `node-smb2` file write streams before the library fans out
 * parallel SMB Write requests (see `maxWriteChunkLength` in the package). Chunks above this size
 * can overwhelm the server and hit the library's per-request timeout.
 */
export const SMB_MAX_WRITE_CHUNK_LENGTH = 0x0001_0000 - 0x71;

/** Per-request timeout for SMB uploads (`node-smb2` default is 5s). */
const SMB_UPLOAD_REQUEST_TIMEOUT_MS = 120_000;

/** Per-request timeout for SMB connection tests (matches `node-smb2` default). */
const SMB_TEST_REQUEST_TIMEOUT_MS = 5_000;

/**
 * Default NTLM domain/workgroup when the user leaves the domain field empty.
 * Matches the typical Samba standalone default (`WORKGROUP`), as shown by smbclient.
 */
export const SMB_DEFAULT_DOMAIN = 'WORKGROUP';

/** NTSTATUS values returned in SMB2 response headers (unsigned 32-bit). */
const SMB_NT_STATUS = {
  ACCESS_DENIED: 0xc0000022,
  OBJECT_NAME_NOT_FOUND: 0xc0000034,
  OBJECT_NAME_COLLISION: 0xc0000035,
  OBJECT_PATH_NOT_FOUND: 0xc000003a,
  WRONG_PASSWORD: 0xc000006a,
  LOGON_FAILURE: 0xc000006d,
  BAD_NETWORK_NAME: 0xc00000cc,
} as const;

const SMB_NT_STATUS_LABELS: Record<number, string> = {
  [SMB_NT_STATUS.ACCESS_DENIED]: 'STATUS_ACCESS_DENIED',
  [SMB_NT_STATUS.OBJECT_NAME_NOT_FOUND]: 'STATUS_OBJECT_NAME_NOT_FOUND',
  [SMB_NT_STATUS.OBJECT_NAME_COLLISION]: 'STATUS_OBJECT_NAME_COLLISION',
  [SMB_NT_STATUS.OBJECT_PATH_NOT_FOUND]: 'STATUS_OBJECT_PATH_NOT_FOUND',
  [SMB_NT_STATUS.WRONG_PASSWORD]: 'STATUS_WRONG_PASSWORD',
  [SMB_NT_STATUS.LOGON_FAILURE]: 'STATUS_LOGON_FAILURE',
  [SMB_NT_STATUS.BAD_NETWORK_NAME]: 'STATUS_BAD_NETWORK_NAME',
};

/** Retries when a unique backup filename races with an existing share object. */
const SMB_UNIQUE_FILENAME_OPEN_ATTEMPTS = 20;

/**
 * Minimal SMB share tree surface returned by `session.connectTree`.
 * `node-smb2` does not export `Tree` from its public entry; this avoids brittle `dist/` imports.
 */
interface SmbShareTree {
  readDirectory(path?: string): Promise<unknown>;
  createDirectory(path: string): Promise<void>;
  createFileWriteStream(path: string): Promise<Writable>;
}

/** SMB2 response shape thrown by `node-smb2` when `header.status` is not success. */
interface Smb2ResponseError {
  header?: { status?: number };
  typeName?: string;
}

function isSmb2ResponseError(err: unknown): err is Smb2ResponseError {
  return typeof err === 'object' && err !== null && 'header' in err;
}

/**
 * Reads the NTSTATUS code from a `node-smb2` response rejection.
 * @param err - Thrown value from the SMB client.
 * @returns Unsigned NTSTATUS, if present.
 */
function smbNtStatusFromThrown(err: unknown): number | undefined {
  if (!isSmb2ResponseError(err)) return undefined;
  const status = err.header?.status;
  if (typeof status !== 'number') return undefined;
  return status >>> 0;
}

function smbNtStatusLabel(status: number): string {
  return (
    SMB_NT_STATUS_LABELS[status >>> 0] ?? `NTSTATUS 0x${(status >>> 0).toString(16).toUpperCase()}`
  );
}

/**
 * Returns whether an SMB client error indicates the target path already exists.
 * @param err - Thrown value from the SMB client.
 * @returns True for `STATUS_OBJECT_NAME_COLLISION`.
 */
function isSmbNameCollisionError(err: unknown): boolean {
  const nt = smbNtStatusFromThrown(err);
  if (nt === SMB_NT_STATUS.OBJECT_NAME_COLLISION) {
    return true;
  }

  const message = messageFromSmbThrown(err).toLowerCase();
  return (
    message.includes('status_object_name_collision') ||
    message.includes('object_name_collision') ||
    message.includes('0xc0000035')
  );
}

/**
 * Builds a human-readable message from SMB client errors, including non-Error response rejections.
 * @param err - Thrown value from the SMB client.
 * @returns Message suitable for logs and API `details`.
 */
function messageFromSmbThrown(err: unknown): string {
  if (err instanceof Error && err.message.trim() !== '') {
    return err.message;
  }

  if (isSmb2ResponseError(err)) {
    const nt = smbNtStatusFromThrown(err);
    const typeName = err.typeName?.trim() || 'SMB';
    if (nt != null) {
      return `${typeName}: ${smbNtStatusLabel(nt)}`;
    }
    return `${typeName} request failed`;
  }

  return messageFromThrown(err);
}

class SmbRemotePathValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmbRemotePathValidationError';
  }
}

/**
 * Returns whether `remotePath` is a safe directory path within an SMB share.
 * Accepts empty string (share root), `/`, or paths starting with `/` or `\` without `.` / `..` segments.
 * @param remotePath - Candidate remote directory path.
 * @returns True when the path is allowed.
 */
export function isValidSmbRemotePath(remotePath: string): boolean {
  if (remotePath === '') return true;
  if (remotePath === '/' || remotePath === '\\') return true;
  const normalized = remotePath.replace(/\\/g, '/');
  if (!normalized.startsWith('/')) return false;
  for (const segment of normalized.split('/')) {
    if (segment === '.' || segment === '..') return false;
  }
  return true;
}

/**
 * Returns whether `segment` is a safe single path component for SMB uploads.
 * Rejects separators, `.` / `..` segments, and control characters.
 * @param segment - Candidate filename or year-folder name.
 * @returns True when the segment may be joined under a configured remote directory.
 */
export function isValidSmbUploadPathSegment(segment: string): boolean {
  const trimmed = segment.trim();
  if (!trimmed) return false;
  if (trimmed.includes('/') || trimmed.includes('\\')) return false;
  if (/[\u0000-\u001f]/.test(trimmed)) return false;
  if (trimmed === '.' || trimmed === '..') return false;

  return true;
}

function invalidRemotePathError(): PlatformUploadError {
  return {
    code: 'SMB_REMOTE_PATH_INVALID',
    message:
      'Remote path must be empty (share root) or start with / or \\, without . or .. segments.',
    statusCode: 400,
  };
}

function invalidUploadPathSegmentError(): PlatformUploadError {
  return {
    code: 'SMB_UPLOAD_PATH_INVALID',
    message:
      'Backup filename and year folder must be single path segments without . or .. components.',
    statusCode: 400,
  };
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

/**
 * Converts a stored remote path to a POSIX path within the share (`/` = share root).
 * @param remotePath - User-facing path (POSIX or Windows style).
 * @returns Directory path passed to the SMB client (`/` for share root).
 */
export function toSmbClientDirectoryPath(remotePath: string): string {
  const trimmed = remotePath.trim();
  if (trimmed === '' || trimmed === '/' || trimmed === '\\') return '/';

  const segments = trimmed
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');

  if (segments.length === 0) return '/';
  return `/${segments.join('/')}`;
}

function joinSmbFilePath(directoryPath: string, fileName: string): string {
  if (directoryPath === '/') return `/${fileName}`;
  return `${directoryPath}/${fileName}`;
}

function formatSmbAuthorityHost(host: string): string {
  return isIPv6(host) ? `[${host}]` : host;
}

function buildSmbPlatformUrl(host: string, share: string, fullRemotePath: string): string {
  const authorityHost = formatSmbAuthorityHost(host);
  const encodedShare = encodeURIComponent(share);
  const pathPart = fullRemotePath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return pathPart
    ? `smb://${authorityHost}/${encodedShare}/${pathPart}`
    : `smb://${authorityHost}/${encodedShare}`;
}

/**
 * Resolves the NTLM domain/workgroup sent during SMB session setup.
 * @param credentials - SMB connection parameters.
 * @returns Domain string (defaults to {@link SMB_DEFAULT_DOMAIN} when unset).
 */
export function resolveSmbAuthDomain(credentials: Pick<SmbCredentials, 'domain'>): string {
  const explicit = credentials.domain?.trim();
  return explicit ? explicit : SMB_DEFAULT_DOMAIN;
}

function credentialsFromConnectedAccount(account: ConnectedAccount): SmbCredentials | null {
  const host = account.smbHost?.trim();
  const share = account.smbShare?.trim();
  const username = account.platformUserId?.trim();
  const password = account.accessToken;

  if (account.smbRemotePath == null) {
    return null;
  }

  const remotePath = account.smbRemotePath.trim();

  if (!host || !share || !username || password.trim() === '') {
    return null;
  }

  if (!isValidSmbRemotePath(remotePath)) {
    return null;
  }

  return {
    host,
    share,
    ...(account.smbDomain?.trim() ? { domain: account.smbDomain.trim() } : {}),
    username,
    password,
    remotePath,
  };
}

function isRemotePathStatError(err: unknown): boolean {
  const nt = smbNtStatusFromThrown(err);
  if (nt === SMB_NT_STATUS.OBJECT_NAME_NOT_FOUND || nt === SMB_NT_STATUS.OBJECT_PATH_NOT_FOUND) {
    return true;
  }

  if (!(err instanceof Error)) return false;
  const lower = err.message.toLowerCase();
  return (
    lower.includes('no such file') ||
    lower.includes('not found') ||
    lower.includes('not a directory') ||
    lower.includes('object name not found') ||
    lower.includes('path not found') ||
    lower.includes('status_object_name_not_found') ||
    lower.includes('status_object_path_not_found')
  );
}

/**
 * Verifies the remote directory exists by listing it (including share root `/`).
 * @param tree - Connected SMB tree for the target share.
 * @param remotePath - User-configured directory within the share.
 */
async function verifySmbRemoteDirectory(tree: SmbShareTree, remotePath: string): Promise<void> {
  const directoryPath = toSmbClientDirectoryPath(remotePath);
  try {
    await tree.readDirectory(directoryPath);
  } catch (err) {
    if (isRemotePathStatError(err)) {
      throw new SmbRemotePathValidationError(
        `Remote path is not an existing directory on the SMB share: ${remotePath}`
      );
    }
    throw err;
  }
}

/**
 * Ensures a directory exists within the SMB share, creating it when missing.
 * @param tree - Connected SMB tree for the target share.
 * @param directoryPath - POSIX directory path within the share.
 */
async function ensureSmbDirectory(tree: SmbShareTree, directoryPath: string): Promise<void> {
  try {
    await tree.readDirectory(directoryPath);
  } catch (err) {
    if (!isRemotePathStatError(err)) {
      throw err;
    }
    try {
      await tree.createDirectory(directoryPath);
    } catch (createErr) {
      if (isSmbNameCollisionError(createErr)) {
        return;
      }
      throw createErr;
    }
  }
}

/**
 * Normalizes SMB directory listing entries to bare filenames.
 * @param entries - Value returned by `node-smb2` `readDirectory`.
 * @returns Filenames present in the directory, excluding `.` and `..`.
 */
function parseSmbDirectoryFileNames(entries: unknown): string[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  const names: string[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      names.push(entry);
      continue;
    }

    if (entry && typeof entry === 'object') {
      const record = entry as { filename?: unknown; name?: unknown; FileName?: unknown };
      const name = record.filename ?? record.name ?? record.FileName;
      if (typeof name === 'string') {
        names.push(name);
      }
    }
  }

  return names.filter((name) => name !== '.' && name !== '..');
}

/**
 * Lists filenames in an SMB directory for duplicate backup filename resolution.
 * @param tree - Connected SMB tree for the target share.
 * @param directoryPath - POSIX directory path within the share.
 * @returns Filenames in the directory.
 */
async function listSmbDirectoryFileNames(
  tree: SmbShareTree,
  directoryPath: string
): Promise<string[]> {
  const entries = await tree.readDirectory(directoryPath);
  return parseSmbDirectoryFileNames(entries);
}

/**
 * Opens a write stream for a backup file, retrying when the share reports a name collision.
 * Collisions can occur when a prior failed upload left a file that directory listing missed.
 * @param tree - Connected SMB tree for the target share.
 * @param uploadDirectoryPath - Directory that will contain the backup file.
 * @param fileName - Desired backup filename before duplicate resolution.
 * @param signal - Optional abort signal checked between attempts.
 * @returns Writable stream and resolved remote file path within the share.
 */
async function openUniqueSmbFileWriteStream(
  tree: SmbShareTree,
  uploadDirectoryPath: string,
  fileName: string,
  signal?: AbortSignal
): Promise<{ writeStream: Writable; remoteFilePath: string }> {
  const occupiedOverrides: string[] = [];

  for (let attempt = 0; attempt < SMB_UNIQUE_FILENAME_OPEN_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) {
      throw new Error('SMB upload aborted');
    }

    const listedNames = await listSmbDirectoryFileNames(tree, uploadDirectoryPath);
    const uniqueFileName = resolveUniqueBackupFileName(
      fileName,
      [...listedNames, ...occupiedOverrides],
      { caseInsensitive: true }
    );
    const remoteFilePath = joinSmbFilePath(uploadDirectoryPath, uniqueFileName);

    try {
      const writeStream = await tree.createFileWriteStream(remoteFilePath);
      return { writeStream, remoteFilePath };
    } catch (err) {
      if (!isSmbNameCollisionError(err) || attempt === SMB_UNIQUE_FILENAME_OPEN_ATTEMPTS - 1) {
        throw err;
      }
      occupiedOverrides.push(uniqueFileName);
    }
  }

  throw new Error('Could not allocate a unique SMB backup filename after several attempts.');
}

function classifyConnectionError(err: unknown): PlatformUploadError {
  const message = messageFromSmbThrown(err);
  const lower = message.toLowerCase();
  const nt = smbNtStatusFromThrown(err);

  if (err instanceof SmbRemotePathValidationError || isRemotePathStatError(err)) {
    return {
      code: 'SMB_REMOTE_PATH_INVALID',
      message: 'Remote path must be an existing directory on the SMB share.',
      statusCode: 400,
      details: message,
    };
  }

  if (lower.includes('err_ossl_evp_unsupported') || lower.includes('digital envelope routines')) {
    return {
      code: 'SMB_CONNECTION_FAILED',
      message:
        'SMB authentication is not supported by the legacy SMB client on this Node.js version. Update VideoSphere or contact your administrator.',
      statusCode: 500,
      details: message,
    };
  }

  if (nt === SMB_NT_STATUS.ACCESS_DENIED || lower.includes('status_access_denied')) {
    return {
      code: 'SMB_AUTH_FAILED',
      message: 'SMB access denied. The account may lack permission for this share.',
      statusCode: 401,
      details: message,
    };
  }

  if (
    nt === SMB_NT_STATUS.LOGON_FAILURE ||
    nt === SMB_NT_STATUS.WRONG_PASSWORD ||
    lower.includes('status_logon_failure') ||
    lower.includes('logon failure') ||
    (nt !== SMB_NT_STATUS.ACCESS_DENIED && lower.includes('access denied')) ||
    lower.includes('authentication') ||
    lower.includes('invalid user') ||
    lower.includes('wrong password') ||
    lower.includes('status_wrong_password')
  ) {
    return {
      code: 'SMB_AUTH_FAILED',
      message: 'SMB authentication failed. Check the username, password, and domain.',
      statusCode: 401,
      details: message,
    };
  }

  if (
    nt === SMB_NT_STATUS.BAD_NETWORK_NAME ||
    lower.includes('status_bad_network_name') ||
    lower.includes('bad network name') ||
    (lower.includes('share') && lower.includes('not found'))
  ) {
    return {
      code: 'SMB_SHARE_NOT_FOUND',
      message: 'SMB share was not found on the server.',
      statusCode: 400,
      details: message,
    };
  }

  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('ehostunreach') ||
    lower.includes('network') ||
    lower.includes('unreachable')
  ) {
    return {
      code: 'SMB_CONNECTION_FAILED',
      message: 'Failed to connect to the SMB server.',
      statusCode: 500,
      details: message,
    };
  }

  return {
    code: 'SMB_CONNECTION_FAILED',
    message: 'Failed to connect to the SMB server.',
    statusCode: 500,
    details: message,
  };
}

/**
 * Runs `fn` with an authenticated SMB session and share tree; always closes the client.
 * @param credentials - SMB connection parameters.
 * @param fn - Callback receiving the connected tree.
 * @returns The callback result.
 */
interface WithSmbTreeOptions {
  /** Per SMB request timeout in milliseconds (`node-smb2` default: 5000). */
  requestTimeoutMs?: number;
}

async function withSmbTree<T>(
  credentials: SmbCredentials,
  fn: (tree: SmbShareTree) => Promise<T>,
  options: WithSmbTreeOptions = {}
): Promise<T> {
  const client = new Client(credentials.host, {
    requestTimeout: options.requestTimeoutMs ?? SMB_TEST_REQUEST_TIMEOUT_MS,
  });
  let pendingError: Error | undefined;

  client.on('error', (err) => {
    pendingError = err;
  });

  try {
    const session = await client.authenticate({
      domain: resolveSmbAuthDomain(credentials),
      username: credentials.username,
      password: credentials.password,
      forceNtlmVersion: 'v2',
    });
    if (pendingError) {
      throw pendingError;
    }

    const tree = await session.connectTree(credentials.share);
    if (pendingError) {
      throw pendingError;
    }

    return await fn(tree);
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** Waits until the SMB file write stream finishes flushing (and closes when emitted). */
function waitForWritableComplete(writeStream: Writable): Promise<void> {
  if (writeStream.writableFinished) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const done = () => {
      writeStream.off('finish', onFinish);
      writeStream.off('close', onClose);
      writeStream.off('error', onError);
      resolve();
    };

    const onFinish = () => done();
    const onClose = () => done();
    const onError = (err: Error) => {
      writeStream.off('finish', onFinish);
      writeStream.off('close', onClose);
      writeStream.off('error', onError);
      reject(err);
    };

    writeStream.on('finish', onFinish);
    writeStream.on('close', onClose);
    writeStream.on('error', onError);
  });
}

function writeToSmbStream(writeStream: Writable, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      writeStream.off('error', onError);
      writeStream.off('drain', onDrain);
      reject(err);
    };
    const onDrain = () => {
      writeStream.off('error', onError);
      writeStream.off('drain', onDrain);
      resolve();
    };

    writeStream.on('error', onError);
    if (writeStream.write(Buffer.from(chunk))) {
      writeStream.off('error', onError);
      writeStream.off('drain', onDrain);
      resolve();
    } else {
      writeStream.on('drain', onDrain);
    }
  });
}

async function pipeWebStreamToSmbWriteStream(
  source: ReadableStream<Uint8Array>,
  writeStream: Writable,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) {
    throw new Error('SMB upload aborted');
  }

  const nodeReadable = Readable.fromWeb(source as NodeReadableStream<Uint8Array>);
  const buffer = new UploadWriteBuffer(SMB_MAX_WRITE_CHUNK_LENGTH);

  const onAbort = () => {
    nodeReadable.destroy(new Error('SMB upload aborted'));
    writeStream.destroy(new Error('SMB upload aborted'));
  };

  if (signal) {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    for await (const rawChunk of nodeReadable) {
      if (signal?.aborted) {
        throw new Error('SMB upload aborted');
      }
      const chunk =
        rawChunk instanceof Buffer ? new Uint8Array(rawChunk) : (rawChunk as Uint8Array);
      for (const block of buffer.takeWritableChunks(chunk)) {
        await writeToSmbStream(writeStream, block);
      }
    }
    const remainder = buffer.takeRemainder();
    if (remainder) {
      await writeToSmbStream(writeStream, remainder);
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    await waitForWritableComplete(writeStream);
  } finally {
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * Opens a test connection, checks the remote directory exists, then disconnects.
 * @param credentials - SMB connection parameters (plaintext; not yet encrypted).
 * @returns Whether the test connection succeeded, or a classified platform error on failure.
 */
export async function testSmbConnection(
  credentials: SmbCredentials
): Promise<{ ok: true } | { ok: false; error: PlatformUploadError }> {
  if (!isValidSmbRemotePath(credentials.remotePath)) {
    return { ok: false as const, error: invalidRemotePathError() };
  }

  try {
    await withSmbTree(credentials, async (tree) => {
      await verifySmbRemoteDirectory(tree, credentials.remotePath);
    });
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: classifyConnectionError(err) };
  }
}

/**
 * Streams a video backup to an SMB/CIFS network share.
 * @param input - Upload payload including the connected account and video stream.
 * @returns Platform upload result with remote path on success.
 */
export async function uploadToSmb(input: UploadToSmbInput): Promise<PlatformUploadResult> {
  const credentials = credentialsFromConnectedAccount(input.connectedAccount);
  if (!credentials) {
    return toError('SMB_CONFIG_INVALID', 'SMB connection settings are incomplete or invalid.');
  }

  if (input.signal?.aborted) {
    return toError('SMB_UPLOAD_ABORTED', 'SMB upload was cancelled.');
  }

  const fileName = input.fileName.trim() || 'VideoSphere Backup.mp4';
  const yearFolderName = input.yearFolderName?.trim();

  if (!isValidSmbUploadPathSegment(fileName)) {
    const err = invalidUploadPathSegmentError();
    return toError(err.code, err.message, err.statusCode);
  }

  if (yearFolderName && !isValidSmbUploadPathSegment(yearFolderName)) {
    const err = invalidUploadPathSegmentError();
    return toError(err.code, err.message, err.statusCode);
  }

  try {
    const baseDirectoryPath = toSmbClientDirectoryPath(credentials.remotePath);
    const uploadDirectoryPath = yearFolderName
      ? joinSmbFilePath(baseDirectoryPath, yearFolderName)
      : baseDirectoryPath;

    let fullRemotePath = joinSmbFilePath(uploadDirectoryPath, fileName);

    await withSmbTree(
      credentials,
      async (tree) => {
        if (yearFolderName) {
          await ensureSmbDirectory(tree, uploadDirectoryPath);
        }
        const opened = await openUniqueSmbFileWriteStream(
          tree,
          uploadDirectoryPath,
          fileName,
          input.signal
        );
        fullRemotePath = opened.remoteFilePath;
        await pipeWebStreamToSmbWriteStream(input.videoStream, opened.writeStream, input.signal);
      },
      { requestTimeoutMs: SMB_UPLOAD_REQUEST_TIMEOUT_MS }
    );

    return {
      ok: true,
      platformVideoId: fullRemotePath,
      platformUrl: buildSmbPlatformUrl(credentials.host, credentials.share, fullRemotePath),
    };
  } catch (err) {
    if (input.signal?.aborted) {
      return toError('SMB_UPLOAD_ABORTED', 'SMB upload was cancelled.');
    }

    const message = messageFromSmbThrown(err);
    const lower = message.toLowerCase();

    if (lower.includes('request_timeout') || lower.startsWith('request_timeout:')) {
      return toError(
        'SMB_WRITE_FAILED',
        'SMB write timed out waiting for the server. The share may be slow or overloaded.',
        500,
        message
      );
    }

    if (isSmbNameCollisionError(err)) {
      return toError(
        'SMB_FILE_EXISTS',
        'A file with this backup name already exists on the SMB share.',
        409,
        message
      );
    }

    const classified = classifyConnectionError(err);
    if (classified.code !== 'SMB_CONNECTION_FAILED') {
      return toError(
        classified.code,
        classified.message,
        classified.statusCode,
        classified.details
      );
    }

    if (
      lower.includes('timeout') ||
      lower.includes('timed out') ||
      lower.includes('econnrefused') ||
      lower.includes('enotfound') ||
      lower.includes('ehostunreach') ||
      lower.includes('network') ||
      lower.includes('unreachable')
    ) {
      return toError('SMB_CONNECTION_FAILED', classified.message, classified.statusCode, message);
    }

    return toError('SMB_WRITE_FAILED', 'Failed to upload backup to the SMB share.', 500, message);
  }
}

export type { SmbCredentials };
