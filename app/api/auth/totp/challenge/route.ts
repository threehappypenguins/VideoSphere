import { NextRequest, NextResponse } from 'next/server';
import {
  getTotpTrustCookieName,
  getTotpTrustCookieOptions,
  TOTP_TRUST_MAX_AGE_SECONDS,
  type TotpRememberDeviceDuration,
} from '@/lib/auth-session-cookie';
import { issueSessionResponse } from '@/lib/auth/issue-session';
import { createTotpTrustToken, verifyTotpChallengeToken } from '@/lib/auth/totp-jwt';
import { verifyTotpToken } from '@/lib/auth/totp';
import { getTotpSecret, getUserById } from '@/lib/repositories/users';

function isRememberDuration(value: unknown): value is TotpRememberDeviceDuration {
  return value === '30d' || value === '1y' || value === 'none';
}

/**
 * Completes login for accounts with TOTP enabled after password verification.
 * @param req - The incoming request object.
 * @returns Session cookie on success.
 */
export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    if (body === null || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body must be a JSON object.' }, { status: 400 });
    }

    const {
      tempToken: rawTempToken,
      token: rawToken,
      rememberDevice: rawRememberDevice,
    } = body as Record<string, unknown>;

    if (typeof rawTempToken !== 'string' || typeof rawToken !== 'string') {
      return NextResponse.json(
        { error: 'tempToken and token are required and must be strings.' },
        { status: 400 }
      );
    }

    if (rawRememberDevice !== undefined && !isRememberDuration(rawRememberDevice)) {
      return NextResponse.json(
        { error: 'rememberDevice must be one of: 30d, 1y, none.' },
        { status: 400 }
      );
    }

    const rememberDevice: TotpRememberDeviceDuration = isRememberDuration(rawRememberDevice)
      ? rawRememberDevice
      : 'none';

    const userId = await verifyTotpChallengeToken(rawTempToken);
    if (!userId) {
      return NextResponse.json({ error: 'Invalid or expired login challenge.' }, { status: 401 });
    }

    const profile = await getUserById(userId);
    if (!profile) {
      return NextResponse.json({ error: 'User profile not found.' }, { status: 404 });
    }

    const totp = await getTotpSecret(userId);
    if (totp.status === 'disabled') {
      return NextResponse.json(
        { error: 'Two-factor authentication is not enabled for this account.' },
        { status: 400 }
      );
    }
    if (totp.status === 'unavailable') {
      console.error('[POST /api/auth/totp/challenge] TOTP secret unavailable for user', userId);
      return NextResponse.json(
        { error: 'Two-factor authentication is temporarily unavailable.' },
        { status: 500 }
      );
    }

    const valid = await verifyTotpToken(totp.secret, rawToken);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid authentication code.' }, { status: 401 });
    }

    const res = await issueSessionResponse(userId, profile.role);
    if (res.status !== 200) {
      return res;
    }

    if (rememberDevice !== 'none') {
      const maxAge = TOTP_TRUST_MAX_AGE_SECONDS[rememberDevice];
      const trustToken = await createTotpTrustToken(userId, maxAge);
      res.cookies.set(getTotpTrustCookieName(), trustToken, getTotpTrustCookieOptions(maxAge));
    }

    return res;
  } catch (err) {
    console.error('[POST /api/auth/totp/challenge]', err);
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
