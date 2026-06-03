import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { generateTotpSetup } from '@/lib/auth/totp';
import { getTotpSecret, getUserById } from '@/lib/repositories/users';

/**
 * Starts TOTP setup by generating a new secret and otpauth URI (not persisted yet).
 * @param req - The incoming request object.
 * @returns Secret and otpauth URI for QR/manual entry.
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

    const totp = await getTotpSecret(userId);
    if (totp.status === 'available') {
      return NextResponse.json(
        { error: 'Two-factor authentication is already enabled for this account.' },
        { status: 400 }
      );
    }

    const { secret, otpauthUri } = generateTotpSetup(profile.email);

    return NextResponse.json({ secret, otpauthUri });
  } catch (err) {
    console.error('[POST /api/auth/totp/setup/start]', err);
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
