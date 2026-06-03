import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedSessionUserId } from '@/lib/api/auth';
import { validatePassword } from '@/lib/auth/password';
import {
  getUserById,
  revertGoogleAuthToPassword,
  revokeStoredGoogleAuthForUser,
} from '@/lib/repositories/users';

/**
 * Disconnects Google OAuth from the logged-in account and sets a new password.
 * @param req - The incoming request object.
 * @returns JSON success or validation error.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthenticatedSessionUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const profile = await getUserById(userId);
    if (!profile) {
      return NextResponse.json({ error: 'User profile not found.' }, { status: 404 });
    }

    if (profile.authProvider !== 'google') {
      return NextResponse.json(
        { error: 'This account is not linked to Google sign-in.' },
        { status: 400 }
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

    const { password: rawPassword, confirmPassword: rawConfirmPassword } = body as Record<
      string,
      unknown
    >;

    if (typeof rawPassword !== 'string' || typeof rawConfirmPassword !== 'string') {
      return NextResponse.json(
        { error: 'Password and confirmPassword are required and must be strings.' },
        { status: 400 }
      );
    }

    if (rawPassword !== rawConfirmPassword) {
      return NextResponse.json({ error: 'Passwords do not match.' }, { status: 400 });
    }

    const passwordError = validatePassword(rawPassword);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    await revokeStoredGoogleAuthForUser(userId);

    const passwordHash = await bcrypt.hash(rawPassword, 10);
    await revertGoogleAuthToPassword(userId, passwordHash);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 404) {
      return NextResponse.json({ error: 'User profile not found.' }, { status: 404 });
    }
    console.error('[POST /api/auth/oauth/disconnect]', err);
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
