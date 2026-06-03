import { SignJWT } from 'jose';
import { NextResponse } from 'next/server';
import { getSessionCookieName, getSessionCookieOptions } from '@/lib/auth-session-cookie';
import type { UserRole } from '@/types';

/**
 * Issues a signed session JWT and sets the httpOnly session cookie on the response.
 * @param userId - Authenticated user id.
 * @param role - User role claim stored in the JWT.
 * @returns JSON `{ ok: true }` response with session cookie attached.
 */
export async function issueSessionResponse(userId: string, role: UserRole): Promise<NextResponse> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 });
  }

  const token = await new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${getSessionCookieOptions().maxAge}s`)
    .sign(new TextEncoder().encode(jwtSecret));

  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set(getSessionCookieName(), token, getSessionCookieOptions());
  return res;
}
