// =============================================================================
// USER REPOSITORY
// =============================================================================
// All user data access goes through this module. API routes and Server
// Components should call these functions only.
//
// Uses Mongoose for the user_profiles collection.
// =============================================================================

import type {
  User,
  UserAuthProvider,
  UserPreferences,
  UserRole,
  YouTubeUserDefaults,
} from '@/types';
import { userSupportsPasswordReset } from '@/lib/auth/password';
import { normalizeStoredPlatformDefaults } from '@/lib/auth/platform-defaults-validation';
import { normalizeStoredUserPreferences } from '@/lib/user-preferences';
import {
  mergeDraftLabelLibraryEntries,
  normalizeDraftLabelLibrary,
  upsertDraftLabelNamesInLibrary,
} from '@/lib/draft-labels';
import type { DraftLabelDefinition } from '@/types';
import { revokeGoogleOAuthTokens } from '@/lib/auth/google-oauth';
import { decryptToken, encryptToken } from '@/lib/crypto/token-encryption';
import { connectToDatabase } from '@/lib/mongodb';
import { UserProfileModel, type UserProfileDocument } from '@/lib/models/UserProfile';

export type { UserAuthProvider } from '@/types';

/** Fields loaded for draft label library reads (avoids pulling unrelated profile data). */
const DRAFT_LABEL_LIBRARY_SELECT = { draftLabelLibrary: 1 } as const;

type DraftLabelLibraryLean = Pick<UserProfileDocument, 'draftLabelLibrary'>;

/** Fields returned for admin user list rows (excludes secrets such as `googleRefreshToken`). */
const LIST_USER_BASE_SELECT =
  'userId email name hasCompletedOnboarding role authProvider createdAt updatedAt';

type ListUserProfileLean = Pick<
  UserProfileDocument,
  | 'userId'
  | 'email'
  | 'name'
  | 'hasCompletedOnboarding'
  | 'role'
  | 'authProvider'
  | 'createdAt'
  | 'updatedAt'
>;

/** Fields loaded for authenticated session responses (excludes secrets). */
const SESSION_USER_SELECT =
  'userId email name hasCompletedOnboarding role authProvider totpEnabled preferences createdAt updatedAt';

type SessionUserProfileLean = Pick<
  UserProfileDocument,
  | 'userId'
  | 'email'
  | 'name'
  | 'hasCompletedOnboarding'
  | 'role'
  | 'authProvider'
  | 'totpEnabled'
  | 'preferences'
  | 'createdAt'
  | 'updatedAt'
>;

/**
 * User profile fields returned by {@link getUserSessionById} for session APIs.
 */
export interface SessionUser extends User {
  totpEnabled: boolean;
}

/** Map a MongoDB document to the shared User type. */
function mongoDocToUser(doc: UserProfileDocument): User {
  const platformDefaults = normalizeStoredPlatformDefaults(doc.platformDefaults);
  const preferences = normalizeStoredUserPreferences(doc.preferences);
  const draftLabelLibrary = normalizeDraftLabelLibrary(doc.draftLabelLibrary);

  return {
    userId: String(doc.userId),
    email: String(doc.email),
    name: typeof doc.name === 'string' ? doc.name : undefined,
    hasCompletedOnboarding: Boolean(doc.hasCompletedOnboarding),
    role: (doc.role as UserRole) ?? 'user',
    authProvider: doc.authProvider,
    $createdAt: new Date(doc.createdAt).toISOString(),
    $updatedAt: new Date(doc.updatedAt).toISOString(),
    ...(platformDefaults !== undefined ? { platformDefaults } : {}),
    ...(preferences !== undefined ? { preferences } : {}),
    ...(draftLabelLibrary.length > 0 ? { draftLabelLibrary } : {}),
  };
}

/** Map a lean session profile document to {@link SessionUser}. */
function mongoDocToSessionUser(doc: SessionUserProfileLean): SessionUser {
  return {
    ...mongoDocToUser(doc as UserProfileDocument),
    totpEnabled: Boolean(doc.totpEnabled),
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
  totpEnabled: boolean;
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
    authProvider: data.authProvider ?? 'password',
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
 * Fetch session fields for a user by id, including {@link SessionUser.totpEnabled}.
 * @param userId - Auth user id to look up.
 * @returns Session user profile, or null when not found.
 */
export async function getUserSessionById(userId: string): Promise<SessionUser | null> {
  await connectToDatabase();

  const doc = await UserProfileModel.findById(userId)
    .select(SESSION_USER_SELECT)
    .lean<SessionUserProfileLean | null>();
  if (!doc) return null;
  return mongoDocToSessionUser(doc);
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
    .select({ _id: 1, userId: 1, passwordHash: 1, role: 1, totpEnabled: 1 })
    .lean<UserProfileDocument | null>();
  if (!doc || typeof doc.passwordHash !== 'string' || doc.passwordHash.length === 0) {
    return null;
  }

  return {
    userId: String(doc.userId),
    passwordHash: doc.passwordHash,
    role: (doc.role as UserRole) ?? 'user',
    totpEnabled: Boolean(doc.totpEnabled),
  };
}

/**
 * Retrieves the stored bcrypt password hash for a user profile.
 * @param userId - Auth user id to look up.
 * @returns The password hash when present; otherwise null.
 */
export async function getUserPasswordHashById(userId: string): Promise<string | null> {
  await connectToDatabase();

  const doc = await UserProfileModel.findById(userId)
    .select({ passwordHash: 1 })
    .lean<Pick<UserProfileDocument, 'passwordHash'> | null>();

  if (!doc || typeof doc.passwordHash !== 'string' || doc.passwordHash.length === 0) {
    return null;
  }

  return doc.passwordHash;
}

/**
 * Enables TOTP for a user by persisting an encrypted secret.
 * @param userId - Auth user id to update.
 * @param encryptedSecret - AES-256-GCM encrypted TOTP secret.
 * @returns Resolves when the profile update completes.
 * @throws Error with `code` 404 when no matching profile exists.
 */
export async function enableTotp(userId: string, encryptedSecret: string): Promise<void> {
  await connectToDatabase();

  const updated = await UserProfileModel.findByIdAndUpdate(userId, {
    $set: { totpSecret: encryptedSecret, totpEnabled: true },
  }).lean();

  if (!updated) {
    const notFound = Object.assign(new Error('User profile not found'), { code: 404 });
    throw notFound;
  }
}

/**
 * Disables TOTP for a user and removes the stored secret.
 * @param userId - Auth user id to update.
 * @returns Resolves when the profile update completes.
 * @throws Error with `code` 404 when no matching profile exists.
 */
export async function disableTotp(userId: string): Promise<void> {
  await connectToDatabase();

  const updated = await UserProfileModel.findByIdAndUpdate(userId, {
    $set: { totpEnabled: false },
    $unset: { totpSecret: 1 },
  }).lean();

  if (!updated) {
    const notFound = Object.assign(new Error('User profile not found'), { code: 404 });
    throw notFound;
  }
}

/**
 * Returns whether TOTP is enabled for a user without decrypting the stored secret.
 * @param userId - Auth user id to look up.
 * @returns True when the profile has `totpEnabled`; otherwise false.
 */
export async function getTotpEnabledById(userId: string): Promise<boolean> {
  await connectToDatabase();

  const doc = await UserProfileModel.findById(userId)
    .select({ totpEnabled: 1 })
    .lean<Pick<UserProfileDocument, 'totpEnabled'> | null>();

  return Boolean(doc?.totpEnabled);
}

/**
 * Result of loading a user's stored TOTP secret for verification flows.
 */
export type TotpSecretLookup =
  | { status: 'disabled' }
  | { status: 'available'; secret: string }
  | { status: 'unavailable' };

/**
 * Returns decrypted TOTP configuration for verification flows.
 * @param userId - Auth user id to look up.
 * @returns Whether TOTP is disabled, available, or enabled but unreadable.
 */
export async function getTotpSecret(userId: string): Promise<TotpSecretLookup> {
  await connectToDatabase();

  const doc = await UserProfileModel.findById(userId)
    .select({ totpSecret: 1, totpEnabled: 1 })
    .lean<Pick<UserProfileDocument, 'totpSecret' | 'totpEnabled'> | null>();

  if (!doc || !doc.totpEnabled) {
    return { status: 'disabled' };
  }

  const encrypted = doc.totpSecret?.trim();
  if (!encrypted) {
    return { status: 'unavailable' };
  }

  try {
    return { status: 'available', secret: decryptToken(encrypted) };
  } catch {
    return { status: 'unavailable' };
  }
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
  name?: string;
  email?: string;
  /** Fields shallow-merged into stored `platformDefaults.youtube` via dot-notation update. */
  platformDefaultsYoutube?: Partial<YouTubeUserDefaults>;
  /** Partial merge into stored `preferences`. */
  preferences?: Partial<UserPreferences>;
  /** Replaces the saved draft label library when provided. */
  draftLabelLibrary?: DraftLabelDefinition[];
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

  const payload: Record<string, unknown> = {};

  if (data.hasCompletedOnboarding !== undefined) {
    payload.hasCompletedOnboarding = data.hasCompletedOnboarding;
  }
  if (data.role !== undefined) {
    payload.role = data.role;
  }
  if (data.name !== undefined) {
    payload.name = data.name.trim();
  }
  if (data.email !== undefined) {
    payload.email = data.email.trim().toLowerCase();
  }

  if (data.platformDefaultsYoutube !== undefined) {
    for (const [key, value] of Object.entries(data.platformDefaultsYoutube)) {
      if (value !== undefined) {
        payload[`platformDefaults.youtube.${key}`] = value;
      }
    }
  }

  if (data.preferences !== undefined) {
    for (const [key, value] of Object.entries(data.preferences)) {
      if (value !== undefined) {
        payload[`preferences.${key}`] = value;
      }
    }
  }

  if (data.draftLabelLibrary !== undefined) {
    payload.draftLabelLibrary = normalizeDraftLabelLibrary(data.draftLabelLibrary);
  }

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
    UserProfileModel.find({})
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
 * Options for {@link persistGoogleAuthForUser}.
 */
export interface PersistGoogleAuthOptions {
  /** When true, removes password hash and TOTP config (connect / Google login flows). */
  unsetPasswordHash?: boolean;
}

/**
 * Records Google OAuth login on an existing profile and stores a refresh token when provided.
 * @param userId - Auth user id.
 * @param refreshToken - Google refresh token from the login token exchange, if any.
 * @param options - Optional update flags (e.g. unset password on connect).
 * @returns Resolves when the profile update completes.
 */
export async function persistGoogleAuthForUser(
  userId: string,
  refreshToken?: string,
  options?: PersistGoogleAuthOptions
): Promise<void> {
  await connectToDatabase();

  const payload: Partial<Pick<UserProfileDocument, 'authProvider' | 'googleRefreshToken'>> = {
    authProvider: 'google',
  };
  const trimmedRefresh = refreshToken?.trim();
  if (trimmedRefresh) {
    payload.googleRefreshToken = encryptToken(trimmedRefresh);
  }

  const update: Record<string, unknown> = { $set: payload };
  if (options?.unsetPasswordHash) {
    (update.$set as Record<string, unknown>).totpEnabled = false;
    update.$unset = { passwordHash: 1, totpSecret: 1 };
  }

  await UserProfileModel.findByIdAndUpdate(userId, update);
}

/**
 * Reverts a Google OAuth account to password-based login.
 * @param userId - Auth user id.
 * @param passwordHash - Bcrypt hash for the new password.
 * @returns Resolves when the profile update completes.
 * @throws Error with `code` 404 when no matching profile exists.
 */
export async function revertGoogleAuthToPassword(
  userId: string,
  passwordHash: string
): Promise<void> {
  await connectToDatabase();

  const updated = await UserProfileModel.findByIdAndUpdate(userId, {
    $set: { passwordHash, authProvider: 'password' },
    $unset: { googleRefreshToken: 1 },
  }).lean();

  if (!updated) {
    const notFound = Object.assign(new Error('User profile not found'), { code: 404 });
    throw notFound;
  }
}

/**
 * Returns the auth provider for a user profile.
 * @param userId - Auth user id.
 * @returns The stored auth provider, or null when no profile exists for the id.
 */
export async function getUserAuthProviderById(userId: string): Promise<UserAuthProvider | null> {
  await connectToDatabase();

  const doc = await UserProfileModel.findById(userId)
    .select({ authProvider: 1 })
    .lean<Pick<UserProfileDocument, 'authProvider'> | null>();

  if (!doc) return null;
  return doc.authProvider;
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
 * Returns the authenticated user's saved draft label library.
 * @param userId - Auth user id.
 * @returns Normalized label definitions in stored order.
 */
export async function getDraftLabelLibrary(userId: string): Promise<DraftLabelDefinition[]> {
  await connectToDatabase();
  const doc = await UserProfileModel.findById(userId)
    .select(DRAFT_LABEL_LIBRARY_SELECT)
    .lean<DraftLabelLibraryLean | null>();
  if (!doc) return [];
  return normalizeDraftLabelLibrary(doc.draftLabelLibrary);
}

/**
 * Merges label names into the user's saved draft label library without duplicates.
 * @param userId - Auth user id.
 * @param labels - Label names to upsert.
 * @returns Updated library after merge.
 */
export async function upsertDraftLabelsInLibrary(
  userId: string,
  labels: readonly string[]
): Promise<DraftLabelDefinition[]> {
  await connectToDatabase();
  const doc = await UserProfileModel.findById(userId)
    .select(DRAFT_LABEL_LIBRARY_SELECT)
    .lean<DraftLabelLibraryLean | null>();
  if (!doc) {
    const notFound = Object.assign(new Error('User profile not found'), { code: 404 });
    throw notFound;
  }

  const merged = upsertDraftLabelNamesInLibrary(
    normalizeDraftLabelLibrary(doc.draftLabelLibrary),
    labels
  );
  await UserProfileModel.findByIdAndUpdate(
    userId,
    { draftLabelLibrary: merged },
    { runValidators: true }
  );
  return merged;
}

/**
 * Merges label definitions (including color updates) into the user's saved library.
 * @param userId - Auth user id.
 * @param entries - Label definitions to merge by name.
 * @returns Updated library after merge.
 */
export async function mergeDraftLabelsInLibrary(
  userId: string,
  entries: readonly DraftLabelDefinition[]
): Promise<DraftLabelDefinition[]> {
  await connectToDatabase();
  const doc = await UserProfileModel.findById(userId)
    .select(DRAFT_LABEL_LIBRARY_SELECT)
    .lean<DraftLabelLibraryLean | null>();
  if (!doc) {
    const notFound = Object.assign(new Error('User profile not found'), { code: 404 });
    throw notFound;
  }

  const merged = mergeDraftLabelLibraryEntries(
    normalizeDraftLabelLibrary(doc.draftLabelLibrary),
    entries
  );
  await UserProfileModel.findByIdAndUpdate(
    userId,
    { draftLabelLibrary: merged },
    { runValidators: true }
  );
  return merged;
}

/**
 * Replaces the user's saved draft label library.
 * @param userId - Auth user id.
 * @param labels - Full library to persist.
 * @returns Updated library.
 */
export async function setDraftLabelLibrary(
  userId: string,
  labels: readonly DraftLabelDefinition[]
): Promise<DraftLabelDefinition[]> {
  const normalized = normalizeDraftLabelLibrary(labels);
  await updateUser(userId, { draftLabelLibrary: normalized });
  return normalized;
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
