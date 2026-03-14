// =============================================================================
// HTML REDIRECT HELPER
// =============================================================================
// Returns a 200 HTML response that immediately navigates the browser to `url`
// via JavaScript (window.location.replace) and a <meta refresh> fallback.
//
// WHY: OAuth callbacks arrive via a cross-site redirect chain (Google/Vimeo →
// our callback URL). Browsers apply sameSite=strict semantics throughout the
// chain, so the Appwrite session cookie is dropped. Returning a 200 HTML page
// here "lands" the browser on our origin, ending the cross-site chain. The
// subsequent JS navigation to /profile/... is a fresh same-origin request where
// sameSite=strict cookies ARE sent.
//
// The `clearCookieName` option removes a single httpOnly cookie (e.g. the
// short-lived CSRF nonce set during the OAuth initiation step).
// =============================================================================

/**
 * @param url            The URL to navigate to.
 * @param clearCookieName  Optional httpOnly cookie to clear (Max-Age=0).
 */
export function htmlRedirect(url: string, clearCookieName?: string): Response {
  const safeUrl = JSON.stringify(url);
  // Encode for HTML attribute context: prevent attribute breakout if the URL
  // contains quotes, ampersands, or angle brackets (e.g. multi-param query strings).
  const attrUrl = url
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
  if (clearCookieName) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    headers.set(
      'Set-Cookie',
      `${clearCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`
    );
  }

  return new Response(
    `<!DOCTYPE html><html><head>` +
      `<meta http-equiv="refresh" content="0;url=${attrUrl}">` +
      `<script>window.location.replace(${safeUrl})</script>` +
      `</head><body></body></html>`,
    { status: 200, headers }
  );
}
