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
import { decryptToken, encryptToken } from '@/lib/crypto/token-encryption';

/** Map row to full type (includes tokens). Use only for server-side token retrieval. */
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
    platformUserId: String(doc.platformUserId),
    platformName: String(doc.platformName),
    ...(doc.sftpHost != null ? { sftpHost: String(doc.sftpHost) } : {}),
    ...(doc.sftpPort != null ? { sftpPort: Number(doc.sftpPort) } : {}),
    ...(doc.sftpRemotePath != null ? { sftpRemotePath: String(doc.sftpRemotePath) } : {}),
    ...(doc.sftpAuthMethod != null ? { sftpAuthMethod: doc.sftpAuthMethod as SftpAuthMethod } : {}),
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
    platformUserId: String(doc.platformUserId),
    platformName: String(doc.platformName),
    ...(doc.sftpHost != null ? { sftpHost: String(doc.sftpHost) } : {}),
    ...(doc.sftpPort != null ? { sftpPort: Number(doc.sftpPort) } : {}),
    ...(doc.sftpRemotePath != null ? { sftpRemotePath: String(doc.sftpRemotePath) } : {}),
    ...(doc.sftpAuthMethod != null
      ? { sftpAuthMethod: doc.sftpAuthMethod as SftpAuthMethod }
      : {}),
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
  const decrypted: ConnectedAccountDocument = {
    ...doc,
    accessToken: decryptToken(String(doc.accessToken)),
    refreshToken: decryptToken(String(doc.refreshToken)),
  };
  return rowToConnectedAccount(decrypted);
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
 * Returns public shape (no tokens) so callers never receive secrets.
 */
export async function updateTokens(
  id: string,
  accessToken: string,
  refreshToken: string,
  tokenExpiry: string
): Promise<ConnectedAccountPublic | null> {
  await connectToDatabase();
  const updated = await ConnectedAccountModel.findByIdAndUpdate(
    id,
    {
      accessToken: encryptToken(accessToken),
      refreshToken: encryptToken(refreshToken),
      tokenExpiry,
    },
    { returnDocument: 'after', runValidators: true }
  ).lean<ConnectedAccountDocument | null>();

  if (!updated) return null;
  return rowToConnectedAccountPublic(updated);
}

/**
 * Update tokens and platform metadata (name, userId) for an existing connection.
 * Use this on reconnection so the stored channel name/id stays current.
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
  }
): Promise<ConnectedAccountPublic | null> {
  await connectToDatabase();
  const updated = await ConnectedAccountModel.findByIdAndUpdate(
    id,
    {
      accessToken: encryptToken(accessToken),
      refreshToken: encryptToken(refreshToken),
      tokenExpiry,
      platformUserId,
      platformName,
      ...(sftpFields
        ? {
            sftpHost: sftpFields.sftpHost,
            sftpPort: sftpFields.sftpPort,
            sftpRemotePath: sftpFields.sftpRemotePath,
            sftpAuthMethod: sftpFields.sftpAuthMethod,
          }
        : {}),
    },
    { returnDocument: 'after', runValidators: true }
  ).lean<ConnectedAccountDocument | null>();

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
