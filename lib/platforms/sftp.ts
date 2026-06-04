import { posix as pathPosix } from 'node:path';
import { isIPv6 } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import { messageFromThrown } from '@/lib/utils/error-message';
import type { ConnectedAccount, SftpAuthMethod } from '@/types';
import type { PlatformUploadError, PlatformUploadResult } from '@/lib/platforms/types';

interface UploadToSftpInput {
  connectedAccount: ConnectedAccount;
  videoStream: ReadableStream<Uint8Array>;
  contentLength?: number;
  contentType?: string;
  metadata: { title: string };
  signal?: AbortSignal;
}

/**
 * Plaintext SFTP connection parameters used for test connections and upload auth.
 * Values are encrypted before persistence on a {@link ConnectedAccount}.
 * @property host - SFTP server hostname or IP address.
 * @property port - SFTP server port (typically 22).
 * @property username - SSH login username.
 * @property authMethod - Whether `credential` is a private key PEM or a password.
 * @property credential - Private key PEM string or password, depending on `authMethod`.
 * @property passphrase - Key passphrase when `authMethod` is `key` and the key is encrypted.
 * @property remotePath - Absolute remote directory for backups (must start with `/`).
 */
interface SftpCredentials {
  host: string;
  port: number;
  username: string;
  authMethod: SftpAuthMethod;
  credential: string;
  passphrase?: string;
  remotePath: string;
  /** SHA-256 host key fingerprint (lowercase hex) pinned after the first successful connect. */
  hostKeyFingerprint?: string;
}

/** Far-future expiry for SFTP connected accounts (credentials do not expire). */
export const SFTP_TOKEN_EXPIRY = '2099-01-01T00:00:00.000Z';

/** Remote backup file mode: owner read/write only (private video content). */
const SFTP_REMOTE_FILE_MODE = 0o600;

/** Hash algorithm used when pinning and verifying SFTP server host keys. */
const SFTP_HOST_KEY_HASH_ALGO = 'sha256';

interface HostKeyPinningState {
  expectedFingerprint?: string;
  capturedFingerprint?: string;
}

/**
 * Returns whether two SFTP host key fingerprints match using a timing-safe comparison.
 * @param expected - Stored fingerprint from a prior successful connection.
 * @param actual - Fingerprint reported by the server during the current handshake.
 * @returns True when the fingerprints are identical.
 */
function hostKeyFingerprintsMatch(expected: string, actual: string): boolean {
  const a = expected.toLowerCase();
  const b = actual.toLowerCase();
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function isHostKeyVerificationError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('host denied') || lower.includes('host key verification failed');
}

/**
 * Returns whether `remotePath` is a safe absolute POSIX directory for SFTP backups.
 * Rejects backslashes and `.` / `..` path segments.
 * @param remotePath - Candidate remote directory path.
 * @returns True when the path is allowed.
 */
export function isValidSftpRemotePath(remotePath: string): boolean {
  if (!remotePath.startsWith('/')) return false;
  if (remotePath.includes('\\')) return false;
  for (const segment of remotePath.split('/')) {
    if (segment === '.' || segment === '..') return false;
  }
  return true;
}

/**
 * Returns whether `port` is a valid TCP port for SFTP connections.
 * @param port - Candidate port number.
 * @returns True when the port is an integer from 1 through 65535.
 */
export function isValidSftpPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function invalidRemotePathError(): PlatformUploadError {
  return {
    code: 'SFTP_REMOTE_PATH_INVALID',
    message: 'Remote path must be an absolute path without . or .. segments or backslashes.',
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

function extensionFromContentType(contentType: string | undefined): string {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('mp4')) return 'mp4';
  if (ct.includes('quicktime')) return 'mov';
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('x-matroska')) return 'mkv';
  return 'mp4';
}

function formatSftpTimestamp(now: Date): string {
  return now
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-');
}

function normalizeSftpFileName(title: string, contentType: string | undefined, now: Date): string {
  const base = title.trim() || 'VideoSphere Backup';
  const safeBase = base
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const ext = extensionFromContentType(contentType);
  const timestamp = formatSftpTimestamp(now);
  return `${timestamp} - ${safeBase || 'VideoSphere Backup'} - backup.${ext}`;
}

function encodeSftpUriPath(remotePath: string): string {
  return remotePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function formatSftpAuthorityHost(host: string): string {
  return isIPv6(host) ? `[${host}]` : host;
}

function buildSftpPlatformUrl(host: string, port: number, remotePath: string): string {
  const authorityHost = formatSftpAuthorityHost(host);
  const authority = port === 22 ? authorityHost : `${authorityHost}:${port}`;
  return `sftp://${authority}${encodeSftpUriPath(remotePath)}`;
}

function buildConnectConfig(
  credentials: SftpCredentials,
  hostKeyPinning?: HostKeyPinningState
): ConnectConfig {
  const config: ConnectConfig = {
    host: credentials.host,
    port: credentials.port,
    username: credentials.username,
    readyTimeout: 20_000,
  };

  if (credentials.authMethod === 'key') {
    config.privateKey = credentials.credential;
    if (credentials.passphrase != null && credentials.passphrase.trim() !== '') {
      config.passphrase = credentials.passphrase;
    }
  } else {
    config.password = credentials.credential;
  }

  const expectedFingerprint = hostKeyPinning?.expectedFingerprint ?? credentials.hostKeyFingerprint;

  config.hostHash = SFTP_HOST_KEY_HASH_ALGO;
  config.hostVerifier = (hashedKeyHex: string) => {
    const fingerprint = hashedKeyHex.toLowerCase();
    if (expectedFingerprint) {
      return hostKeyFingerprintsMatch(expectedFingerprint, fingerprint);
    }
    if (hostKeyPinning) {
      hostKeyPinning.capturedFingerprint = fingerprint;
    }
    return true;
  };

  return config;
}

function credentialsFromConnectedAccount(account: ConnectedAccount): SftpCredentials | null {
  const host = account.sftpHost?.trim();
  const username = account.platformUserId?.trim();
  const remotePath = account.sftpRemotePath?.trim();
  const authMethod = account.sftpAuthMethod;
  const credential = account.accessToken;

  if (!host || !username || !remotePath || !authMethod || credential.trim() === '') {
    return null;
  }

  // Defense-in-depth: match connect-route validation even for invalid DB values.
  if (!isValidSftpRemotePath(remotePath)) {
    return null;
  }

  const port = account.sftpPort ?? 22;
  if (!isValidSftpPort(port)) {
    return null;
  }

  return {
    host,
    port,
    username,
    authMethod,
    credential,
    ...(account.refreshToken != null && account.refreshToken.trim() !== ''
      ? { passphrase: account.refreshToken }
      : {}),
    remotePath,
    ...(account.sftpHostKeyFingerprint?.trim()
      ? { hostKeyFingerprint: account.sftpHostKeyFingerprint.trim().toLowerCase() }
      : {}),
  };
}

function promisifyConnect(
  conn: Client,
  config: ConnectConfig,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      conn.off('ready', onReady);
      conn.off('error', onError);
      conn.off('close', onClose);
      conn.off('end', onEnd);
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };

    const onReady = () => {
      settle(resolve);
    };

    const onError = (err: Error) => {
      settle(() => reject(err));
    };

    const onClose = () => {
      settle(() => {
        reject(
          new Error(
            signal?.aborted ? 'SFTP connection aborted' : 'SFTP connection closed before ready'
          )
        );
      });
    };

    const onEnd = () => {
      settle(() => {
        reject(
          new Error(
            signal?.aborted ? 'SFTP connection aborted' : 'SFTP connection ended before ready'
          )
        );
      });
    };

    const onAbort = () => {
      conn.end();
      settle(() => reject(new Error('SFTP connection aborted')));
    };

    conn.once('ready', onReady);
    conn.once('error', onError);
    conn.once('close', onClose);
    conn.once('end', onEnd);

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    conn.connect(config);
  });
}

function promisifySftp(conn: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) reject(err);
      else resolve(sftp);
    });
  });
}

class SftpRemotePathValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SftpRemotePathValidationError';
  }
}

function isRemotePathStatError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code =
    'code' in err && typeof (err as { code: unknown }).code === 'string'
      ? (err as { code: string }).code
      : '';
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return true;
  }
  const lower = err.message.toLowerCase();
  return lower.includes('no such file') || lower.includes('not a directory');
}

function promisifySftpStat(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, stats) => {
      if (err) {
        reject(err);
        return;
      }
      if (!stats.isDirectory()) {
        reject(new SftpRemotePathValidationError(`Remote path is not a directory: ${remotePath}`));
        return;
      }
      resolve();
    });
  });
}

function pipeStreamToSftp(
  sftp: SFTPWrapper,
  remotePath: string,
  source: Readable,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const writeStream = sftp.createWriteStream(remotePath, {
      flags: 'w',
      mode: SFTP_REMOTE_FILE_MODE,
    });
    let settled = false;
    let finished = false;

    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      action();
    };

    const cleanup = () => {
      source.destroy();
      writeStream.destroy();
    };

    const onAbort = () => {
      settle(() => {
        cleanup();
        reject(new Error('SFTP upload aborted'));
      });
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    source.on('error', (err) => {
      settle(() => {
        cleanup();
        reject(err);
      });
    });

    writeStream.on('error', (err) => {
      settle(() => {
        cleanup();
        reject(err);
      });
    });

    writeStream.on('finish', () => {
      finished = true;
      settle(resolve);
    });

    writeStream.on('close', () => {
      if (finished) return;
      settle(() => {
        cleanup();
        reject(new Error('SFTP upload closed before finishing'));
      });
    });

    source.pipe(writeStream);
  });
}

function classifyConnectionError(err: unknown): PlatformUploadError {
  const message = messageFromThrown(err);
  const lower = message.toLowerCase();

  if (err instanceof SftpRemotePathValidationError || isRemotePathStatError(err)) {
    return {
      code: 'SFTP_REMOTE_PATH_INVALID',
      message: 'Remote path must be an existing directory on the SFTP server.',
      statusCode: 400,
      details: message,
    };
  }

  if (
    lower.includes('authentication') ||
    lower.includes('auth fail') ||
    lower.includes('permission denied') ||
    lower.includes('all configured authentication methods failed')
  ) {
    return {
      code: 'SFTP_AUTH_FAILED',
      message: 'SFTP authentication failed.',
      statusCode: 401,
      details: message,
    };
  }

  if (isHostKeyVerificationError(message)) {
    return {
      code: 'SFTP_HOST_KEY_MISMATCH',
      message: 'SFTP server host key does not match the pinned fingerprint.',
      statusCode: 400,
      details: message,
    };
  }

  return {
    code: 'SFTP_CONNECTION_FAILED',
    message: 'Failed to connect to the SFTP server.',
    statusCode: 500,
    details: message,
  };
}

/**
 * Validates SFTP credentials by opening a connection and checking the remote directory exists.
 * Pins the server host key on first connect; subsequent calls verify against the pinned fingerprint.
 * @param credentials - SFTP connection parameters (plaintext; not yet encrypted).
 * @returns Whether the test connection succeeded with the pinned host key fingerprint, or a classified platform error on failure.
 */
export async function testSftpConnection(
  credentials: SftpCredentials
): Promise<{ ok: true; hostKeyFingerprint: string } | { ok: false; error: PlatformUploadError }> {
  if (!isValidSftpRemotePath(credentials.remotePath)) {
    return { ok: false as const, error: invalidRemotePathError() };
  }

  const conn = new Client();
  const hostKeyPinning: HostKeyPinningState = {
    expectedFingerprint: credentials.hostKeyFingerprint,
  };

  try {
    await promisifyConnect(conn, buildConnectConfig(credentials, hostKeyPinning));
    const sftp = await promisifySftp(conn);
    await promisifySftpStat(sftp, credentials.remotePath);

    const hostKeyFingerprint = hostKeyPinning.capturedFingerprint ?? credentials.hostKeyFingerprint;
    if (!hostKeyFingerprint) {
      return {
        ok: false as const,
        error: {
          code: 'SFTP_CONNECTION_FAILED',
          message: 'Failed to pin the SFTP server host key.',
          statusCode: 500,
        },
      };
    }

    return { ok: true as const, hostKeyFingerprint };
  } catch (err) {
    const classified = classifyConnectionError(err);
    return { ok: false as const, error: classified };
  } finally {
    conn.end();
  }
}

/**
 * Streams a video backup to a connected SFTP server.
 * @param input - Upload payload including the connected account and video stream.
 * @returns Platform upload result with remote path on success.
 */
export async function uploadToSftp(input: UploadToSftpInput): Promise<PlatformUploadResult> {
  const credentials = credentialsFromConnectedAccount(input.connectedAccount);
  if (!credentials) {
    return toError('SFTP_CONFIG_INVALID', 'SFTP connection settings are incomplete or invalid.');
  }

  if (!credentials.hostKeyFingerprint) {
    return toError(
      'SFTP_HOST_KEY_UNPINNED',
      'SFTP host key is not pinned. Reconnect SFTP in profile settings before uploading.',
      400
    );
  }

  const conn = new Client();
  const onAbort = () => {
    conn.end();
  };

  if (input.signal) {
    if (input.signal.aborted) {
      return toError('SFTP_UPLOAD_ABORTED', 'SFTP upload was cancelled.');
    }
    input.signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    await promisifyConnect(conn, buildConnectConfig(credentials), input.signal);
    const sftp = await promisifySftp(conn);

    const fileName = normalizeSftpFileName(input.metadata.title, input.contentType, new Date());
    const fullRemotePath = pathPosix.join(credentials.remotePath, fileName);

    const nodeReadable = Readable.fromWeb(
      input.videoStream as Parameters<typeof Readable.fromWeb>[0]
    );

    await pipeStreamToSftp(sftp, fullRemotePath, nodeReadable, input.signal);

    return {
      ok: true,
      platformVideoId: fullRemotePath,
      platformUrl: buildSftpPlatformUrl(credentials.host, credentials.port, fullRemotePath),
    };
  } catch (err) {
    if (input.signal?.aborted) {
      return toError('SFTP_UPLOAD_ABORTED', 'SFTP upload was cancelled.');
    }

    const message = messageFromThrown(err);
    const lower = message.toLowerCase();

    if (
      lower.includes('authentication') ||
      lower.includes('auth fail') ||
      lower.includes('permission denied') ||
      lower.includes('all configured authentication methods failed')
    ) {
      return toError('SFTP_AUTH_FAILED', 'SFTP authentication failed.', 401, message);
    }

    if (isHostKeyVerificationError(message)) {
      return toError(
        'SFTP_HOST_KEY_MISMATCH',
        'SFTP server host key does not match the pinned fingerprint.',
        400,
        message
      );
    }

    if (lower.includes('connect') || lower.includes('handshake') || lower.includes('timeout')) {
      return toError(
        'SFTP_CONNECTION_FAILED',
        'Failed to connect to the SFTP server.',
        500,
        message
      );
    }

    return toError(
      'SFTP_WRITE_FAILED',
      'Failed to upload backup to the SFTP server.',
      500,
      message
    );
  } finally {
    if (input.signal) {
      input.signal.removeEventListener('abort', onAbort);
    }
    conn.end();
  }
}

export type { SftpCredentials };
