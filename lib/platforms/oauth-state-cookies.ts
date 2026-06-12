/**
 * httpOnly cookie names for platform OAuth CSRF state during connect redirects.
 * Kept out of route modules so Next.js route type checks stay valid.
 */

/** Cookie storing Vimeo OAuth `state` nonce during connect. */
export const VIMEO_OAUTH_STATE_COOKIE = 'vimeo_oauth_state';

/** Cookie storing YouTube (Google) OAuth `state` nonce during connect. */
export const YOUTUBE_OAUTH_STATE_COOKIE = 'youtube_oauth_state';

/** Cookie storing Google Drive OAuth `state` nonce during connect. */
export const GOOGLE_DRIVE_OAUTH_STATE_COOKIE = 'google_drive_oauth_state';

/** Cookie storing Facebook OAuth `state` nonce during connect. */
export const FACEBOOK_OAUTH_STATE_COOKIE = 'facebook_oauth_state';
