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
  sameSite: 'lax';
  secure: boolean;
} {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    path: '/',
    httpOnly: true,
    // Use 'lax' (not 'strict') so the session cookie is included when the browser
    // is redirected back from a cross-site OAuth provider (e.g. Google → localhost).
    // 'strict' would drop the cookie on the return redirect, breaking OAuth flows.
    sameSite: 'lax',
    secure: isProduction,
  };
}
