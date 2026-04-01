// =============================================================================
// USER REPOSITORY
// =============================================================================
// All user data access goes through this module. API routes and Server
// Components should call these functions only — not the Appwrite SDK directly.
//
// Uses Appwrite Server SDK (Tables API) for the user_profiles table.
// =============================================================================

import { Query, TablesDB } from 'node-appwrite';
import type { User, UserRole } from '@/types';
import appwriteClient from '@/lib/appwrite';
import { DATABASE_ID, USER_PROFILES_COLLECTION_ID } from '@/lib/appwrite-constants';
import { assertAppwriteRowTimestamps } from '@/lib/assert-appwrite-row-timestamps';

const tablesDb = new TablesDB(appwriteClient);

/** Map an Appwrite row to the shared User type. */
function rowToUser(row: Record<string, unknown>): User {
  const { $createdAt, $updatedAt } = assertAppwriteRowTimestamps(row);
  return {
    userId: String(row.userId ?? row.$id),
    email: String(row.email),
    isSupporter: Boolean(row.isSupporter),
    role: (row.role as UserRole) ?? 'user',
    hasCompletedOnboarding: Boolean(row.hasCompletedOnboarding),
    $createdAt,
    $updatedAt,
  };
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export interface CreateUserData {
  userId: string;
  email: string;
  isSupporter?: boolean;
  role?: UserRole;
}

/**
 * Create a user_profiles row. Row ID is data.userId.
 * Used by register and OAuth callback; callers must ensure the Auth user exists first.
 */
export async function createUser(data: CreateUserData): Promise<User> {
  const row = await tablesDb.createRow({
    databaseId: DATABASE_ID,
    tableId: USER_PROFILES_COLLECTION_ID,
    rowId: data.userId,
    data: {
      userId: data.userId,
      email: data.email.trim().toLowerCase(),
      isSupporter: data.isSupporter ?? false,
      role: data.role ?? 'user',
      hasCompletedOnboarding: false,
    },
  });
  return rowToUser(row as unknown as Record<string, unknown>);
}

// -----------------------------------------------------------------------------
// Read
// -----------------------------------------------------------------------------

/**
 * Fetch a user by Auth user `$id` from user_profiles.
 *
 * Primary path: row `$id` equals Auth id (`createUser` uses `rowId: data.userId`).
 * Fallback: `getRow` 404 then `listRows` by `userId` column (console-created or
 * imported rows where `$id` differs). Requires a unique `userId` index.
 */
export async function getUserById(userId: string): Promise<User | null> {
  try {
    const row = await tablesDb.getRow({
      databaseId: DATABASE_ID,
      tableId: USER_PROFILES_COLLECTION_ID,
      rowId: userId,
    });
    return rowToUser(row as unknown as Record<string, unknown>);
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e.code !== 404) throw err;
  }

  const { rows } = await tablesDb.listRows({
    databaseId: DATABASE_ID,
    tableId: USER_PROFILES_COLLECTION_ID,
    queries: [Query.equal('userId', userId), Query.limit(1)],
    total: false,
  });
  if (rows.length === 0) return null;
  return rowToUser(rows[0] as unknown as Record<string, unknown>);
}

/**
 * Fetch a user by email. Returns null if not found.
 * Requires an index on the email column for the user_profiles table.
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const { rows } = await tablesDb.listRows({
    databaseId: DATABASE_ID,
    tableId: USER_PROFILES_COLLECTION_ID,
    queries: [Query.equal('email', normalized), Query.limit(1)],
    total: false,
  });
  if (rows.length === 0) return null;
  return rowToUser(rows[0] as unknown as Record<string, unknown>);
}

// -----------------------------------------------------------------------------
// Update
// -----------------------------------------------------------------------------

export interface UpdateUserData {
  isSupporter?: boolean;
  role?: UserRole;
  hasCompletedOnboarding?: boolean;
}

/**
 * Update user_profiles fields (e.g. isSupporter, role). Only provided fields are updated.
 *
 * Mirrors getUserById's fallback: if updateRow 404s (console-created rows where
 * `$id !== userId`), resolves the actual row `$id` via listRows and retries.
 */
export async function updateUser(userId: string, data: UpdateUserData): Promise<User> {
  const payload: Record<string, unknown> = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined)
  );

  try {
    const row = await tablesDb.updateRow({
      databaseId: DATABASE_ID,
      tableId: USER_PROFILES_COLLECTION_ID,
      rowId: userId,
      data: payload,
    });
    return rowToUser(row as unknown as Record<string, unknown>);
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e.code !== 404) throw err;
  }

  // Primary row id differs from Auth id — resolve via userId column and retry.
  const { rows } = await tablesDb.listRows({
    databaseId: DATABASE_ID,
    tableId: USER_PROFILES_COLLECTION_ID,
    queries: [Query.equal('userId', userId), Query.limit(1)],
    total: false,
  });

  if (rows.length === 0) {
    const notFound = Object.assign(new Error('User profile not found'), { code: 404 });
    throw notFound;
  }

  const actualRowId = String((rows[0] as unknown as Record<string, unknown>).$id ?? userId);
  const updatedRow = await tablesDb.updateRow({
    databaseId: DATABASE_ID,
    tableId: USER_PROFILES_COLLECTION_ID,
    rowId: actualRowId,
    data: payload,
  });
  return rowToUser(updatedRow as unknown as Record<string, unknown>);
}

/**
 * Set whether the user is a supporter (e.g. after successful Stripe payment).
 * Used by the Stripe webhook (checkout.session.completed).
 */
export async function setSupporterStatus(userId: string, isSupporter: boolean): Promise<void> {
  await updateUser(userId, { isSupporter });
}

// -----------------------------------------------------------------------------
// List (admin)
// -----------------------------------------------------------------------------

export interface ListUsersOptions {
  limit?: number;
  offset?: number;
}

export interface ListUsersResult {
  users: User[];
  total: number;
}

/**
 * List users with pagination. For admin dashboard only; enforce admin role at call site.
 */
export async function listUsers(options: ListUsersOptions = {}): Promise<ListUsersResult> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const queries = [Query.limit(limit), Query.offset(offset), Query.orderAsc('$createdAt')];
  const result = await tablesDb.listRows({
    databaseId: DATABASE_ID,
    tableId: USER_PROFILES_COLLECTION_ID,
    queries,
    total: true,
  });
  const users = (result.rows ?? []).map((row) =>
    rowToUser(row as unknown as Record<string, unknown>)
  );
  return { users, total: result.total ?? 0 };
}

export interface UserCounts {
  totalUsers: number;
  totalSupporters: number;
}

/**
 * Return aggregate user counts for admin dashboard stats.
 */
export async function getUserCounts(): Promise<UserCounts> {
  const [allUsers, supporterUsers] = await Promise.all([
    tablesDb.listRows({
      databaseId: DATABASE_ID,
      tableId: USER_PROFILES_COLLECTION_ID,
      queries: [Query.limit(1)],
      total: true,
    }),
    tablesDb.listRows({
      databaseId: DATABASE_ID,
      tableId: USER_PROFILES_COLLECTION_ID,
      queries: [Query.equal('isSupporter', true), Query.limit(1)],
      total: true,
    }),
  ]);

  return {
    totalUsers: allUsers.total ?? 0,
    totalSupporters: supporterUsers.total ?? 0,
  };
}
