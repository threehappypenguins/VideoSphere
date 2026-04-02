import { cookies } from 'next/headers';
import { Account, Client } from 'node-appwrite';
import { getSessionCookieName } from '@/lib/auth-session-cookie';

/**
 * Reads the Appwrite session cookie from the current request context and returns
 * the authenticated user's ID. Returns null when configuration, cookie, or
 * session validation is missing/invalid.
 */
export async function getCurrentUserIdFromCookies(): Promise<string | null> {
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  if (!endpoint || !projectId) return null;

  const cookieStore = await cookies();
  const sessionSecret = cookieStore.get(getSessionCookieName(projectId))?.value;
  if (!sessionSecret) return null;

  try {
    const client = new Client()
      .setEndpoint(endpoint)
      .setProject(projectId)
      .setSession(sessionSecret);
    const account = new Account(client);
    const user = await account.get();
    return user.$id;
  } catch {
    return null;
  }
}
