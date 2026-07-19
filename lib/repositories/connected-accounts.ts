// =============================================================================
// CONNECTED ACCOUNTS REPOSITORY
// =============================================================================
// All connected account (OAuth platform connections) data access goes through
// this module. API routes and Server Components should call these functions
// only.
//
// Uses Mongoose for the connected_accounts collection.
// OAuth tokens are encrypted at rest (PRD NF-05) via lib/crypto/token-encryption.
// =============================================================================

import { randomUUID } from 'crypto';
import type {
  ConnectedAccount,
  ConnectedAccountPlatform,
  ConnectedAccountPublic,
  SftpAuthMethod,
} from '@/types';
import { connectToDatabase } from '@/lib/mongodb';
import {
  ConnectedAccountModel,
  type ConnectedAccountDocument,
} from '@/lib/models/ConnectedAccount';
import { decryptToken, encryptToken, isTokenDecryptError } from '@/lib/crypto/token-encryption';

/** Map row to full type (includes tokens). Use only for server-side token retrieval. */
function hasStoredEncryptedField(value: string | undefined): boolean {
  return String(value ?? '').trim().length > 0;
}

/**
 * Decrypts a stored ciphertext field when present; returns undefined when empty or undecryptable.
 * @param ciphertext - Encrypted value from MongoDB.
 * @param fieldLabel - Field name for log messages.
 * @param rowId - Connected account row id.
 * @param platform - Connected account platform.
 * @returns Decrypted plaintext, or undefined when absent or decryption fails.
 */
function tryDecryptStoredTokenField(
  ciphertext: string | undefined,
  fieldLabel: string,
  rowId: string,
  platform: string
): string | undefined {
  const raw = String(ciphertext ?? '').trim();
  if (!raw) return undefined;
  try {
    return decryptToken(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isTokenDecryptError(error)) {
      console.warn(
        `[connected-accounts] Could not decrypt ${fieldLabel} for row ${rowId} (${platform}); treating as unavailable:`,
        message
      );
      return undefined;
    }
    throw error;
  }
}

/**
 * Decrypts a stored OAuth access or refresh token ciphertext.
 * Empty/undefined ciphertext returns `''` for either field (no decrypt attempt).
 * On `TokenDecryptError`, refresh tokens are treated as cleared (`''`) so callers
 * can prompt reconnect; access-token decrypt failures still throw.
 * @param ciphertext - Encrypted value from MongoDB (or `''` when cleared).
 * @param fieldLabel - Which token field is being read (affects decrypt-error handling).
 * @param rowId - Connected account row id.
 * @param platform - Connected account platform.
 * @returns Decrypted plaintext, or `''` when ciphertext is empty/undefined, or when
 *   a refresh token fails to decrypt.
 */
function decryptStoredOAuthTokenField(
  ciphertext: string | undefined,
  fieldLabel: 'accessToken' | 'refreshToken',
  rowId: string,
  platform: string
): string {
  const raw = String(ciphertext ?? '').trim();
  if (!raw) return '';
  try {
    return decryptToken(raw);
  } catch (error) {
    if (fieldLabel === 'refreshToken' && isTokenDecryptError(error)) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[connected-accounts] Could not decrypt ${fieldLabel} for row ${rowId} (${platform}); treating as cleared:`,
        message
      );
      return '';
    }
    throw error;
  }
}

function rowToConnectedAccount(doc: ConnectedAccountDocument): ConnectedAccount {
  const refresh = String(doc.refreshToken ?? '');
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    platform: doc.platform as ConnectedAccountPlatform,
    accessToken: String(doc.accessToken),
    refreshToken: refresh,
    tokenExpiry: String(doc.tokenExpiry),
    hasRefreshToken: refresh.trim().length > 0,
    hasYoutubeMainStreamKey: hasStoredEncryptedField(doc.youtubeMainStreamKey),
    hasYoutubeTempStreamKey: hasStoredEncryptedField(doc.youtubeTempStreamKey),
    platformUserId: String(doc.platformUserId),
    platformName: String(doc.platformName),
    ...(doc.sftpHost != null ? { sftpHost: String(doc.sftpHost) } : {}),
    ...(doc.sftpPort != null ? { sftpPort: Number(doc.sftpPort) } : {}),
    ...(doc.sftpRemotePath != null ? { sftpRemotePath: String(doc.sftpRemotePath) } : {}),
    ...(doc.sftpAuthMethod != null ? { sftpAuthMethod: doc.sftpAuthMethod as SftpAuthMethod } : {}),
    ...(doc.sftpHostKeyFingerprint != null
      ? { sftpHostKeyFingerprint: String(doc.sftpHostKeyFingerprint) }
      : {}),
    ...(doc.smbHost != null ? { smbHost: String(doc.smbHost) } : {}),
    ...(doc.smbShare != null ? { smbShare: String(doc.smbShare) } : {}),
    ...(doc.smbDomain != null ? { smbDomain: String(doc.smbDomain) } : {}),
    ...(doc.smbRemotePath != null ? { smbRemotePath: String(doc.smbRemotePath) } : {}),
    ...(doc.googleDriveBackupFolderPath != null
      ? { googleDriveBackupFolderPath: String(doc.googleDriveBackupFolderPath) }
      : {}),
    ...(doc.facebookTargetType != null
      ? { facebookTargetType: doc.facebookTargetType as 'page' | 'profile' }
      : {}),
    ...(doc.facebookPageId != null ? { facebookPageId: String(doc.facebookPageId) } : {}),
    $createdAt: new Date(doc.createdAt).toISOString(),
    $updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

function hasRefreshTokenFromStoredRow(doc: ConnectedAccountDocument): boolean {
  const raw = String(doc.refreshToken ?? '').trim();
  if (!raw) return false;
  try {
    return decryptToken(raw).length > 0;
  } catch (error) {
    const rowId = String(doc._id ?? 'unknown');
    const platform = String(doc.platform ?? 'unknown');
    if (isTokenDecryptError(error)) {
      // Cleared grants use plaintext ''; corrupt/short values are treated as absent.
      return false;
    }
    console.error(
      `[connected-accounts] Failed to decrypt refreshToken for row ${rowId} (${platform})`,
      error
    );
    return false;
  }
}

/** Map row to public type (no tokens). Safe for API responses and UI. */
function rowToConnectedAccountPublic(doc: ConnectedAccountDocument): ConnectedAccountPublic {
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    platform: doc.platform as ConnectedAccountPlatform,
    tokenExpiry: String(doc.tokenExpiry),
    hasRefreshToken: hasRefreshTokenFromStoredRow(doc),
    hasYoutubeMainStreamKey: hasStoredEncryptedField(doc.youtubeMainStreamKey),
    hasYoutubeTempStreamKey: hasStoredEncryptedField(doc.youtubeTempStreamKey),
    platformUserId: String(doc.platformUserId),
    platformName: String(doc.platformName),
    ...(doc.sftpHost != null ? { sftpHost: String(doc.sftpHost) } : {}),
    ...(doc.sftpPort != null ? { sftpPort: Number(doc.sftpPort) } : {}),
    ...(doc.sftpRemotePath != null ? { sftpRemotePath: String(doc.sftpRemotePath) } : {}),
    ...(doc.sftpAuthMethod != null ? { sftpAuthMethod: doc.sftpAuthMethod as SftpAuthMethod } : {}),
    ...(doc.sftpHostKeyFingerprint != null
      ? { sftpHostKeyFingerprint: String(doc.sftpHostKeyFingerprint) }
      : {}),
    ...(doc.smbHost != null ? { smbHost: String(doc.smbHost) } : {}),
    ...(doc.smbShare != null ? { smbShare: String(doc.smbShare) } : {}),
    ...(doc.smbDomain != null ? { smbDomain: String(doc.smbDomain) } : {}),
    ...(doc.smbRemotePath != null ? { smbRemotePath: String(doc.smbRemotePath) } : {}),
    ...(doc.googleDriveBackupFolderPath != null
      ? { googleDriveBackupFolderPath: String(doc.googleDriveBackupFolderPath) }
      : {}),
    ...(doc.facebookTargetType != null
      ? { facebookTargetType: doc.facebookTargetType as 'page' | 'profile' }
      : {}),
    ...(doc.facebookPageId != null ? { facebookPageId: String(doc.facebookPageId) } : {}),
    $createdAt: new Date(doc.createdAt).toISOString(),
    $updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

/**
 * Defines the shape of create connected account data.
 */
export interface CreateConnectedAccountData {
  userId: string;
  platform: ConnectedAccountPlatform;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: string;
  platformUserId: string;
  platformName: string;
  sftpHost?: string;
  sftpPort?: number;
  sftpRemotePath?: string;
  sftpAuthMethod?: SftpAuthMethod;
  sftpHostKeyFingerprint?: string;
  smbHost?: string;
  smbShare?: string;
  smbDomain?: string;
  smbRemotePath?: string;
  googleDriveBackupFolderPath?: string;
  facebookTargetType?: 'page' | 'profile';
  facebookPageId?: string;
}

/**
 * Store a new connected account (OAuth tokens, platform user ID, platform name).
 * One connection per user per platform; use updateTokens if the user reconnects.
 * Returns public shape (no tokens) so callers never receive secrets.
 */
export async function createConnectedAccount(
  data: CreateConnectedAccountData
): Promise<ConnectedAccountPublic> {
  await connectToDatabase();
  const created = await ConnectedAccountModel.create({
    _id: randomUUID(),
    userId: data.userId,
    platform: data.platform,
    accessToken: encryptToken(data.accessToken),
    refreshToken: encryptToken(data.refreshToken),
    tokenExpiry: data.tokenExpiry,
    platformUserId: data.platformUserId,
    platformName: data.platformName,
    ...(data.sftpHost != null ? { sftpHost: data.sftpHost } : {}),
    ...(data.sftpPort != null ? { sftpPort: data.sftpPort } : {}),
    ...(data.sftpRemotePath != null ? { sftpRemotePath: data.sftpRemotePath } : {}),
    ...(data.sftpAuthMethod != null ? { sftpAuthMethod: data.sftpAuthMethod } : {}),
    ...(data.sftpHostKeyFingerprint != null
      ? { sftpHostKeyFingerprint: data.sftpHostKeyFingerprint }
      : {}),
    ...(data.smbHost != null ? { smbHost: data.smbHost } : {}),
    ...(data.smbShare != null ? { smbShare: data.smbShare } : {}),
    ...(data.smbDomain != null ? { smbDomain: data.smbDomain } : {}),
    ...(data.smbRemotePath != null ? { smbRemotePath: data.smbRemotePath } : {}),
    ...(data.googleDriveBackupFolderPath != null
      ? { googleDriveBackupFolderPath: data.googleDriveBackupFolderPath }
      : {}),
    ...(data.facebookTargetType != null ? { facebookTargetType: data.facebookTargetType } : {}),
    ...(data.facebookPageId != null ? { facebookPageId: data.facebookPageId } : {}),
  });
  return rowToConnectedAccountPublic(created.toObject());
}

// -----------------------------------------------------------------------------
// Read
// -----------------------------------------------------------------------------

/**
 * Return all connected accounts for a user (public shape, no tokens).
 * Safe for GET /api/platforms/connections and UI.
 */
export async function getConnectedAccountsByUser(
  userId: string
): Promise<ConnectedAccountPublic[]> {
  await connectToDatabase();
  const docs = await ConnectedAccountModel.find({ userId })
    .sort({ platform: 1 })
    .lean<ConnectedAccountDocument[]>();
  return docs.map(rowToConnectedAccountPublic);
}

/**
 * Return a specific platform connection for a user (public shape, no tokens), or null if not found.
 * Safe for API responses and UI.
 */
export async function getConnectedAccount(
  userId: string,
  platform: ConnectedAccountPlatform
): Promise<ConnectedAccountPublic | null> {
  await connectToDatabase();
  const doc = await ConnectedAccountModel.findOne({
    userId,
    platform,
  }).lean<ConnectedAccountDocument | null>();
  if (!doc) return null;
  return rowToConnectedAccountPublic(doc);
}

/**
 * Return only the row ID and platformUserId for a specific platform connection, without attempting to decrypt tokens.
 * Use when you already know token decryption will fail (e.g., legacy rows with old encryption key).
 * This avoids noisy error logs during intentional decrypt-failure fallback paths.
 * Returns { id, platformUserId } so callers can preserve existing metadata on reconnect.
 */
export async function getConnectedAccountRowId(
  userId: string,
  platform: ConnectedAccountPlatform
): Promise<{ id: string; platformUserId: string } | null> {
  await connectToDatabase();
  const doc = await ConnectedAccountModel.findOne({ userId, platform })
    .select({ _id: 1, platformUserId: 1 })
    .lean<ConnectedAccountDocument | null>();

  if (!doc) return null;
  return {
    id: String(doc._id),
    platformUserId: String(doc.platformUserId ?? ''),
  };
}

/**
 * Return a connected account with tokens. Use only when calling platform APIs (upload, refresh).
 * Do not use for API responses or client-bound data.
 */
export async function getConnectedAccountWithTokens(
  userId: string,
  platform: ConnectedAccountPlatform
): Promise<ConnectedAccount | null> {
  await connectToDatabase();
  const doc = await ConnectedAccountModel.findOne({
    userId,
    platform,
  }).lean<ConnectedAccountDocument | null>();
  if (!doc) return null;
  const rowId = String(doc._id);
  const platformLabel = String(doc.platform);
  const decrypted: ConnectedAccountDocument = {
    ...doc,
    accessToken: decryptStoredOAuthTokenField(doc.accessToken, 'accessToken', rowId, platformLabel),
    refreshToken: decryptStoredOAuthTokenField(
      doc.refreshToken,
      'refreshToken',
      rowId,
      platformLabel
    ),
  };
  const account = rowToConnectedAccount(decrypted);
  const youtubeMainStreamKey = tryDecryptStoredTokenField(
    doc.youtubeMainStreamKey,
    'youtubeMainStreamKey',
    rowId,
    platformLabel
  );
  const youtubeTempStreamKey = tryDecryptStoredTokenField(
    doc.youtubeTempStreamKey,
    'youtubeTempStreamKey',
    rowId,
    platformLabel
  );
  return {
    ...account,
    ...(youtubeMainStreamKey != null ? { youtubeMainStreamKey } : {}),
    ...(youtubeTempStreamKey != null ? { youtubeTempStreamKey } : {}),
  };
}

/**
 * Fetch a single connected account by its row ID, returning it only when it
 * belongs to the given user. Constant-time (primary-key lookup) and
 * IDOR-safe: returns null if the row doesn't exist or belongs to another user.
 */
export async function getConnectedAccountForUser(
  id: string,
  userId: string
): Promise<ConnectedAccountPublic | null> {
  await connectToDatabase();
  const doc = await ConnectedAccountModel.findById(id).lean<ConnectedAccountDocument | null>();
  if (!doc) return null;
  const account = rowToConnectedAccountPublic(doc);
  return account.userId === userId ? account : null;
}

// -----------------------------------------------------------------------------
// Update (tokens only)
// -----------------------------------------------------------------------------

/**
 * Refresh stored OAuth tokens for a connected account.
 * When `refreshToken` is empty, the existing stored refresh token is left unchanged
 * so a missing/empty provider value cannot wipe a still-valid grant.
 * Returns public shape (no tokens) so callers never receive secrets.
 * @param id - Connected account row id.
 * @param accessToken - New access token plaintext.
 * @param refreshToken - New refresh token plaintext, or empty to preserve the stored one.
 * @param tokenExpiry - ISO expiry for the new access token.
 * @returns Updated public account row, or null when the row no longer exists.
 */
export async function updateTokens(
  id: string,
  accessToken: string,
  refreshToken: string,
  tokenExpiry: string
): Promise<ConnectedAccountPublic | null> {
  await connectToDatabase();
  const trimmedRefresh = refreshToken.trim();
  const updated = await ConnectedAccountModel.findByIdAndUpdate(
    id,
    {
      accessToken: encryptToken(accessToken),
      ...(trimmedRefresh ? { refreshToken: encryptToken(trimmedRefresh) } : {}),
      tokenExpiry,
    },
    { returnDocument: 'after', runValidators: true }
  ).lean<ConnectedAccountDocument | null>();

  if (!updated) return null;
  return rowToConnectedAccountPublic(updated);
}

/**
 * Clears a stored OAuth refresh token after the provider reports the grant is invalid.
 * Stores plaintext `''` (not ciphertext) so `hasRefreshToken` is false; readers must
 * treat empty refresh ciphertext as cleared and must not call `decryptToken` on it.
 * The row is kept so the UI can prompt the user to reconnect.
 * @param id - Connected account row id.
 * @returns Updated public account row, or null when the row no longer exists.
 */
export async function clearOAuthRefreshToken(id: string): Promise<ConnectedAccountPublic | null> {
  await connectToDatabase();
  const updated = await ConnectedAccountModel.findByIdAndUpdate(
    id,
    { refreshToken: '' },
    { returnDocument: 'after', runValidators: true }
  ).lean<ConnectedAccountDocument | null>();

  if (!updated) return null;
  return rowToConnectedAccountPublic(updated);
}

/**
 * Update tokens and platform metadata (name, userId) for an existing connection.
 * Use this on reconnection so the stored channel name/id stays current.
 * When `refreshToken` is empty, the existing stored refresh token is left unchanged.
 * Returns public shape (no tokens) so callers never receive secrets.
 */
export async function updateConnection(
  id: string,
  accessToken: string,
  refreshToken: string,
  tokenExpiry: string,
  platformUserId: string,
  platformName: string,
  sftpFields?: {
    sftpHost: string;
    sftpPort: number;
    sftpRemotePath: string;
    sftpAuthMethod: SftpAuthMethod;
    sftpHostKeyFingerprint: string;
  },
  smbFields?: {
    smbHost: string;
    smbShare: string;
    smbDomain?: string;
    smbRemotePath: string;
  },
  facebookFields?: {
    facebookTargetType: 'page' | 'profile';
    facebookPageId?: string;
  }
): Promise<ConnectedAccountPublic | null> {
  await connectToDatabase();
  const facebookUpdate =
    facebookFields != null
      ? {
          facebookTargetType: facebookFields.facebookTargetType,
          facebookPageId: facebookFields.facebookPageId ?? null,
        }
      : {};
  const trimmedRefresh = refreshToken.trim();
  const updated = await ConnectedAccountModel.findByIdAndUpdate(
    id,
    {
      accessToken: encryptToken(accessToken),
      ...(trimmedRefresh ? { refreshToken: encryptToken(trimmedRefresh) } : {}),
      tokenExpiry,
      platformUserId,
      platformName,
      ...(sftpFields
        ? {
            sftpHost: sftpFields.sftpHost,
            sftpPort: sftpFields.sftpPort,
            sftpRemotePath: sftpFields.sftpRemotePath,
            sftpAuthMethod: sftpFields.sftpAuthMethod,
            sftpHostKeyFingerprint: sftpFields.sftpHostKeyFingerprint,
          }
        : {}),
      ...(smbFields
        ? {
            smbHost: smbFields.smbHost,
            smbShare: smbFields.smbShare,
            ...(smbFields.smbDomain != null && smbFields.smbDomain !== ''
              ? { smbDomain: smbFields.smbDomain }
              : { smbDomain: '' }),
            smbRemotePath: smbFields.smbRemotePath,
          }
        : {}),
      ...facebookUpdate,
    },
    { returnDocument: 'after', runValidators: true }
  ).lean<ConnectedAccountDocument | null>();

  if (!updated) return null;
  return rowToConnectedAccountPublic(updated);
}

/**
 * Updates the configured Google Drive backup folder path and resolved folder id metadata.
 * @param id - Connected account row id.
 * @param backupFolderPath - User-facing folder path within My Drive (`''` or `/` for root).
 * @param platformUserId - Serialized platform user metadata including optional `rootFolderId`.
 * @returns Updated public account row, or null when the row does not exist.
 */
export async function updateGoogleDriveBackupFolder(
  id: string,
  backupFolderPath: string,
  platformUserId: string
): Promise<ConnectedAccountPublic | null> {
  await connectToDatabase();
  const updated = await ConnectedAccountModel.findByIdAndUpdate(
    id,
    {
      googleDriveBackupFolderPath: backupFolderPath,
      platformUserId,
    },
    { returnDocument: 'after', runValidators: true }
  ).lean<ConnectedAccountDocument | null>();

  if (!updated) return null;
  return rowToConnectedAccountPublic(updated);
}

/**
 * Updates encrypted YouTube stream keys on the user's existing YouTube connection.
 * @param userId - VideoSphere user id.
 * @param fields - Plaintext keys to store; omit a field to leave the stored value unchanged, or pass `''` to clear it.
 * @returns Updated public account row, or null when no YouTube connection exists.
 */
export async function updateYouTubeStreamKeys(
  userId: string,
  fields: { mainStreamKey?: string; tempStreamKey?: string }
): Promise<ConnectedAccountPublic | null> {
  await connectToDatabase();
  const existing = await ConnectedAccountModel.findOne({
    userId,
    platform: 'youtube',
  }).lean<ConnectedAccountDocument | null>();
  if (!existing) return null;

  const update: Partial<
    Pick<ConnectedAccountDocument, 'youtubeMainStreamKey' | 'youtubeTempStreamKey'>
  > = {};

  if (fields.mainStreamKey !== undefined) {
    update.youtubeMainStreamKey =
      fields.mainStreamKey === '' ? '' : encryptToken(fields.mainStreamKey);
  }
  if (fields.tempStreamKey !== undefined) {
    update.youtubeTempStreamKey =
      fields.tempStreamKey === '' ? '' : encryptToken(fields.tempStreamKey);
  }

  if (Object.keys(update).length === 0) {
    return rowToConnectedAccountPublic(existing);
  }

  const updated = await ConnectedAccountModel.findByIdAndUpdate(existing._id, update, {
    returnDocument: 'after',
    runValidators: true,
  }).lean<ConnectedAccountDocument | null>();

  if (!updated) return null;
  return rowToConnectedAccountPublic(updated);
}

// -----------------------------------------------------------------------------
// Delete
// -----------------------------------------------------------------------------

/**
 * Remove a connected account and its stored tokens.
 */
export async function deleteConnectedAccount(id: string): Promise<void> {
  await connectToDatabase();
  await ConnectedAccountModel.deleteOne({ _id: id });
}
