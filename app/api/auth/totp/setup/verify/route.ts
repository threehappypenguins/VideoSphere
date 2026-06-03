import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { verifyTotpToken } from '@/lib/auth/totp';
import { encryptToken } from '@/lib/crypto/token-encryption';
import { enableTotp, getTotpSecret, getUserById } from '@/lib/repositories/users';

/**
 * Verifies a TOTP code against a pending secret and enables two-factor auth.
 * @param req - The incoming request object.
 * @returns JSON success when the code is valid and TOTP is enabled.
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

    const { secret: rawSecret, token: rawToken } = body as Record<string, unknown>;
    if (typeof rawSecret !== 'string' || typeof rawToken !== 'string') {
      return NextResponse.json(
        { error: 'secret and token are required and must be strings.' },
        { status: 400 }
      );
    }

    const totp = await getTotpSecret(userId);
    if (totp.status === 'available') {
      return NextResponse.json(
        { error: 'Two-factor authentication is already enabled for this account.' },
        { status: 400 }
      );
    }

    const valid = await verifyTotpToken(rawSecret.trim(), rawToken);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid authentication code.' }, { status: 400 });
    }

    const encryptedSecret = encryptToken(rawSecret.trim());
    await enableTotp(userId, encryptedSecret);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 404) {
      return NextResponse.json({ error: 'User profile not found.' }, { status: 404 });
    }
    console.error('[POST /api/auth/totp/setup/verify]', err);
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
