import { NextRequest, NextResponse } from 'next/server';
import { buildGoogleOAuthErrorRedirect } from '@/lib/auth/google-oauth';
import { createGoogleOAuthStartRedirect } from '@/lib/auth/google-oauth-server';
import { safeRedirect } from '@/lib/safe-redirect';

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns Redirect to Google OAuth consent screen.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const setupToken = req.nextUrl.searchParams.get('setupToken')?.trim() || null;
  const inviteToken = req.nextUrl.searchParams.get('inviteToken')?.trim() || null;
  const redirectTo = safeRedirect(req.nextUrl.searchParams.get('redirect'));
  const oauthContext = { setupToken, inviteToken };

  if (setupToken && inviteToken) {
    return NextResponse.redirect(
      buildGoogleOAuthErrorRedirect(origin, 'oauth_initiation_failed', oauthContext)
    );
  }

  const response = createGoogleOAuthStartRedirect(origin, {
    redirectTo,
    setupToken,
    inviteToken,
  });
  if (!response) {
    console.error('[GET /api/auth/oauth/google] Missing Google OAuth client id env var');
    return NextResponse.redirect(
      buildGoogleOAuthErrorRedirect(origin, 'oauth_initiation_failed', oauthContext)
    );
  }

  return response;
}
