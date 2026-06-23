/** Default HTTP port for VideoSphere (local dev, Docker, and compose). */
export const APP_PORT = 9624;

/** Fallback public base URL when `NEXT_PUBLIC_APP_URL` is unset. */
export const DEFAULT_LOCAL_APP_URL = `http://localhost:${APP_PORT}`;
