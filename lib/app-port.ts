/** Default HTTP port for VideoSphere (local dev, Docker, and compose). */
export const APP_PORT = 9624;

/** Fallback public base URL when `NEXT_PUBLIC_APP_URL` is unset. */
export const DEFAULT_LOCAL_APP_URL = `http://localhost:${APP_PORT}`;

/**
 * Resolves the public app base URL from `NEXT_PUBLIC_APP_URL`.
 * Use for OAuth redirect URIs and outbound links — not `req.nextUrl.origin`, which
 * behind a reverse proxy often reflects the internal host (e.g. `0.0.0.0:9624`).
 * @returns Normalized base URL without a trailing slash.
 */
export function getAppBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, '');

  return DEFAULT_LOCAL_APP_URL;
}

/**
 * Loopback origin for server-side fetches from `proxy.ts` to `/api/*` routes.
 * Uses `request.url` for browser redirects; use this for in-process session checks so
 * the container does not need to reach its own public URL (hairpin NAT / NPM).
 * @returns `http://127.0.0.1:<PORT>` for the running Next.js server.
 */
export function getInternalAppOrigin(): string {
  const port = process.env.PORT?.trim() || String(APP_PORT);
  return `http://127.0.0.1:${port}`;
}
