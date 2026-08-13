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
//   /dashboard/users — authenticated admin users only
//
// Session is stored as an httpOnly JWT cookie. Claims are verified locally with
// `jose` (no hairpin HTTP fetch to the app). That keeps `pnpm dev:https` and
// reverse-proxy deploys working — internal `http://127.0.0.1` fetches fail when
// the server only listens on HTTPS.
// =============================================================================

import { jwtVerify } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookieName } from '@/lib/auth-session-cookie';

type SessionClaims = {
  userId: string;
  role: 'admin' | 'user';
};

/**
 * Verifies the session JWT from cookies and returns subject + role claims.
 * @param request - Incoming request (cookies forwarded by the browser).
 * @returns Session claims, or null when missing/invalid.
 */
async function readSessionClaims(request: NextRequest): Promise<SessionClaims | null> {
  const token = request.cookies.get(getSessionCookieName())?.value ?? null;
  if (!token) return null;

  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    return {
      userId: payload.sub,
      role: payload.role === 'admin' ? 'admin' : 'user',
    };
  } catch {
    return null;
  }
}

/**
 * Build the original path including query string so redirects preserve
 * parameters like ?upgrade=success after login.
 */
function getFullPath(request: NextRequest): string {
  const { pathname, search } = request.nextUrl;
  return search ? `${pathname}${search}` : pathname;
}

function isAdminOnlyDashboardPath(pathname: string): boolean {
  return pathname === '/dashboard/users' || pathname.startsWith('/dashboard/users/');
}

export async function proxy(request: NextRequest) {
  try {
    const { pathname } = request.nextUrl;
    const fullPath = getFullPath(request);

    const claims = await readSessionClaims(request);

    if (pathname === '/') {
      if (!claims) {
        return NextResponse.next();
      }
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }

    // No valid session — redirect to login
    if (!claims) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', fullPath);
      return NextResponse.redirect(loginUrl);
    }

    if (pathname.startsWith('/admin') || isAdminOnlyDashboardPath(pathname)) {
      if (claims.role !== 'admin') {
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
      return NextResponse.next();
    }

    return NextResponse.next();
  } catch {
    // Fail closed: on error, redirect to login instead of allowing through
    const loginUrl = new URL('/login', request.url);
    const fullPath = getFullPath(request);
    loginUrl.searchParams.set('redirect', fullPath);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: ['/', '/dashboard/:path*', '/profile/:path*', '/admin/:path*'],
};
