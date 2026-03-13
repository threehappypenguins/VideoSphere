// =============================================================================
// CONNECTED ACCOUNTS REPOSITORY
// =============================================================================
// All connected account (OAuth platform connections) data access goes through
// this module. API routes and Server Components should call these functions
// only — not the Appwrite SDK directly.
//
// Uses Appwrite Server SDK (Tables API) for the connected_accounts table.
// OAuth tokens are encrypted at rest (PRD NF-05) via lib/crypto/token-encryption.
// =============================================================================

import { ID, Query, TablesDB } from 'node-appwrite';
import type { ConnectedAccount, ConnectedAccountPlatform, ConnectedAccountPublic } from '@/types';
import appwriteClient from '@/lib/appwrite';
import { DATABASE_ID, CONNECTED_ACCOUNTS_COLLECTION_ID } from '@/lib/appwrite-constants';
import { decryptToken, encryptToken } from '@/lib/crypto/token-encryption';

const tablesDb = new TablesDB(appwriteClient);

/** Map row to full type (includes tokens). Use only for server-side token retrieval. */
function rowToConnectedAccount(row: Record<string, unknown>): ConnectedAccount {
  return {
    id: String(row.$id ?? row.id),
    userId: String(row.userId),
    platform: row.platform as ConnectedAccountPlatform,
    accessToken: String(row.accessToken),
    refreshToken: String(row.refreshToken),
    tokenExpiry: String(row.tokenExpiry),
    platformUserId: String(row.platformUserId),
    platformName: String(row.platformName),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

/** Map row to public type (no tokens). Safe for API responses and UI. */
function rowToConnectedAccountPublic(row: Record<string, unknown>): ConnectedAccountPublic {
  return {
    id: String(row.$id ?? row.id),
    userId: String(row.userId),
    platform: row.platform as ConnectedAccountPlatform,
    tokenExpiry: String(row.tokenExpiry),
    platformUserId: String(row.platformUserId),
    platformName: String(row.platformName),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export interface CreateConnectedAccountData {
  userId: string;
  platform: ConnectedAccountPlatform;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: string;
  platformUserId: string;
  platformName: string;
}

/**
 * Store a new connected account (OAuth tokens, platform user ID, platform name).
 * One connection per user per platform; use updateTokens if the user reconnects.
 * Returns public shape (no tokens) so callers never receive secrets.
 */
export async function createConnectedAccount(
  data: CreateConnectedAccountData
): Promise<ConnectedAccountPublic> {
  const now = new Date().toISOString();
  const row = await tablesDb.createRow({
    databaseId: DATABASE_ID,
    tableId: CONNECTED_ACCOUNTS_COLLECTION_ID,
    rowId: ID.unique(),
    data: {
      userId: data.userId,
      platform: data.platform,
      accessToken: encryptToken(data.accessToken),
      refreshToken: encryptToken(data.refreshToken),
      tokenExpiry: data.tokenExpiry,
      platformUserId: data.platformUserId,
      platformName: data.platformName,
      createdAt: now,
      updatedAt: now,
    },
  });
  return rowToConnectedAccountPublic(row as unknown as Record<string, unknown>);
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
  const { rows } = await tablesDb.listRows({
    databaseId: DATABASE_ID,
    tableId: CONNECTED_ACCOUNTS_COLLECTION_ID,
    queries: [Query.equal('userId', userId), Query.orderAsc('platform')],
    total: false,
  });
  return (rows ?? []).map((r) =>
    rowToConnectedAccountPublic(r as unknown as Record<string, unknown>)
  );
}

/**
 * Return a specific platform connection for a user (public shape, no tokens), or null if not found.
 * Safe for API responses and UI.
 */
export async function getConnectedAccount(
  userId: string,
  platform: ConnectedAccountPlatform
): Promise<ConnectedAccountPublic | null> {
  const { rows } = await tablesDb.listRows({
    databaseId: DATABASE_ID,
    tableId: CONNECTED_ACCOUNTS_COLLECTION_ID,
    queries: [Query.equal('userId', userId), Query.equal('platform', platform), Query.limit(1)],
    total: false,
  });
  if (rows.length === 0) return null;
  return rowToConnectedAccountPublic(rows[0] as unknown as Record<string, unknown>);
}

/**
 * Return a connected account with tokens. Use only when calling platform APIs (upload, refresh).
 * Do not use for API responses or client-bound data.
 */
export async function getConnectedAccountWithTokens(
  userId: string,
  platform: ConnectedAccountPlatform
): Promise<ConnectedAccount | null> {
  const { rows } = await tablesDb.listRows({
    databaseId: DATABASE_ID,
    tableId: CONNECTED_ACCOUNTS_COLLECTION_ID,
    queries: [Query.equal('userId', userId), Query.equal('platform', platform), Query.limit(1)],
    total: false,
  });
  if (rows.length === 0) return null;
  const row = rows[0] as unknown as Record<string, unknown>;
  const decrypted = {
    ...row,
    accessToken: decryptToken(String(row.accessToken)),
    refreshToken: decryptToken(String(row.refreshToken)),
  };
  return rowToConnectedAccount(decrypted);
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
  try {
    const row = await tablesDb.updateRow({
      databaseId: DATABASE_ID,
      tableId: CONNECTED_ACCOUNTS_COLLECTION_ID,
      rowId: id,
      data: {
        accessToken: encryptToken(accessToken),
        refreshToken: encryptToken(refreshToken),
        tokenExpiry,
        updatedAt: new Date().toISOString(),
      },
    });
    return rowToConnectedAccountPublic(row as unknown as Record<string, unknown>);
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e.code === 404) return null;
    throw err;
  }
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
  platformName: string
): Promise<ConnectedAccountPublic | null> {
  try {
    const row = await tablesDb.updateRow({
      databaseId: DATABASE_ID,
      tableId: CONNECTED_ACCOUNTS_COLLECTION_ID,
      rowId: id,
      data: {
        accessToken: encryptToken(accessToken),
        refreshToken: encryptToken(refreshToken),
        tokenExpiry,
        platformUserId,
        platformName,
        updatedAt: new Date().toISOString(),
      },
    });
    return rowToConnectedAccountPublic(row as unknown as Record<string, unknown>);
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e.code === 404) return null;
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Delete
// -----------------------------------------------------------------------------

/**
 * Remove a connected account and its stored tokens.
 */
export async function deleteConnectedAccount(id: string): Promise<void> {
  await tablesDb.deleteRow({
    databaseId: DATABASE_ID,
    tableId: CONNECTED_ACCOUNTS_COLLECTION_ID,
    rowId: id,
  });
}
