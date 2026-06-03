import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getTotpTrustCookieName, getTotpTrustCookieOptions } from '@/lib/auth-session-cookie';
import { verifyTotpToken } from '@/lib/auth/totp';
import { disableTotp, getTotpSecret, getUserById } from '@/lib/repositories/users';

/**
 * Disables TOTP after verifying the user's current authenticator code.
 * @param req - The incoming request object.
 * @returns JSON success when two-factor auth is disabled.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const profile = await getUserById(userId);
    if (!profile) {
      return NextResponse.json({ error: 'User profile not found.' }, { status: 404 });
    }

    if (profile.authProvider !== 'password') {
      return NextResponse.json(
        { error: 'Two-factor authentication is only available for password-based accounts.' },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    if (body === null || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body must be a JSON object.' }, { status: 400 });
    }

    const { token: rawToken } = body as Record<string, unknown>;
    if (typeof rawToken !== 'string') {
      return NextResponse.json(
        { error: 'token is required and must be a string.' },
        { status: 400 }
      );
    }

    const totp = await getTotpSecret(userId);
    if (totp.status === 'disabled') {
      return NextResponse.json(
        { error: 'Two-factor authentication is not enabled for this account.' },
        { status: 400 }
      );
    }
    if (totp.status === 'unavailable') {
      console.error('[POST /api/auth/totp/disable] TOTP secret unavailable for user', userId);
      return NextResponse.json(
        { error: 'Two-factor authentication is temporarily unavailable.' },
        { status: 500 }
      );
    }

    const valid = await verifyTotpToken(totp.secret, rawToken);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid authentication code.' }, { status: 400 });
    }

    await disableTotp(userId);

    const res = NextResponse.json({ ok: true });
    res.cookies.set(getTotpTrustCookieName(), '', {
      ...getTotpTrustCookieOptions(0),
      maxAge: 0,
    });
    return res;
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 404) {
      return NextResponse.json({ error: 'User profile not found.' }, { status: 404 });
    }
    console.error('[POST /api/auth/totp/disable]', err);
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
