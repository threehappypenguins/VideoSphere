import { generateSecret, generateURI, verify } from 'otplib';

const TOTP_ISSUER = process.env.NEXT_PUBLIC_APP_NAME || 'VideoSphere';

/**
 * Generates a new TOTP secret and matching `otpauth://` URI for authenticator setup.
 * @param email - Account email shown in the authenticator app label.
 * @returns Base32 secret and URI for QR/manual entry.
 */
export function generateTotpSetup(email: string): { secret: string; otpauthUri: string } {
  const secret = generateSecret();
  const otpauthUri = generateURI({
    issuer: TOTP_ISSUER,
    label: email,
    secret,
  });
  return { secret, otpauthUri };
}

/**
 * Verifies a 6-digit TOTP code against a plaintext Base32 secret.
 * @param secret - Plaintext TOTP secret.
 * @param token - User-entered authenticator code.
 * @returns True when the code is valid within the default time window.
 */
export async function verifyTotpToken(secret: string, token: string): Promise<boolean> {
  const normalized = token.trim();
  if (!/^\d{6}$/.test(normalized)) {
    return false;
  }
  const result = await verify({ secret, token: normalized });
  return result.valid;
}
