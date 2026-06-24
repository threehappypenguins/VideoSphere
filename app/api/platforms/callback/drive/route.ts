import { NextRequest } from 'next/server';
import { getAppBaseUrl } from '@/lib/app-port';
import { GOOGLE_DRIVE_OAUTH_STATE_COOKIE } from '@/lib/platforms/oauth-state-cookies';
import { htmlRedirect } from '@/lib/api/html-redirect';
import { isTokenDecryptError } from '@/lib/crypto/token-encryption';
import {
  parseGoogleDrivePlatformUserId,
  serializeGoogleDrivePlatformUserId,
} from '@/lib/platforms/google-drive';
import {
  createConnectedAccount,
  getConnectedAccountRowId,
  getConnectedAccountWithTokens,
  updateConnection,
} from '@/lib/repositories/connected-accounts';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_ABOUT_URL =
  'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,permissionId)';

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface GoogleDriveAboutResponse {
  user?: {
    displayName?: string;
    emailAddress?: string;
    permissionId?: string;
  };
}

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns A response describing the request result.
 */
export async function GET(req: NextRequest) {
  const origin = getAppBaseUrl();
  const successUrl = `${origin}/profile/connections?success=google_drive&setup=backup_folder`;
  const failureUrl = `${origin}/profile/connections?error=google_drive`;

  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      '[GET /api/platforms/callback/drive] Missing GOOGLE_DRIVE_CLIENT_ID or GOOGLE_DRIVE_CLIENT_SECRET'
    );
    return htmlRedirect(failureUrl);
  }

  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    console.error('[GET /api/platforms/callback/drive] OAuth error from Google:', error);
    return htmlRedirect(failureUrl);
  }

  if (!code || !stateParam) {
    console.error('[GET /api/platforms/callback/drive] Missing code or state');
    return htmlRedirect(failureUrl);
  }

  const cookieValue = req.cookies.get(GOOGLE_DRIVE_OAUTH_STATE_COOKIE)?.value;
  if (!cookieValue) {
    console.error('[GET /api/platforms/callback/drive] CSRF state cookie missing');
    return htmlRedirect(failureUrl);
  }

  const pipeIndex = cookieValue.indexOf('|');
  if (pipeIndex === -1) {
    console.error('[GET /api/platforms/callback/drive] Malformed state cookie');
    return htmlRedirect(failureUrl);
  }

  const storedNonce = cookieValue.slice(0, pipeIndex);
  const userId = cookieValue.slice(pipeIndex + 1);

  if (storedNonce !== stateParam || !userId) {
    console.error('[GET /api/platforms/callback/drive] CSRF state mismatch');
    return htmlRedirect(failureUrl);
  }

  try {
    const redirectUri = `${origin}/api/platforms/callback/drive`;

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error('[GET /api/platforms/callback/drive] Token exchange failed:', body);
      return htmlRedirect(failureUrl);
    }

    const tokens = (await tokenRes.json()) as GoogleTokenResponse;
    if (!tokens.access_token) {
      console.error('[GET /api/platforms/callback/drive] No access_token in response');
      return htmlRedirect(failureUrl);
    }

    const aboutRes = await fetch(GOOGLE_DRIVE_ABOUT_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!aboutRes.ok) {
      const body = await aboutRes.text();
      console.error('[GET /api/platforms/callback/drive] About fetch failed:', body);
      return htmlRedirect(failureUrl);
    }

    const aboutData = (await aboutRes.json()) as GoogleDriveAboutResponse;
    const driveUser = aboutData.user;

    const platformUserId =
      driveUser?.permissionId?.trim() || driveUser?.emailAddress?.trim() || 'google-drive-user';
    const platformName =
      driveUser?.displayName?.trim() || driveUser?.emailAddress?.trim() || 'Google Drive';

    const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    let existingId: string | null = null;
    let existingRefreshToken = '';
    let existingPlatformUserId: string | null = null;

    // Best-effort: old rows may be encrypted with a different key version.
    // If token decryption fails, still proceed with reconnect using account id.
    try {
      const existingWithTokens = await getConnectedAccountWithTokens(userId, 'google_drive');
      if (existingWithTokens) {
        existingId = existingWithTokens.id;
        existingRefreshToken = existingWithTokens.refreshToken;
        existingPlatformUserId = existingWithTokens.platformUserId;
      }
    } catch (err) {
      if (!isTokenDecryptError(err)) {
        throw err;
      }

      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        '[GET /api/platforms/callback/drive] Could not decrypt existing tokens during reconnect; proceeding with upsert by id:',
        message
      );

      // Use minimal row lookup (no token decryption) to avoid noisy error logs
      const existing = await getConnectedAccountRowId(userId, 'google_drive');
      if (existing) {
        existingId = existing.id;
        existingPlatformUserId = existing.platformUserId;
      }
    }

    const refreshTokenToStore = tokens.refresh_token ?? existingRefreshToken;
    const preservedRootFolderId = existingPlatformUserId
      ? parseGoogleDrivePlatformUserId(existingPlatformUserId).rootFolderId
      : undefined;
    const serializedPlatformUserId = serializeGoogleDrivePlatformUserId(
      platformUserId,
      preservedRootFolderId
    );

    if (existingId) {
      await updateConnection(
        existingId,
        tokens.access_token,
        refreshTokenToStore,
        tokenExpiry,
        serializedPlatformUserId,
        platformName
      );
    } else {
      await createConnectedAccount({
        userId,
        platform: 'google_drive',
        accessToken: tokens.access_token,
        refreshToken: refreshTokenToStore,
        tokenExpiry,
        platformUserId: serializedPlatformUserId,
        platformName,
      });
    }

    return htmlRedirect(successUrl, GOOGLE_DRIVE_OAUTH_STATE_COOKIE);
  } catch (err) {
    console.error('[GET /api/platforms/callback/drive] Unexpected error:', err);
    return htmlRedirect(failureUrl);
  }
}
