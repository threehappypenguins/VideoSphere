// =============================================================================
// USER REPOSITORY
// =============================================================================
// All user data access goes through this module. API routes and Server
// Components should call these functions only.
//
// Uses Mongoose for the user_profiles collection.
// =============================================================================

import type { User, UserRole } from '@/types';
import { connectToDatabase } from '@/lib/mongodb';
import { UserProfileModel, type UserProfileDocument } from '@/lib/models/UserProfile';

/** Map a MongoDB document to the shared User type. */
function mongoDocToUser(doc: UserProfileDocument): User {
  return {
    userId: String(doc.userId ?? doc._id),
    email: String(doc.email),
    isSupporter: Boolean(doc.isSupporter),
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
  isSupporter?: boolean;
  hasCompletedOnboarding?: boolean;
  role?: UserRole;
}

/**
 * Create a user_profiles document. Document ID is data.userId.
 * Used by register and OAuth callback; callers must ensure the Auth user exists first.
 */
export async function createUser(data: CreateUserData): Promise<User> {
  await connectToDatabase();
  const created = await UserProfileModel.create({
    _id: data.userId,
    userId: data.userId,
    email: data.email.trim().toLowerCase(),
    isSupporter: data.isSupporter ?? false,
    hasCompletedOnboarding: data.hasCompletedOnboarding ?? false,
    role: data.role ?? 'user',
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
 * Fetch a user by email. Returns null if not found.
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

// -----------------------------------------------------------------------------
// Update
// -----------------------------------------------------------------------------

/**
 * Defines the shape of update user data.
 */
export interface UpdateUserData {
  isSupporter?: boolean;
  hasCompletedOnboarding?: boolean;
  role?: UserRole;
}

/**
 * Update user_profiles fields (e.g. isSupporter, role). Only provided fields are updated.
 *
 * Mirrors getUserById's fallback: if _id lookup misses, resolves by userId and retries.
 */
export async function updateUser(userId: string, data: UpdateUserData): Promise<User> {
  await connectToDatabase();

  const payload: Partial<
    Pick<UserProfileDocument, 'isSupporter' | 'hasCompletedOnboarding' | 'role'>
  > = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));

  const byId = await UserProfileModel.findByIdAndUpdate(userId, payload, {
    new: true,
    runValidators: true,
  }).lean<UserProfileDocument | null>();
  if (byId) return mongoDocToUser(byId);

  const byUserId = await UserProfileModel.findOneAndUpdate({ userId }, payload, {
    new: true,
    runValidators: true,
  }).lean<UserProfileDocument | null>();

  if (!byUserId) {
    const notFound = Object.assign(new Error('User profile not found'), { code: 404 });
    throw notFound;
  }

  return mongoDocToUser(byUserId);
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
  totalSupporters: number;
}

/**
 * Return aggregate user counts for admin dashboard stats.
 */
export async function getUserCounts(): Promise<UserCounts> {
  await connectToDatabase();

  const [totalUsers, totalSupporters] = await Promise.all([
    UserProfileModel.countDocuments({}),
    UserProfileModel.countDocuments({ isSupporter: true }),
  ]);

  return {
    totalUsers,
    totalSupporters,
  };
}
