// =============================================================================
// USER REPOSITORY
// =============================================================================
// All user data access goes through this module. API routes and Server
// Components should call these functions only.
//
// Uses Mongoose for the user_profiles collection.
// =============================================================================

import type { User, UserRole } from '@/types';
import { userSupportsPasswordReset } from '@/lib/auth/password';
import { revokeGoogleOAuthTokens } from '@/lib/auth/google-oauth';
import { decryptToken, encryptToken } from '@/lib/crypto/token-encryption';
import { connectToDatabase } from '@/lib/mongodb';
import {
  UserProfileModel,
  type UserAuthProvider,
  type UserProfileDocument,
} from '@/lib/models/UserProfile';

export type { UserAuthProvider };

/** Fields returned for admin user list rows (excludes secrets such as `googleRefreshToken`). */
const LIST_USER_BASE_SELECT = 'userId email name hasCompletedOnboarding role createdAt updatedAt';

type ListUserProfileLean = Pick<
  UserProfileDocument,
  'userId' | 'email' | 'name' | 'hasCompletedOnboarding' | 'role' | 'createdAt' | 'updatedAt'
> & {
  authProvider?: UserAuthProvider;
  /** Set when listing with password-reset eligibility; hash value is never loaded. */
  hasPasswordHash?: boolean;
};

/** Map a MongoDB document to the shared User type. */
function mongoDocToUser(doc: UserProfileDocument): User {
  return {
    userId: String(doc.userId),
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
 * @param userId - Auth user id to look up.
 * @returns The matching user profile, or null when not found.
 */
export async function getUserById(userId: string): Promise<User | null> {
  await connectToDatabase();

  const doc = await UserProfileModel.findById(userId).lean<UserProfileDocument | null>();
  if (!doc) return null;
  return mongoDocToUser(doc);
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
    userId: String(doc.userId),
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
 * Updates the bcrypt password hash for a user profile.
 * @param userId - Auth user id to update.
 * @param passwordHash - New bcrypt hash to persist.
 * @returns Resolves when the profile update completes.
 * @throws Error with `code` 404 when no matching profile exists.
 */
export async function updateUserPasswordHash(userId: string, passwordHash: string): Promise<void> {
  await connectToDatabase();

  const updated = await UserProfileModel.findByIdAndUpdate(userId, { passwordHash }).lean();
  if (!updated) {
    const notFound = Object.assign(new Error('User profile not found'), { code: 404 });
    throw notFound;
  }
}

/**
 * Update user_profiles fields. Only provided fields are updated.
 * @param userId - Auth user id to update.
 * @param data - Partial profile fields to apply.
 * @returns The updated user profile.
 * @throws Error with `code` 404 when no matching profile exists.
 */
export async function updateUser(userId: string, data: UpdateUserData): Promise<User> {
  await connectToDatabase();

  const payload: Partial<Pick<UserProfileDocument, 'hasCompletedOnboarding' | 'role'>> =
    Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));

  const updated = await UserProfileModel.findByIdAndUpdate(userId, payload, {
    returnDocument: 'after',
    runValidators: true,
  }).lean<UserProfileDocument | null>();

  if (!updated) {
    const notFound = Object.assign(new Error('User profile not found'), { code: 404 });
    throw notFound;
  }

  return mongoDocToUser(updated);
}

// -----------------------------------------------------------------------------
// List (admin)
// -----------------------------------------------------------------------------

/**
 * Password reset eligibility for a user profile.
 */
export interface UserPasswordAuthState {
  userId: string;
  supportsPasswordReset: boolean;
}

/**
 * Fetch password-reset eligibility for a user by email.
 * @param email - Email address to look up.
 * @returns Auth state when a profile exists; otherwise null.
 */
export async function getUserPasswordAuthStateByEmail(
  email: string
): Promise<UserPasswordAuthState | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  await connectToDatabase();

  const doc = await UserProfileModel.findOne({ email: normalized })
    .select({ _id: 1, userId: 1, passwordHash: 1, authProvider: 1 })
    .lean<Pick<UserProfileDocument, '_id' | 'userId' | 'passwordHash' | 'authProvider'> | null>();
  if (!doc) return null;

  return {
    userId: String(doc.userId),
    supportsPasswordReset: userSupportsPasswordReset(doc),
  };
}

/**
 * Fetch password-reset eligibility for a user by id.
 * @param userId - Auth user id to look up.
 * @returns Auth state when a profile exists; otherwise null.
 */
export async function getUserPasswordAuthStateById(
  userId: string
): Promise<UserPasswordAuthState | null> {
  await connectToDatabase();

  const doc = await UserProfileModel.findById(userId)
    .select({ userId: 1, passwordHash: 1, authProvider: 1 })
    .lean<Pick<UserProfileDocument, 'userId' | 'passwordHash' | 'authProvider'> | null>();

  if (!doc) return null;

  return {
    userId: String(doc.userId),
    supportsPasswordReset: userSupportsPasswordReset(doc),
  };
}

/**
 * Defines the shape of list users options.
 */
export interface ListUsersOptions {
  limit?: number;
  offset?: number;
  /** When true, include `canResetPassword` on each listed user (admin UI). */
  includePasswordResetEligibility?: boolean;
}

/**
 * Admin user list row with optional password-reset eligibility.
 */
export interface AdminListUser extends User {
  canResetPassword?: boolean;
}

/**
 * Defines the shape of list users result.
 */
export interface ListUsersResult {
  users: AdminListUser[];
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
  const includePasswordResetEligibility = options.includePasswordResetEligibility === true;

  const [docs, total] = await Promise.all([
    includePasswordResetEligibility
      ? UserProfileModel.aggregate<ListUserProfileLean>([
          { $sort: { createdAt: 1 } },
          { $skip: offset },
          { $limit: limit },
          {
            $project: {
              userId: 1,
              email: 1,
              name: 1,
              hasCompletedOnboarding: 1,
              role: 1,
              createdAt: 1,
              updatedAt: 1,
              authProvider: 1,
              hasPasswordHash: {
                $gt: [{ $strLenCP: { $ifNull: ['$passwordHash', ''] } }, 0],
              },
            },
          },
        ])
      : UserProfileModel.find({})
          .select(LIST_USER_BASE_SELECT)
          .sort({ createdAt: 1 })
          .skip(offset)
          .limit(limit)
          .lean<ListUserProfileLean[]>(),
    UserProfileModel.countDocuments({}),
  ]);

  return {
    users: docs.map((doc) => ({
      ...mongoDocToUser(doc as UserProfileDocument),
      ...(includePasswordResetEligibility
        ? {
            canResetPassword: userSupportsPasswordReset({
              authProvider: doc.authProvider,
              passwordHash: doc.hasPasswordHash ? 'present' : undefined,
            }),
          }
        : {}),
    })),
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

  await UserProfileModel.findByIdAndUpdate(userId, payload);
}

/**
 * Revokes stored Google login tokens so the app is removed from the user's Google account access list.
 * Best-effort: silently no-ops when no refresh token is stored; logs decryption/revoke failures.
 * @param userId - Auth user id.
 * @returns Resolves when the revoke attempt finishes (including no-op cases).
 */
export async function revokeStoredGoogleAuthForUser(userId: string): Promise<void> {
  await connectToDatabase();

  const doc = await UserProfileModel.findById(userId)
    .select({ authProvider: 1, googleRefreshToken: 1 })
    .lean<Pick<UserProfileDocument, 'authProvider' | 'googleRefreshToken'> | null>();

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

  const result = await UserProfileModel.deleteOne({ _id: userId });
  return result.deletedCount > 0;
}
