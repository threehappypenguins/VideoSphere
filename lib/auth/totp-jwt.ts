import { jwtVerify, SignJWT } from 'jose';

const TOTP_CHALLENGE_TTL_SECONDS = 60 * 5;

/**
 * Creates a short-lived JWT for the post-password TOTP login challenge.
 * @param userId - Authenticated user id pending second factor.
 * @returns Signed JWT with `purpose: 'totp-challenge'`.
 */
export async function createTotpChallengeToken(userId: string): Promise<string> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not configured.');
  }

  return new SignJWT({ purpose: 'totp-challenge' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${TOTP_CHALLENGE_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(jwtSecret));
}

/**
 * Validates a TOTP challenge JWT and returns the encoded user id.
 * @param token - JWT from the login challenge step.
 * @returns User id when valid; otherwise null.
 */
export async function verifyTotpChallengeToken(token: string): Promise<string | null> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return null;

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret));
    if (payload.purpose !== 'totp-challenge') return null;
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Creates a signed JWT for the TOTP "remember this device" trust cookie.
 * @param userId - User id to bind to the trust token.
 * @param maxAgeSeconds - Cookie lifetime in seconds.
 * @returns Signed JWT with `purpose: 'totp-trust'`.
 */
export async function createTotpTrustToken(userId: string, maxAgeSeconds: number): Promise<string> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not configured.');
  }

  return new SignJWT({ purpose: 'totp-trust' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(new TextEncoder().encode(jwtSecret));
}

/**
 * Validates a TOTP trust cookie JWT for a specific user.
 * @param token - Trust cookie value.
 * @param userId - Expected user id.
 * @returns True when the token is valid for the user.
 */
export async function verifyTotpTrustToken(token: string, userId: string): Promise<boolean> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return false;

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret));
    return payload.purpose === 'totp-trust' && payload.sub === userId;
  } catch {
    return false;
  }
}
