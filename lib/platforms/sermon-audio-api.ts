import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { SERMONAUDIO_API_BASE, sermonAudioJsonHeaders } from '@/lib/platforms/sermon-audio-http';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import type { ApiError } from '@/types';

export { SERMONAUDIO_API_BASE, sermonAudioJsonHeaders };

type SermonAudioConnectionResult =
  | { ok: true; apiKey: string; broadcasterId: string }
  | { ok: false; response: NextResponse };

/**
 * Resolves the authenticated user's SermonAudio connection for API proxy routes.
 * @param req - Incoming request (session auth).
 * @returns API key and broadcaster id, or an error response.
 */
export async function requireSermonAudioConnection(
  req: NextRequest
): Promise<SermonAudioConnectionResult> {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return { ok: false, response: NextResponse.json(errRes, { status: 401 }) };
  }

  const account = await getConnectedAccountWithTokens(userId, 'sermon_audio');
  if (!account) {
    const errRes: ApiError = {
      error: 'Not Found',
      message: 'SermonAudio is not connected',
      statusCode: 404,
    };
    return { ok: false, response: NextResponse.json(errRes, { status: 404 }) };
  }

  const broadcasterId = account.platformUserId.trim();
  if (!broadcasterId) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'SermonAudio broadcaster ID is missing on the connected account',
      statusCode: 400,
    };
    return { ok: false, response: NextResponse.json(errRes, { status: 400 }) };
  }

  const apiKey = account.accessToken.trim();
  if (!apiKey) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'SermonAudio API key is missing on the connected account',
      statusCode: 400,
    };
    return { ok: false, response: NextResponse.json(errRes, { status: 400 }) };
  }

  return { ok: true, apiKey, broadcasterId };
}
