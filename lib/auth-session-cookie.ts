// =============================================================================
// APPWRITE SESSION COOKIE (SSR)
// =============================================================================
// Server-side session cookie options per Appwrite Next.js SSR guidance.
// secure is false in development so localhost works; always true in production.
// https://appwrite.io/docs/tutorials/nextjs-ssr-auth/step-1
// =============================================================================

export function getSessionCookieName(projectId: string): string {
  return `a_session_${projectId}`;
}

export function getSessionCookieOptions(): {
  path: string;
  httpOnly: boolean;
  sameSite: 'strict';
  secure: boolean;
} {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
  };
}
