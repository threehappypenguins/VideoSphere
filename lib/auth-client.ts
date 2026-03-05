// =============================================================================
// APPWRITE CLIENT-SIDE AUTH
// =============================================================================
// Client-side Appwrite authentication using the browser SDK.
// Provides functions for login, logout, and session management.
//
// Uses the standard Appwrite Client and Account SDKs.
// Only uses NEXT_PUBLIC_* environment variables (safe for client).
//
// Reference: https://appwrite.io/docs/references/web/client-web/auth
// =============================================================================

import { Client, Account } from 'appwrite';

// Initialize Appwrite client
const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!);

const account = new Account(client);

/**
 * Login with email and password
 * Creates a session using Appwrite's built-in email/password authentication
 *
 * @param email - User's email address
 * @param password - User's password
 * @returns Session object with userId, email, and other session details
 * @throws Error with message if login fails
 */
export async function loginWithEmail(email: string, password: string) {
  try {
    // Delete any existing session first to avoid "session already active" error
    try {
      await account.deleteSession('current');
    } catch {
      // No existing session, which is fine
    }

    // Create new session
    const session = await account.createEmailPasswordSession(email, password);
    return session;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Login failed';
    throw new Error(errorMessage);
  }
}

/**
 * Logout user and destroy current session
 *
 * @throws Error with message if logout fails
 */
export async function logout() {
  try {
    await account.deleteSession('current');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Logout failed';
    throw new Error(errorMessage);
  }
}

/**
 * Get current user session
 * Returns null if no active session exists
 *
 * @returns Session object or null if not authenticated
 */
export async function getCurrentSession() {
  try {
    const session = await account.getSession('current');
    return session;
  } catch {
    // No active session
    return null;
  }
}

/**
 * Get current authenticated user
 * Returns null if no user is logged in
 *
 * @returns User object or null if not authenticated
 */
export async function getCurrentUser() {
  try {
    const user = await account.get();
    return user;
  } catch {
    // No authenticated user
    return null;
  }
}
