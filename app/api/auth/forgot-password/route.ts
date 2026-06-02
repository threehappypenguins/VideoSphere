import { NextRequest, NextResponse } from 'next/server';
import { getUserPasswordAuthStateByEmail } from '@/lib/repositories/users';
import {
  FORGOT_PASSWORD_TOKEN_TTL_MS,
  buildPasswordResetUrl,
  isForgotPasswordRateLimited,
  issuePasswordResetToken,
  logForgotPasswordResetTokenToStdout,
} from '@/lib/auth/password-reset';

const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Handles POST requests for self-service forgot-password (log-based token flow).
 * @param req - The incoming request object.
 * @returns A generic success response that does not reveal account existence.
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

    const { email: rawEmail } = body as Record<string, unknown>;
    if (typeof rawEmail !== 'string') {
      return NextResponse.json(
        { error: 'Email is required and must be a string.' },
        { status: 400 }
      );
    }

    const email = rawEmail.trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    if (!EMAIL_FORMAT_RE.test(email)) {
      return NextResponse.json({ error: 'Email must be a valid email address.' }, { status: 400 });
    }

    const authState = await getUserPasswordAuthStateByEmail(email);
    if (authState?.supportsPasswordReset) {
      const rateLimited = await isForgotPasswordRateLimited(authState.userId);
      if (!rateLimited) {
        const { token, expiresAt } = await issuePasswordResetToken(
          authState.userId,
          FORGOT_PASSWORD_TOKEN_TTL_MS,
          'forgot-password'
        );
        const resetUrl = buildPasswordResetUrl(token, req);
        logForgotPasswordResetTokenToStdout(email, resetUrl, expiresAt);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/auth/forgot-password]', err);
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
