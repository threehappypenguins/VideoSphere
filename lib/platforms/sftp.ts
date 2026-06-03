import { posix as pathPosix } from 'node:path';
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
}

/** Far-future expiry for SFTP connected accounts (credentials do not expire). */
export const SFTP_TOKEN_EXPIRY = '2099-01-01T00:00:00.000Z';

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

function normalizeSftpFileName(title: string, contentType: string | undefined, now: Date): string {
  const base = title.trim() || 'VideoSphere Backup';
  const safeBase = base
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const ext = extensionFromContentType(contentType);
  const timestamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `${timestamp} - ${safeBase || 'VideoSphere Backup'} - backup.${ext}`;
}

function buildSftpPlatformUrl(host: string, port: number, remotePath: string): string {
  const authority = port === 22 ? host : `${host}:${port}`;
  return `sftp://${authority}${remotePath}`;
}

function buildConnectConfig(credentials: SftpCredentials): ConnectConfig {
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

  if (!remotePath.startsWith('/')) {
    return null;
  }

  return {
    host,
    port: account.sftpPort && account.sftpPort > 0 ? account.sftpPort : 22,
    username,
    authMethod,
    credential,
    ...(account.refreshToken != null && account.refreshToken.trim() !== ''
      ? { passphrase: account.refreshToken }
      : {}),
    remotePath,
  };
}

function promisifyConnect(conn: Client, config: ConnectConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.once('ready', () => resolve());
    conn.once('error', (err) => reject(err));
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

function promisifySftpStat(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, stats) => {
      if (err) {
        reject(err);
        return;
      }
      if (!stats.isDirectory()) {
        reject(new Error(`Remote path is not a directory: ${remotePath}`));
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
    const writeStream = sftp.createWriteStream(remotePath, { flags: 'w', mode: 0o644 });

    const cleanup = () => {
      source.destroy();
      writeStream.destroy();
    };

    const onAbort = () => {
      cleanup();
      reject(new Error('SFTP upload aborted'));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    source.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      cleanup();
      reject(err);
    });

    writeStream.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      cleanup();
      reject(err);
    });

    writeStream.on('close', () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    });

    source.pipe(writeStream);
  });
}

function classifyConnectionError(err: unknown): PlatformUploadError {
  const message = messageFromThrown(err);
  const lower = message.toLowerCase();

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

  return {
    code: 'SFTP_CONNECTION_FAILED',
    message: 'Failed to connect to the SFTP server.',
    statusCode: 500,
    details: message,
  };
}

/**
 * Validates SFTP credentials by opening a connection and checking the remote directory exists.
 * @param credentials - SFTP connection parameters (plaintext; not yet encrypted).
 * @returns Whether the test connection succeeded.
 */
export async function testSftpConnection(
  credentials: SftpCredentials
): Promise<
  { ok: true } | { ok: false; error: { code: string; message: string; details?: string } }
> {
  const conn = new Client();

  try {
    await promisifyConnect(conn, buildConnectConfig(credentials));
    const sftp = await promisifySftp(conn);
    await promisifySftpStat(sftp, credentials.remotePath);
    return { ok: true as const };
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
    await promisifyConnect(conn, buildConnectConfig(credentials));
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
