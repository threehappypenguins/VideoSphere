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
// calling /api/auth/session internally (outside the matcher so no circular
// routing). Admin RBAC uses user_profiles.role via getUserById (Tables SDK),
// same as API routes — not Auth labels or Account prefs (prefs.role is
// unrelated unless you add code to sync it).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookieName } from '@/lib/auth-session-cookie';
import { getUserById } from '@/lib/repositories/users';

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

export async function proxy(request: NextRequest) {
  try {
    const { pathname } = request.nextUrl;

    // Use NEXT_PUBLIC_APPWRITE_PROJECT_ID to match /api/auth/session precedence
    const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
    const cookieName = projectId ? getSessionCookieName(projectId) : null;
    const sessionToken = cookieName ? request.cookies.get(cookieName)?.value : null;

    // No session cookie — redirect to login
    if (!sessionToken) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Verify the session is still valid via /api/auth/session
    const user = await getSessionUser(request);

    if (!user) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }

    if (pathname.startsWith('/admin')) {
      const profile = await getUserById(user.$id);
      if (profile?.role !== 'admin') {
        // Fail closed: redirect to dashboard if unauthorized
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
    }

    return NextResponse.next();
  } catch (error) {
    // Fail closed: on error, redirect to login instead of allowing through
    const loginUrl = new URL('/login', request.url);
    // Preserve the original pathname as the redirect parameter if possible
    const pathname = request.nextUrl.pathname ?? '/';
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: ['/dashboard/:path*', '/profile/:path*', '/admin/:path*'],
};
