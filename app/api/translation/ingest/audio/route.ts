// =============================================================================
// POST /api/translation/ingest/audio
// DELETE /api/translation/ingest/audio  (stop ingest)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedSessionUserId } from '@/lib/api/auth';
import {
  getChannelByUserId,
  capabilityInputFromDoc,
} from '@/lib/repositories/live-translation-channels';
import { isTranslationReady } from '@/lib/translation/capabilities';
import { enqueueOwnerPcm, markIngestStopped } from '@/lib/translation/session-hub';
import type { ApiError } from '@/types';

/**
 * Accepts owner microphone PCM chunks for shared STT.
 * Body JSON: { pcmBase64: string, sampleRate?: number }
 * @param req - Incoming request.
 * @returns Acceptance status.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthenticatedSessionUserId(req);
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Not authenticated', statusCode: 401 } satisfies ApiError,
        { status: 401 }
      );
    }

    const channel = await getChannelByUserId(userId);
    if (!channel) {
      return NextResponse.json(
        {
          error: 'Not Found',
          message: 'Translation channel not found',
          statusCode: 404,
        } satisfies ApiError,
        { status: 404 }
      );
    }

    const ready = isTranslationReady(capabilityInputFromDoc(channel));
    if (!ready) {
      return NextResponse.json(
        {
          error: 'Precondition Failed',
          message:
            'Configure STT (OpenRouter or Groq) and OpenRouter translation before ingesting audio.',
          statusCode: 412,
        } satisfies ApiError,
        { status: 412 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Invalid JSON body', statusCode: 400 } satisfies ApiError,
        { status: 400 }
      );
    }

    if (body === null || typeof body !== 'object') {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'Body must be a JSON object',
          statusCode: 400,
        } satisfies ApiError,
        { status: 400 }
      );
    }

    const { pcmBase64, sampleRate } = body as {
      pcmBase64?: unknown;
      sampleRate?: unknown;
    };

    if (typeof pcmBase64 !== 'string' || !pcmBase64.trim()) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'pcmBase64 is required',
          statusCode: 400,
        } satisfies ApiError,
        { status: 400 }
      );
    }

    const rate =
      typeof sampleRate === 'number' && Number.isFinite(sampleRate) && sampleRate > 0
        ? Math.floor(sampleRate)
        : 16000;

    let pcm: Buffer;
    try {
      pcm = Buffer.from(pcmBase64, 'base64');
    } catch {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'pcmBase64 must be valid base64',
          statusCode: 400,
        } satisfies ApiError,
        { status: 400 }
      );
    }

    if (pcm.length < 2) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    enqueueOwnerPcm(channel._id, userId, pcm, rate);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[POST /api/translation/ingest/audio]', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to ingest audio',
        statusCode: 500,
      } satisfies ApiError,
      { status: 500 }
    );
  }
}

/**
 * Stops owner ingest for the channel.
 * @param req - Incoming request.
 * @returns Confirmation.
 */
export async function DELETE(req: NextRequest) {
  try {
    const userId = await getAuthenticatedSessionUserId(req);
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Not authenticated', statusCode: 401 } satisfies ApiError,
        { status: 401 }
      );
    }
    const channel = await getChannelByUserId(userId);
    if (!channel) {
      return NextResponse.json(
        {
          error: 'Not Found',
          message: 'Translation channel not found',
          statusCode: 404,
        } satisfies ApiError,
        { status: 404 }
      );
    }
    markIngestStopped(channel._id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[DELETE /api/translation/ingest/audio]', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to stop ingest',
        statusCode: 500,
      } satisfies ApiError,
      { status: 500 }
    );
  }
}
