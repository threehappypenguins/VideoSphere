// =============================================================================
// USER REPOSITORY
// =============================================================================
// All user data access goes through this module. API routes and Server
// Components should call these functions only — not the Appwrite SDK directly.
//
// Implementation will use Appwrite (Database + Auth) for persistence.
// =============================================================================

import type { User } from '@/types';

/**
 * Fetch a user by ID. Returns null if not found.
 */
export async function getUserById(id: string): Promise<User | null> {
  // TODO: Implement with Appwrite (Users collection or Auth + custom attributes).
  throw new Error('getUserById is not implemented yet.');
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
