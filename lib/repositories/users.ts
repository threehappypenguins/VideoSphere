// =============================================================================
// USER REPOSITORY
// =============================================================================
// All user data access goes through this module. API routes and Server
// Components should call these functions only.
//
// Uses Mongoose for the user_profiles collection.
// =============================================================================

import type { User, UserRole } from '@/types';
import { revokeGoogleOAuthTokens } from '@/lib/auth/google-oauth';
import { decryptToken, encryptToken } from '@/lib/crypto/token-encryption';
import { connectToDatabase } from '@/lib/mongodb';
import {
  UserProfileModel,
  type UserAuthProvider,
  type UserProfileDocument,
} from '@/lib/models/UserProfile';

export type { UserAuthProvider };

/** Map a MongoDB document to the shared User type. */
function mongoDocToUser(doc: UserProfileDocument): User {
  return {
    userId: String(doc.userId ?? doc._id),
    email: String(doc.email),
    name: typeof doc.name === 'string' ? doc.name : undefined,
    hasCompletedOnboarding: Boolean(doc.hasCompletedOnboarding),
    role: (doc.role as UserRole) ?? 'user',
    $createdAt: new Date(doc.createdAt).toISOString(),
    $updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

/**
 * Defines the shape of create user data.
 */
export interface CreateUserData {
  userId: string;
  email: string;
  name?: string;
  passwordHash?: string;
  hasCompletedOnboarding?: boolean;
  role?: UserRole;
  authProvider?: UserAuthProvider;
  /** Plaintext Google login refresh token; encrypted before persistence. */
  googleRefreshToken?: string;
}

/**
 * Minimal user fields required for credential-based authentication.
 */
export interface UserAuthCredentials {
  userId: string;
  passwordHash: string;
  role: UserRole;
}

/**
 * Create a user_profiles document. Document ID is data.userId.
 * Used by register and OAuth callback; callers must ensure the Auth user exists first.
 * @param data - User profile fields to persist.
 * @returns The created user profile.
 */
export async function createUser(data: CreateUserData): Promise<User> {
  await connectToDatabase();
  const name = data.name?.trim();
  const googleRefreshToken = data.googleRefreshToken?.trim();
  const created = await UserProfileModel.create({
    _id: data.userId,
    userId: data.userId,
    email: data.email.trim().toLowerCase(),
    ...(name ? { name } : {}),
    ...(data.passwordHash ? { passwordHash: data.passwordHash } : {}),
    hasCompletedOnboarding: data.hasCompletedOnboarding ?? false,
    role: data.role ?? 'user',
    ...(data.authProvider ? { authProvider: data.authProvider } : {}),
    ...(googleRefreshToken ? { googleRefreshToken: encryptToken(googleRefreshToken) } : {}),
  });
  return mongoDocToUser(created.toObject());
}

// -----------------------------------------------------------------------------
// Read
// -----------------------------------------------------------------------------

/**
 * Fetch a user by Auth user id from user_profiles.
 *
 * Primary path: _id equals Auth id.
 * Fallback: query by userId field for migrated data where _id may differ.
 * @param userId - Auth user id to look up.
 * @returns The matching user profile, or null when not found.
 */
export async function getUserById(userId: string): Promise<User | null> {
  await connectToDatabase();

  const byId = await UserProfileModel.findById(userId).lean<UserProfileDocument | null>();
  if (byId) return mongoDocToUser(byId);

  const byUserId = await UserProfileModel.findOne({ userId }).lean<UserProfileDocument | null>();
  if (!byUserId) return null;
  return mongoDocToUser(byUserId);
}

/**
 * Fetch a user by email.
 * @param email - Email address to look up.
 * @returns The matching user profile, or null when not found.
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  await connectToDatabase();
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const doc = await UserProfileModel.findOne({
    email: normalized,
  }).lean<UserProfileDocument | null>();
  if (!doc) return null;
  return mongoDocToUser(doc);
}

/**
 * Fetch the fields needed for password login by email.
 * @param email - User email address to look up.
 * @returns The credential fields when present; otherwise null.
 */
export async function getUserAuthCredentialsByEmail(
  email: string
): Promise<UserAuthCredentials | null> {
  await connectToDatabase();
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const doc = await UserProfileModel.findOne({ email: normalized })
    .select({ _id: 1, userId: 1, passwordHash: 1, role: 1 })
    .lean<UserProfileDocument | null>();
  if (!doc || typeof doc.passwordHash !== 'string' || doc.passwordHash.length === 0) {
    return null;
  }

  return {
    userId: String(doc.userId ?? doc._id),
    passwordHash: doc.passwordHash,
    role: (doc.role as UserRole) ?? 'user',
  };
}

// -----------------------------------------------------------------------------
// Update
// -----------------------------------------------------------------------------

/**
 * Defines the shape of update user data.
 */
export interface UpdateUserData {
  hasCompletedOnboarding?: boolean;
  role?: UserRole;
}

/**
 * Update user_profiles fields. Only provided fields are updated.
 *
 * Mirrors getUserById's fallback: if _id lookup misses, resolves by userId and retries.
 * @param userId - Auth user id to update.
 * @param data - Partial profile fields to apply.
 * @returns The updated user profile.
 * @throws Error with `code` 404 when no matching profile exists.
 */
export async function updateUser(userId: string, data: UpdateUserData): Promise<User> {
  await connectToDatabase();

  const payload: Partial<Pick<UserProfileDocument, 'hasCompletedOnboarding' | 'role'>> =
    Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));

  const byId = await UserProfileModel.findByIdAndUpdate(userId, payload, {
    returnDocument: 'after',
    runValidators: true,
  }).lean<UserProfileDocument | null>();
  if (byId) return mongoDocToUser(byId);

  const byUserId = await UserProfileModel.findOneAndUpdate({ userId }, payload, {
    returnDocument: 'after',
    runValidators: true,
  }).lean<UserProfileDocument | null>();

  if (!byUserId) {
    const notFound = Object.assign(new Error('User profile not found'), { code: 404 });
    throw notFound;
  }

  return mongoDocToUser(byUserId);
}

// -----------------------------------------------------------------------------
// List (admin)
// -----------------------------------------------------------------------------

/**
 * Defines the shape of list users options.
 */
export interface ListUsersOptions {
  limit?: number;
  offset?: number;
}

/**
 * Defines the shape of list users result.
 */
export interface ListUsersResult {
  users: User[];
  total: number;
}

/**
 * List users with pagination. For admin dashboard only; enforce admin role at call site.
 * @param options - Pagination limit and offset.
 * @returns A page of users and the total profile count.
 */
export async function listUsers(options: ListUsersOptions = {}): Promise<ListUsersResult> {
  await connectToDatabase();

  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  const [docs, total] = await Promise.all([
    UserProfileModel.find({})
      .sort({ createdAt: 1 })
      .skip(offset)
      .limit(limit)
      .lean<UserProfileDocument[]>(),
    UserProfileModel.countDocuments({}),
  ]);

  return {
    users: docs.map(mongoDocToUser),
    total,
  };
}

/**
 * Defines the shape of user counts.
 */
export interface UserCounts {
  totalUsers: number;
}

/**
 * Return aggregate user counts for admin dashboard stats.
 * @returns Total number of user profiles.
 */
export async function getUserCounts(): Promise<UserCounts> {
  await connectToDatabase();

  const totalUsers = await UserProfileModel.countDocuments({});

  return {
    totalUsers,
  };
}

/**
 * Counts users with a specific role.
 * @param role - Role to count.
 * @returns Number of matching user profiles.
 */
export async function countUsersWithRole(role: UserRole): Promise<number> {
  await connectToDatabase();
  return UserProfileModel.countDocuments({ role });
}

/**
 * Records Google OAuth login on an existing profile and stores a refresh token when provided.
 * @param userId - Auth user id.
 * @param refreshToken - Google refresh token from the login token exchange, if any.
 * @returns Resolves when the profile update completes.
 */
export async function persistGoogleAuthForUser(
  userId: string,
  refreshToken?: string
): Promise<void> {
  await connectToDatabase();

  const payload: Partial<Pick<UserProfileDocument, 'authProvider' | 'googleRefreshToken'>> = {
    authProvider: 'google',
  };
  const trimmedRefresh = refreshToken?.trim();
  if (trimmedRefresh) {
    payload.googleRefreshToken = encryptToken(trimmedRefresh);
  }

  const byId = await UserProfileModel.findByIdAndUpdate(userId, payload).lean();
  if (byId) return;

  await UserProfileModel.findOneAndUpdate({ userId }, payload);
}

/**
 * Revokes stored Google login tokens so the app is removed from the user's Google account access list.
 * Best-effort: silently no-ops when no refresh token is stored; logs decryption/revoke failures.
 * @param userId - Auth user id.
 * @returns Resolves when the revoke attempt finishes (including no-op cases).
 */
export async function revokeStoredGoogleAuthForUser(userId: string): Promise<void> {
  await connectToDatabase();

  let doc =
    (await UserProfileModel.findById(userId)
      .select({ authProvider: 1, googleRefreshToken: 1 })
      .lean<Pick<UserProfileDocument, 'authProvider' | 'googleRefreshToken'> | null>()) ?? null;

  if (!doc) {
    doc = await UserProfileModel.findOne({ userId })
      .select({ authProvider: 1, googleRefreshToken: 1 })
      .lean<Pick<UserProfileDocument, 'authProvider' | 'googleRefreshToken'> | null>();
  }

  if (doc?.authProvider !== 'google') return;

  const encrypted = doc.googleRefreshToken?.trim();
  if (!encrypted) return;

  try {
    const refreshToken = decryptToken(encrypted);
    await revokeGoogleOAuthTokens({ refreshToken });
  } catch (error) {
    console.warn(
      `[revokeStoredGoogleAuthForUser] Failed to revoke Google auth for ${userId}`,
      error
    );
  }
}

/**
 * Deletes a user profile by id.
 * @param userId - Auth user id to delete.
 * @returns True when a profile was removed.
 */
export async function deleteUserById(userId: string): Promise<boolean> {
  await connectToDatabase();

  const byId = await UserProfileModel.deleteOne({ _id: userId });
  if (byId.deletedCount > 0) return true;

  const byUserId = await UserProfileModel.deleteOne({ userId });
  return byUserId.deletedCount > 0;
}
