// =============================================================================
// USER REPOSITORY
// =============================================================================
// All user data access goes through this module. API routes and Server
// Components should call these functions only — not the Appwrite SDK directly.
//
// Implementation will use Appwrite (Database + Auth) for persistence.
// =============================================================================

import type { User } from '@/types';
import { appwriteDatabases } from '@/lib/appwrite';

const DATABASE_ID = 'videosphere';
const COLLECTION_ID = 'user_profiles';

/**
 * Fetch a user by ID from the Appwrite user_profiles collection.
 * Returns null if not found or on error.
 */
export async function getUserById(id: string): Promise<User | null> {
  try {
    const doc = await appwriteDatabases.getDocument(DATABASE_ID, COLLECTION_ID, id);
    return {
      userId: doc.userId,
      email: doc.email,
      isSupporter: doc.isSupporter,
      role: doc.role,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    } as User;
  } catch {
    return null;
  }
}

/**
 * Set whether the user is a supporter (e.g. after successful Stripe payment).
 * Used by the Stripe webhook (checkout.session.completed).
 */
export async function setSupporterStatus(userId: string, isSupporter: boolean): Promise<void> {
  // TODO: Implement with Appwrite (update user document).
  throw new Error('setSupporterStatus is not implemented yet; supporter status was not updated.');
}

/**
 * List all users. For admin dashboard only; enforce admin role at call site.
 */
export async function listUsers(): Promise<User[]> {
  // TODO: Implement with Appwrite (list documents in Users collection).
  throw new Error('listUsers is not implemented yet.');
}
