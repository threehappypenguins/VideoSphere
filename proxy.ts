// =============================================================================
// NEXT.JS ROUTE PROTECTION PROXY
// =============================================================================
// Intercepts requests to protected routes and enforces authentication and
// admin-role requirements server-side using the Appwrite node-appwrite SDK.
//
// Protected routes:
//   /dashboard/*  — authenticated users only
//   /profile/*    — authenticated users only
//   /admin/*      — authenticated admin users only
//
// node-appwrite v14+ is fully fetch-based and compatible with the Edge Runtime.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { Client, Account, Databases } from 'node-appwrite';

const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!;
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!;
const API_KEY = process.env.APPWRITE_API_KEY!;

const DATABASE_ID = 'videosphere';
const COLLECTION_ID = 'user_profiles';

// Appwrite stores the session under this cookie name (exact project ID, no transformation)
function sessionCookieName(): string {
  return `a_session_${PROJECT_ID}`;
}

/**
 * Verify the session token with Appwrite and return the user object.
 * Uses a scoped client with .setSession() — does NOT use the admin API key.
 * Returns null if the session is invalid or expired.
 */
async function getSessionUser(sessionToken: string): Promise<{ $id: string } | null> {
  try {
    const client = new Client()
      .setEndpoint(ENDPOINT)
      .setProject(PROJECT_ID)
      .setSession(sessionToken);
    const account = new Account(client);
    return await account.get();
  } catch {
    return null;
  }
}

/**
 * Fetch the user's role from the user_profiles collection using the admin API key.
 * Returns null if the document is not found or on error.
 */
async function getUserRole(userId: string): Promise<string | null> {
  try {
    const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID).setKey(API_KEY);
    const databases = new Databases(client);
    const doc = await databases.getDocument(DATABASE_ID, COLLECTION_ID, userId);
    return (doc.role as string) ?? null;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  try {
    const { pathname } = request.nextUrl;

    const cookieName = sessionCookieName();
    const sessionToken = request.cookies.get(cookieName)?.value;

    console.log(`[proxy] ${request.method} ${pathname}`);
    console.log(`[proxy] Looking for cookie: ${cookieName}`);
    console.log(`[proxy] Session token found: ${!!sessionToken}`);

    // No session cookie — redirect to login
    if (!sessionToken) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      console.log(`[proxy] No session token. Redirecting to /login`);
      return NextResponse.redirect(loginUrl);
    }

    // Verify the session is still valid with Appwrite
    console.log(`[proxy] Verifying session...`);
    const user = await getSessionUser(sessionToken);
    console.log(`[proxy] Session verification: ${user ? 'valid' : 'invalid'}`);

    if (!user) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      console.log(`[proxy] Session invalid. Redirecting to /login`);
      return NextResponse.redirect(loginUrl);
    }

    console.log(`[proxy] User authenticated: ${user.$id}`);

    // Admin routes require the 'admin' role
    if (pathname.startsWith('/admin')) {
      const role = await getUserRole(user.$id);
      console.log(`[proxy] Admin check: role=${role}`);
      if (role !== 'admin') {
        console.log(`[proxy] Non-admin blocking /admin access`);
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
    }

    console.log(`[proxy] Allowing request`);
    return NextResponse.next();
  } catch (error) {
    console.error(`[proxy] Error:`, error);
    // On error, allow the request through (fail open) to avoid breaking the app
    return NextResponse.next();
  }
}

export const config = {
  matcher: ['/dashboard/:path*', '/profile/:path*', '/admin/:path*'],
};
