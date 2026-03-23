// =============================================================================
// GET /api/auth/oauth/google
// =============================================================================
// Initiates Google OAuth via admin client (createOAuth2Token), same pattern as
// email/password. Redirects user to Google; they return to /api/auth/oauth/callback.
// https://appwrite.io/docs/tutorials/nextjs-ssr-auth/step-7
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { OAuthProvider } from 'node-appwrite';
import { appwriteAuth } from '@/lib/appwrite';
import { safeRedirect } from '@/lib/safe-redirect';

export async function GET(req: NextRequest) {
  try {
    const origin = req.nextUrl.origin;
    const rd = safeRedirect(req.nextUrl.searchParams.get('redirect'));
    const callbackUrl = rd
      ? `${origin}/api/auth/oauth/callback?rd=${encodeURIComponent(rd)}`
      : `${origin}/api/auth/oauth/callback`;
    const redirectUrl = await appwriteAuth.createOAuth2Token({
      provider: OAuthProvider.Google,
      success: callbackUrl,
      failure: `${origin}/login?error=oauth_failed`,
    });
    return NextResponse.redirect(redirectUrl || `${origin}/login?error=oauth_failed`);
  } catch (err) {
    console.error('[GET /api/auth/oauth/google]', err);
    const origin = req.nextUrl.origin;
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }
}
