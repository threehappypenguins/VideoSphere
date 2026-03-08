// =============================================================================
// CONNECTED ACCOUNTS REPOSITORY
// =============================================================================
// All connected account (OAuth platform connections) data access goes through
// this module. API routes and Server Components should call these functions
// only — not the Appwrite SDK directly.
//
// Uses Appwrite Server SDK (Tables API) for the connected_accounts table.
// =============================================================================

import { ID, Query, TablesDB } from 'node-appwrite';
import type { ConnectedAccount, ConnectedAccountPlatform } from '@/types';
import appwriteClient from '@/lib/appwrite';
import { DATABASE_ID, CONNECTED_ACCOUNTS_COLLECTION_ID } from '@/lib/appwrite-constants';

const tablesDb = new TablesDB(appwriteClient);

/** Map an Appwrite row to the shared ConnectedAccount type. */
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
 */
export async function createConnectedAccount(
  data: CreateConnectedAccountData
): Promise<ConnectedAccount> {
  const now = new Date().toISOString();
  const row = await tablesDb.createRow({
    databaseId: DATABASE_ID,
    tableId: CONNECTED_ACCOUNTS_COLLECTION_ID,
    rowId: ID.unique(),
    data: {
      userId: data.userId,
      platform: data.platform,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      tokenExpiry: data.tokenExpiry,
      platformUserId: data.platformUserId,
      platformName: data.platformName,
      createdAt: now,
      updatedAt: now,
    },
  });
  return rowToConnectedAccount(row as unknown as Record<string, unknown>);
}

// -----------------------------------------------------------------------------
// Read
// -----------------------------------------------------------------------------

/**
 * Return all connected accounts for a user.
 */
export async function getConnectedAccountsByUser(userId: string): Promise<ConnectedAccount[]> {
  const { rows } = await tablesDb.listRows({
    databaseId: DATABASE_ID,
    tableId: CONNECTED_ACCOUNTS_COLLECTION_ID,
    queries: [Query.equal('userId', userId), Query.orderAsc('platform')],
    total: false,
  });
  return (rows ?? []).map((r) => rowToConnectedAccount(r as unknown as Record<string, unknown>));
}

/**
 * Return a specific platform connection for a user, or null if not found.
 */
export async function getConnectedAccount(
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
  return rowToConnectedAccount(rows[0] as unknown as Record<string, unknown>);
}

// -----------------------------------------------------------------------------
// Update (tokens only)
// -----------------------------------------------------------------------------

/**
 * Refresh stored OAuth tokens for a connected account.
 */
export async function updateTokens(
  id: string,
  accessToken: string,
  refreshToken: string,
  tokenExpiry: string
): Promise<ConnectedAccount | null> {
  try {
    const row = await tablesDb.updateRow({
      databaseId: DATABASE_ID,
      tableId: CONNECTED_ACCOUNTS_COLLECTION_ID,
      rowId: id,
      data: {
        accessToken,
        refreshToken,
        tokenExpiry,
        updatedAt: new Date().toISOString(),
      },
    });
    return rowToConnectedAccount(row as unknown as Record<string, unknown>);
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
