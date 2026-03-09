// =============================================================================
// NEXT.JS ROUTE PROTECTION PROXY
// =============================================================================
// Intercepts requests to protected routes and enforces authentication and
// admin-role requirements server-side.
//
// Protected routes:
//   /dashboard/*  — authenticated users only
//   /profile/*    — authenticated users only
//   /admin/*      — authenticated admin users only
//
// Session is stored as an httpOnly cookie. Authentication is verified by
// calling /api/auth/session internally (outside the middleware matcher so
// no circular routing occurs). Admin role is checked via the Appwrite REST API.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookieName } from '@/lib/auth-session-cookie';

const DATABASE_ID = 'videosphere';
const COLLECTION_ID = 'user_profiles';

/**
 * Verify the session by calling the /api/auth/session route.
 * Forwards the incoming cookies so the route can read the session cookie.
 * Returns the user object if valid, null otherwise.
 */
async function getSessionUser(request: NextRequest): Promise<{ $id: string } | null> {
  try {
    const res = await fetch(new URL('/api/auth/session', request.url), {
      headers: { cookie: request.headers.get('cookie') ?? '' },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user && typeof user.$id === 'string' ? user : null;
  } catch {
    return null;
  }
}

/**
 * Fetch the user's role from the user_profiles collection via the Appwrite REST API.
 * Returns null if the document is not found or on error.
 */
async function getUserRole(userId: string): Promise<string | null> {
  const endpoint = process.env.APPWRITE_ENDPOINT ?? process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_PROJECT_ID ?? process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;
  if (!endpoint || !projectId || !apiKey) return null;

  try {
    const res = await fetch(
      `${endpoint}/v1/databases/${DATABASE_ID}/collections/${COLLECTION_ID}/documents/${userId}`,
      {
        headers: {
          'X-Appwrite-Project': projectId,
          'X-Appwrite-Key': apiKey,
        },
      }
    );
    if (!res.ok) return null;
    const doc = await res.json();
    return typeof doc.role === 'string' ? doc.role : null;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  try {
    const { pathname } = request.nextUrl;

    const projectId =
      process.env.APPWRITE_PROJECT_ID ?? process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
    const cookieName = projectId ? getSessionCookieName(projectId) : null;
    const sessionToken = cookieName ? request.cookies.get(cookieName)?.value : null;

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

    // Verify the session is still valid via /api/auth/session
    console.log(`[proxy] Verifying session...`);
    const user = await getSessionUser(request);
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
