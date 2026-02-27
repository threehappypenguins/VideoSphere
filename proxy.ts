// =============================================================================
// PROXY STUB (formerly middleware.ts)
// =============================================================================
// Next.js 16 renamed middleware to proxy. The proxy runs before every matched
// request using the Node.js runtime and is the right place to implement route
// protection, authentication checks, role-based access control (RBAC), and
// redirects.
//
// Currently this file does nothing — it is intentionally left for your team
// to implement as part of your authentication and authorization work.
//
// STUDENT: When you have implemented authentication, this is where you would:
// - Check if a user is authenticated before allowing access to protected routes
// - Check if a user has the required role (e.g. 'admin') for admin-only routes
// - Redirect unauthenticated users to the login page
// - Redirect unauthorized users to an appropriate error or home page
//
// Important: Proxy alone is not sufficient for security — always validate
// permissions on the server side as well (in your API routes or Server Actions)
//
// Helpful resources:
// - Next.js Proxy: https://nextjs.org/docs/app/api-reference/file-conventions/proxy
// - See /docs/admin-guide.md for context on protecting the admin route
// - Your chosen auth provider will have specific proxy/middleware examples
//   in their own documentation — refer to those when implementing
//
// The matcher config below shows which routes proxy would typically apply to.
// Update the matcher when you have auth implemented.
//
// export const config = {
//   matcher: [
//     '/admin/:path*',
//     '/dashboard/:path*',
//     '/profile/:path*',
//   ]
// }
// =============================================================================

import { NextResponse } from 'next/server';

// STUDENT: Replace this placeholder with your actual auth/RBAC logic.
// This function currently does nothing — it passes all requests through.
export function proxy(request: Request) {
  // Example: Check for authentication before allowing access
  // const cookieHeader = request.headers.get('cookie') || '';
  // if (!cookieHeader.includes('session=')) {
  //   return NextResponse.redirect(new URL('/login', request.url));
  // }
  return NextResponse.next();
}

// Currently applies to no routes. Update this matcher when you implement auth.
export const config = {
  matcher: [],
};
