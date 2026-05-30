// =============================================================================
// POST /api/auth/register
// =============================================================================
// Creates a MongoDB user document with a hashed password and sets a JWT cookie.
// =============================================================================

import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { createUser } from '@/lib/repositories/users';
import { getSessionCookieName, getSessionCookieOptions } from '@/lib/auth-session-cookie';

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
    } = body as Record<string, unknown>;

    if (typeof rawEmail !== 'string' || typeof rawPassword !== 'string') {
      return NextResponse.json(
        { error: 'Email and password are required and must be strings.' },
        { status: 400 }
      );
    }

    const email = rawEmail.trim().toLowerCase();
    const password = rawPassword;

    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    if (!EMAIL_FORMAT_RE.test(email)) {
      return NextResponse.json({ error: 'Email must be a valid email address.' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters.' },
        { status: 400 }
      );
    }

    if (rawName !== undefined && rawName !== null && typeof rawName !== 'string') {
      return NextResponse.json({ error: 'name must be a string when provided.' }, { status: 400 });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 });
    }

    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
    }

    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);

    try {
      await createUser({
        userId,
        email,
        name,
        passwordHash,
        isSupporter: false,
        hasCompletedOnboarding: false,
        role: 'user',
      });
    } catch (err: unknown) {
      const mongoErr = err as { code?: number; message?: string };
      if (mongoErr.code === 11000 || mongoErr.message?.toLowerCase().includes('duplicate')) {
        return NextResponse.json(
          { error: 'Email already registered. Please sign in instead.' },
          { status: 409 }
        );
      }
      throw err;
    }

    const token = await new SignJWT({ role: 'user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${getSessionCookieOptions().maxAge}s`)
      .sign(new TextEncoder().encode(jwtSecret));

    const response = NextResponse.json(
      { message: 'Account created successfully.', userId },
      { status: 201 }
    );

    response.cookies.set(getSessionCookieName(), token, getSessionCookieOptions());

    return response;
  } catch (err: unknown) {
    console.error('[POST /api/auth/register]', err);
    const publicMessage = 'An unexpected error occurred. Please try again later.';
    return NextResponse.json({ error: publicMessage }, { status: 500 });
  }
}
