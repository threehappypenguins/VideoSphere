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
// calling Appwrite-backed API routes internally (outside the matcher so no
// circular routing). Admin RBAC uses GET /api/auth/session-role so this file
// never imports lib/appwrite or the users repository — middleware stays free
// of server SDK init (and edge-safe fetch-only I/O). Role still comes from
// user_profiles, not Auth prefs/labels.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookieName } from '@/lib/auth-session-cookie';

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
 * Session + user_profiles.role in one round trip (for /admin/* only).
 * Avoids importing the Tables SDK in middleware.
 */
async function getSessionRoleForAdminGate(
  request: NextRequest
): Promise<'admin' | 'user' | 'unauthenticated' | 'error'> {
  try {
    const res = await fetch(new URL('/api/auth/session-role', request.url), {
      headers: { cookie: request.headers.get('cookie') ?? '' },
    });
    if (res.status === 401) return 'unauthenticated';
    if (!res.ok) return 'error';
    const data = (await res.json()) as { role?: string };
    return data.role === 'admin' ? 'admin' : 'user';
  } catch {
    // Network / JSON parse failures — not a confirmed 401; avoid treating as logged-out
    return 'error';
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

    if (pathname.startsWith('/admin')) {
      const gate = await getSessionRoleForAdminGate(request);
      if (gate === 'unauthenticated') {
        const loginUrl = new URL('/login', request.url);
        loginUrl.searchParams.set('redirect', pathname);
        return NextResponse.redirect(loginUrl);
      }
      if (gate !== 'admin') {
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
      return NextResponse.next();
    }

    const user = await getSessionUser(request);

    if (!user) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
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
