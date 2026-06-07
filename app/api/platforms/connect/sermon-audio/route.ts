import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { SERMONAUDIO_TOKEN_EXPIRY } from '@/lib/platforms/sermon-audio';
import { SERMONAUDIO_API_BASE } from '@/lib/platforms/sermon-audio-http';
import {
  createConnectedAccount,
  getConnectedAccount,
  updateConnection,
} from '@/lib/repositories/connected-accounts';
import type { ConnectedAccountPublic } from '@/types';

const SERMONAUDIO_BROADCASTERS_URL = `${SERMONAUDIO_API_BASE}/v2/node/broadcasters`;

interface ConnectSermonAudioBody {
  apiKey?: unknown;
  broadcasterID?: unknown;
  label?: unknown;
}

type SermonAudioVerificationFailure =
  | { kind: 'credentials'; status: number; details?: string }
  | { kind: 'upstream'; status: number; details?: string };

function classifySermonAudioVerificationFailure(
  status: number,
  details?: string
): SermonAudioVerificationFailure {
  if (status === 401 || status === 403 || status === 404) {
    return { kind: 'credentials', status, details };
  }
  return { kind: 'upstream', status, details };
}

function sermonAudioUpstreamResponseStatus(upstreamStatus: number): number {
  if (upstreamStatus === 429 || upstreamStatus === 503) {
    return 503;
  }
  return 502;
}

async function verifySermonAudioCredentials(
  apiKey: string,
  broadcasterID: string
): Promise<{ ok: true } | { ok: false; failure: SermonAudioVerificationFailure }> {
  const url = `${SERMONAUDIO_BROADCASTERS_URL}/${encodeURIComponent(broadcasterID)}`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Api-Key': apiKey,
        Accept: 'application/json',
      },
    });

    if (response.ok) {
      return { ok: true };
    }

    const details = await response.text().catch(() => undefined);
    return {
      ok: false,
      failure: classifySermonAudioVerificationFailure(response.status, details),
    };
  } catch (err) {
    return {
      ok: false,
      failure: {
        kind: 'upstream',
        status: 503,
        details: err instanceof Error ? err.message : undefined,
      },
    };
  }
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
    const { failure } = verification;
    if (failure.kind === 'credentials') {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'SERMONAUDIO_CREDENTIALS_INVALID',
            message: 'SermonAudio API key or broadcaster ID could not be verified.',
            statusCode: failure.status,
            ...(process.env.NODE_ENV === 'development' && failure.details
              ? { details: failure.details }
              : {}),
          },
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'SERMONAUDIO_UPSTREAM_UNAVAILABLE',
          message: 'SermonAudio is temporarily unavailable. Try again in a few minutes.',
          statusCode: failure.status,
          ...(process.env.NODE_ENV === 'development' && failure.details
            ? { details: failure.details }
            : {}),
        },
      },
      { status: sermonAudioUpstreamResponseStatus(failure.status) }
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
