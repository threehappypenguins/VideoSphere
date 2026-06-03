import { NextRequest, NextResponse } from 'next/server';
import {
  buildGoogleOAuthErrorRedirect,
  createGoogleOAuthStartRedirect,
} from '@/lib/auth/google-oauth';
import { getAuthenticatedSessionUserId } from '@/lib/api/auth';
import { getUserById } from '@/lib/repositories/users';

/**
 * Initiates Google OAuth to link a Google account to the logged-in password user.
 * @param req - The incoming request object.
 * @returns Redirect to Google OAuth consent screen.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const connectErrorContext = { connect: true as const };

  const userId = await getAuthenticatedSessionUserId(req);
  if (!userId) {
    return NextResponse.redirect(
      buildGoogleOAuthErrorRedirect(origin, 'oauth_initiation_failed', connectErrorContext)
    );
  }

  let profile;
  try {
    profile = await getUserById(userId);
  } catch (err) {
    console.error('[GET /api/auth/oauth/connect] profile lookup failed', err);
    profile = null;
  }
  if (!profile) {
    return NextResponse.redirect(
      buildGoogleOAuthErrorRedirect(origin, 'oauth_initiation_failed', connectErrorContext)
    );
  }

  if (profile.authProvider === 'google') {
    return NextResponse.redirect(
      buildGoogleOAuthErrorRedirect(origin, 'oauth_connect_already_linked', connectErrorContext)
    );
  }

  const response = createGoogleOAuthStartRedirect(
    origin,
    {
      flow: 'connect',
      userId,
      redirectTo: '/profile?success=google_connected',
    },
    { promptConsent: true }
  );
  if (!response) {
    console.error('[GET /api/auth/oauth/connect] Missing Google OAuth client id env var');
    return NextResponse.redirect(
      buildGoogleOAuthErrorRedirect(origin, 'oauth_initiation_failed', connectErrorContext)
    );
  }

  return response;
}
