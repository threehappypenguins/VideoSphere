// =============================================================================
// GET /api/auth/oauth/callback
// =============================================================================
// Appwrite redirects here with userId and secret after OAuth. We create the
// session with the admin client and set the httpOnly cookie (same as login/register).
// https://appwrite.io/docs/tutorials/nextjs-ssr-auth/step-7
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { appwriteAuth } from '@/lib/appwrite';
import { getSessionCookieName, getSessionCookieOptions } from '@/lib/auth-session-cookie';
import { safeRedirect } from '@/lib/safe-redirect';

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns A response describing the request result.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const userId = req.nextUrl.searchParams.get('userId');
  const secret = req.nextUrl.searchParams.get('secret');

  if (!userId || !secret) {
    return NextResponse.redirect(`${origin}/login?error=oauth_callback_failed`);
  }

  try {
    const session = await appwriteAuth.createSession({ userId, secret });
    const sessionSecret =
      session && typeof session === 'object' && 'secret' in session
        ? (session as { secret?: string }).secret
        : undefined;

    if (typeof sessionSecret === 'string' && sessionSecret.length > 0) {
      const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
      if (projectId) {
        const cookieStore = await cookies();
        cookieStore.set(getSessionCookieName(projectId), sessionSecret, getSessionCookieOptions());
      }
    }

    const rd = safeRedirect(req.nextUrl.searchParams.get('rd'));
    const callbackUrl = rd
      ? `${origin}/callback/google?rd=${encodeURIComponent(rd)}`
      : `${origin}/callback/google`;
    return NextResponse.redirect(callbackUrl);
  } catch (err) {
    console.error('[GET /api/auth/oauth/callback]', err);
    return NextResponse.redirect(`${origin}/login?error=oauth_callback_failed`);
  }
}
