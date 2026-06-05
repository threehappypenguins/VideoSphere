import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { SERMONAUDIO_TOKEN_EXPIRY } from '@/lib/platforms/sermon-audio';
import {
  createConnectedAccount,
  getConnectedAccount,
  updateConnection,
} from '@/lib/repositories/connected-accounts';
import type { ConnectedAccountPublic } from '@/types';

const SERMONAUDIO_BROADCASTERS_URL = 'https://api.sermonaudio.com/v2/node/broadcasters';

interface ConnectSermonAudioBody {
  apiKey?: unknown;
  broadcasterID?: unknown;
  label?: unknown;
}

async function verifySermonAudioCredentials(
  apiKey: string,
  broadcasterID: string
): Promise<{ ok: true } | { ok: false; status: number; details?: string }> {
  const url = `${SERMONAUDIO_BROADCASTERS_URL}/${encodeURIComponent(broadcasterID)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Api-Key': apiKey,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      details: await response.text().catch(() => undefined),
    };
  }

  return { ok: true };
}

/**
 * Connects or updates a SermonAudio account using an API key and broadcaster id.
 * @param req - Incoming POST request with `{ apiKey, broadcasterID, label? }`.
 * @returns JSON with the public connected account shape, or a structured error.
 */
export async function POST(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated.' } },
      { status: 401 }
    );
  }

  let body: ConnectSermonAudioBody;
  try {
    body = (await req.json()) as ConnectSermonAudioBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } },
      { status: 400 }
    );
  }

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const broadcasterID = typeof body.broadcasterID === 'string' ? body.broadcasterID.trim() : '';
  const label = typeof body.label === 'string' ? body.label.trim() : '';

  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'SERMONAUDIO_API_KEY_REQUIRED', message: 'apiKey is required.' },
      },
      { status: 400 }
    );
  }

  if (!broadcasterID) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'SERMONAUDIO_BROADCASTER_ID_REQUIRED',
          message: 'broadcasterID is required.',
        },
      },
      { status: 400 }
    );
  }

  const verification = await verifySermonAudioCredentials(apiKey, broadcasterID);
  if (verification.ok === false) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'SERMONAUDIO_CREDENTIALS_INVALID',
          message: 'SermonAudio API key or broadcaster ID could not be verified.',
          statusCode: verification.status,
          ...(process.env.NODE_ENV === 'development' && verification.details
            ? { details: verification.details }
            : {}),
        },
      },
      { status: 400 }
    );
  }

  const platformName = label || broadcasterID;

  try {
    const existing = await getConnectedAccount(userId, 'sermon_audio');
    let account: ConnectedAccountPublic | null;

    if (existing) {
      account = await updateConnection(
        existing.id,
        apiKey,
        '',
        SERMONAUDIO_TOKEN_EXPIRY,
        broadcasterID,
        platformName
      );
      if (!account) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: 'SERMONAUDIO_UPDATE_FAILED',
              message: 'Failed to update the SermonAudio connection.',
            },
          },
          { status: 500 }
        );
      }
    } else {
      account = await createConnectedAccount({
        userId,
        platform: 'sermon_audio',
        accessToken: apiKey,
        refreshToken: '',
        tokenExpiry: SERMONAUDIO_TOKEN_EXPIRY,
        platformUserId: broadcasterID,
        platformName,
      });
    }

    return NextResponse.json({ ok: true, account }, { status: 200 });
  } catch (err) {
    console.error('[POST /api/platforms/connect/sermon-audio] Unexpected error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'SERMONAUDIO_CONNECT_FAILED',
          message: 'Failed to save the SermonAudio connection.',
        },
      },
      { status: 500 }
    );
  }
}
