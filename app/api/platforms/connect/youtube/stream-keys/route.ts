import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  getConnectedAccount,
  updateYouTubeStreamKeys,
} from '@/lib/repositories/connected-accounts';

interface YouTubeStreamKeysBody {
  mainStreamKey?: unknown;
  tempStreamKey?: unknown;
}

/**
 * Stores encrypted YouTube main/temporary stream keys for the authenticated user.
 * @param req - Request with optional plaintext stream key fields.
 * @returns JSON success or structured error response.
 */
export async function POST(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated.' } },
      { status: 401 }
    );
  }

  let body: YouTubeStreamKeysBody;
  try {
    body = (await req.json()) as YouTubeStreamKeysBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } },
      { status: 400 }
    );
  }

  const fields: { mainStreamKey?: string; tempStreamKey?: string } = {};

  if ('mainStreamKey' in body) {
    if (typeof body.mainStreamKey !== 'string') {
      return NextResponse.json(
        {
          ok: false,
          error: { code: 'INVALID_MAIN_STREAM_KEY', message: 'mainStreamKey must be a string.' },
        },
        { status: 400 }
      );
    }
    fields.mainStreamKey = body.mainStreamKey.trim();
  }

  if ('tempStreamKey' in body) {
    if (typeof body.tempStreamKey !== 'string') {
      return NextResponse.json(
        {
          ok: false,
          error: { code: 'INVALID_TEMP_STREAM_KEY', message: 'tempStreamKey must be a string.' },
        },
        { status: 400 }
      );
    }
    fields.tempStreamKey = body.tempStreamKey.trim();
  }

  try {
    const account = await getConnectedAccount(userId, 'youtube');
    if (!account) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'YOUTUBE_NOT_CONNECTED',
            message: 'Connect your YouTube account first.',
          },
        },
        { status: 400 }
      );
    }

    const updated = await updateYouTubeStreamKeys(userId, fields);
    if (!updated) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'YOUTUBE_STREAM_KEYS_UPDATE_FAILED',
            message: 'Failed to save YouTube stream keys.',
          },
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[POST /api/platforms/connect/youtube/stream-keys] Unexpected error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'YOUTUBE_STREAM_KEYS_UPDATE_FAILED',
          message: 'Failed to save YouTube stream keys.',
        },
      },
      { status: 500 }
    );
  }
}
