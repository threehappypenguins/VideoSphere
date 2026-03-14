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
  // JSON.stringify alone does not make a string safe to embed inside a <script>
  // tag: a URL containing "</script>" would close the tag early, and Unicode
  // line separators (U+2028, U+2029) are invalid in JS string literals.
  // Replacing these with their Unicode escape sequences is safe because JS
  // evaluates them identically while the HTML parser never sees the raw chars.
  // This is the same technique used by Next.js / React for JSON in <script> tags.
  const safeUrl = JSON.stringify(url)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  // Encode for the <meta http-equiv="refresh" content="0;url=..."> attribute.
  //
  // In that attribute the parser treats ';' as a directive separator (so a URL
  // containing ";url=evil" would silently override the redirect target) and
  // CR/LF can truncate the attribute or inject additional HTML attributes.
  //
  // We therefore:
  //   1. Strip bare CR and LF (they have no valid role in a URL here).
  //   2. Percent-encode ';' so it cannot be mistaken for a directive separator
  //      (RFC 3986 allows ';' unencoded in query strings, but encodes to %3B).
  //   3. HTML-entity-encode the remaining special characters to prevent
  //      attribute context breakout (quotes, angle brackets, ampersands).
  //
  // The JS path (safeUrl / window.location.replace) is unaffected.
  const attrUrl = url
    .replace(/[\r\n]/g, '') // strip CR/LF — no valid use; prevents attr injection
    .replace(/;/g, '%3B') // meta-refresh directive separator
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    // Prevent browsers and intermediaries from caching the OAuth callback HTML.
    // A cached response could replay the redirect (and its Set-Cookie) on the
    // next visit, leading to stale session state or CSRF token reuse.
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
  });
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
