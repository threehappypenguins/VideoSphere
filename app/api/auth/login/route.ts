// =============================================================================
// POST /api/auth/login
// =============================================================================
// Verifies credentials against MongoDB and sets a signed JWT session cookie.
// =============================================================================

import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookieName, getSessionCookieOptions } from '@/lib/auth-session-cookie';
import { getUserAuthCredentialsByEmail } from '@/lib/repositories/users';

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

    const { email: rawEmail, password: rawPassword } = body as Record<string, unknown>;
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

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 });
    }

    const user = await getUserAuthCredentialsByEmail(email);
    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    const token = await new SignJWT({ role: user.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.userId)
      .setIssuedAt()
      .setExpirationTime(`${getSessionCookieOptions().maxAge}s`)
      .sign(new TextEncoder().encode(jwtSecret));

    const res = NextResponse.json({ ok: true }, { status: 200 });
    res.cookies.set(getSessionCookieName(), token, getSessionCookieOptions());
    return res;
  } catch (err) {
    console.error('[POST /api/auth/login]', err);
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
