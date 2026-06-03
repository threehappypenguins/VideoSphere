// =============================================================================
// POST /api/auth/login
// =============================================================================
// Verifies credentials against MongoDB and sets a signed JWT session cookie.
// When TOTP is enabled, returns a short-lived challenge token instead of a session.
// =============================================================================

import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { getTotpTrustCookieName } from '@/lib/auth-session-cookie';
import { issueSessionResponse } from '@/lib/auth/issue-session';
import { createTotpChallengeToken, verifyTotpTrustToken } from '@/lib/auth/totp-jwt';
import { getUserAuthCredentialsByEmail } from '@/lib/repositories/users';

// bcrypt hash for "not-a-real-password" (cost 10); used to keep compare timing
// similar when the email does not exist.
const DUMMY_PASSWORD_HASH = '$2b$10$C6UzMDM.H6dfI/f/IKcEeO5bVJY4UqVaki3P6KyHRxY6z3n9JVpaz';

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
    const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const validPassword = await bcrypt.compare(password, passwordHash);
    if (!user || !validPassword) {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    if (user.totpEnabled) {
      const trustToken = req.cookies.get(getTotpTrustCookieName())?.value;
      if (trustToken && (await verifyTotpTrustToken(trustToken, user.userId))) {
        return issueSessionResponse(user.userId, user.role);
      }

      const tempToken = await createTotpChallengeToken(user.userId);
      return NextResponse.json({ requiresTotp: true, tempToken }, { status: 200 });
    }

    return issueSessionResponse(user.userId, user.role);
  } catch (err) {
    console.error('[POST /api/auth/login]', err);
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
