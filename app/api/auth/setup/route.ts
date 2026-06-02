import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookieName, getSessionCookieOptions } from '@/lib/auth-session-cookie';
import { validatePassword } from '@/lib/auth/password';
import {
  consumeSetupToken,
  hasAnyUsers,
  isSetupTokenValid,
  releaseSetupToken,
} from '@/lib/repositories/invites';
import { createUser } from '@/lib/repositories/users';

const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Handles POST requests for this route.
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

    const {
      email: rawEmail,
      password: rawPassword,
      name: rawName,
      token: rawToken,
    } = body as Record<string, unknown>;

    if (
      typeof rawEmail !== 'string' ||
      typeof rawPassword !== 'string' ||
      typeof rawToken !== 'string' ||
      typeof rawName !== 'string'
    ) {
      return NextResponse.json(
        { error: 'Name, email, password, and token are required and must be strings.' },
        { status: 400 }
      );
    }

    const email = rawEmail.trim().toLowerCase();
    const password = rawPassword;
    const name = rawName.trim();
    const token = rawToken.trim();

    if (!name) {
      return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
    }

    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    if (!EMAIL_FORMAT_RE.test(email)) {
      return NextResponse.json({ error: 'Email must be a valid email address.' }, { status: 400 });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    if (!token) {
      return NextResponse.json({ error: 'Setup token is required.' }, { status: 400 });
    }

    const existingUsers = await hasAnyUsers();
    if (existingUsers) {
      return NextResponse.json({ error: 'Setup is already complete.' }, { status: 403 });
    }

    const validToken = await isSetupTokenValid(token);
    if (!validToken) {
      return NextResponse.json({ error: 'Setup token is invalid.' }, { status: 404 });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 });
    }

    const userId = randomUUID();
    const consumed = await consumeSetupToken(token, userId);
    if (!consumed) {
      return NextResponse.json({ error: 'Setup token is no longer valid.' }, { status: 409 });
    }

    try {
      const passwordHash = await bcrypt.hash(password, 10);

      await createUser({
        userId,
        email,
        name,
        passwordHash,
        hasCompletedOnboarding: false,
        role: 'admin',
        authProvider: 'password',
      });
    } catch (error) {
      await releaseSetupToken(token, userId);
      throw error;
    }

    const tokenJwt = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${getSessionCookieOptions().maxAge}s`)
      .sign(new TextEncoder().encode(jwtSecret));

    const response = NextResponse.json(
      { message: 'Setup completed successfully.', userId },
      { status: 201 }
    );

    response.cookies.set(getSessionCookieName(), tokenJwt, getSessionCookieOptions());

    return response;
  } catch (err: unknown) {
    const mongoErr = err as { code?: number; message?: string };
    if (mongoErr.code === 11000 || mongoErr.message?.toLowerCase().includes('duplicate')) {
      return NextResponse.json(
        { error: 'Email already registered. Please sign in instead.' },
        { status: 409 }
      );
    }

    console.error('[POST /api/auth/setup]', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again later.' },
      { status: 500 }
    );
  }
}
