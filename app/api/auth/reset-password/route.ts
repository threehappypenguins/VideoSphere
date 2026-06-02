import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { validatePassword, OAUTH_PASSWORD_RESET_MESSAGE } from '@/lib/auth/password';
import { finalizePasswordReset, findUsablePasswordResetToken } from '@/lib/auth/password-reset';
import { getUserPasswordAuthStateById } from '@/lib/repositories/users';

const INVALID_RESET_TOKEN_MESSAGE = 'This reset link is invalid or has expired.';

/**
 * Handles POST requests to reset a password using a single-use token.
 * @param req - The incoming request object.
 * @returns A response describing the request result.
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

    const { token: rawToken, newPassword: rawNewPassword } = body as Record<string, unknown>;
    if (typeof rawToken !== 'string' || typeof rawNewPassword !== 'string') {
      return NextResponse.json(
        { error: 'Token and newPassword are required and must be strings.' },
        { status: 400 }
      );
    }

    const token = rawToken.trim();
    const newPassword = rawNewPassword;

    if (!token) {
      return NextResponse.json({ error: 'Token is required.' }, { status: 400 });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    const tokenRecord = await findUsablePasswordResetToken(token);
    if (!tokenRecord) {
      return NextResponse.json({ error: INVALID_RESET_TOKEN_MESSAGE }, { status: 400 });
    }

    const authState = await getUserPasswordAuthStateById(tokenRecord.userId);
    if (!authState) {
      return NextResponse.json({ error: INVALID_RESET_TOKEN_MESSAGE }, { status: 400 });
    }

    if (!authState.supportsPasswordReset) {
      return NextResponse.json({ error: OAUTH_PASSWORD_RESET_MESSAGE }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const applied = await finalizePasswordReset(token, passwordHash);
    if (!applied) {
      return NextResponse.json({ error: INVALID_RESET_TOKEN_MESSAGE }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/auth/reset-password]', err);
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
