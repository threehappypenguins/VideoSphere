// =============================================================================
// POST /api/translation/gcp-voice-preview — short MP3 sample for a TTS voice
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedSessionUserId } from '@/lib/api/auth';
import { getRuntimeSecretsForUser } from '@/lib/repositories/live-translation-channels';
import { synthesizeSpeechWithGcp } from '@/lib/translation/gcp-tts';
import { gcpTtsPreviewTextForLanguage } from '@/lib/translation/gcp-tts-preview';
import { languageCodeHintFromVoiceName } from '@/lib/translation/gcp-tts-voices';
import type { ApiError } from '@/types';

/**
 * Synthesizes a short preview clip for a GCP TTS voice using the owner’s SA.
 * @param req - JSON body: `voiceName`, optional `language`, optional `gcpServiceAccountJson`.
 * @returns `audio/mpeg` bytes, or a JSON error.
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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'Invalid JSON body',
          statusCode: 400,
        } satisfies ApiError,
        { status: 400 }
      );
    }

    const raw = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const voiceName = typeof raw.voiceName === 'string' ? raw.voiceName.trim() : '';
    const language = typeof raw.language === 'string' ? raw.language.trim() : '';
    let serviceAccountJson =
      typeof raw.gcpServiceAccountJson === 'string' ? raw.gcpServiceAccountJson.trim() : '';

    if (!voiceName) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'Select a voice to preview.',
          fields: ['ttsVoice'],
          statusCode: 400,
        } satisfies ApiError & { fields: string[] },
        { status: 400 }
      );
    }

    if (!serviceAccountJson) {
      const secrets = await getRuntimeSecretsForUser(userId);
      serviceAccountJson = secrets?.gcpServiceAccountJson?.trim() || '';
    }

    if (!serviceAccountJson) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'Upload or paste a Google Cloud service account JSON first.',
          fields: ['gcpJson'],
          statusCode: 400,
        } satisfies ApiError & { fields: string[] },
        { status: 400 }
      );
    }

    const previewText = gcpTtsPreviewTextForLanguage(language || 'en');
    const languageCode = languageCodeHintFromVoiceName(voiceName) || 'en-US';

    try {
      const audio = await synthesizeSpeechWithGcp({
        serviceAccountJson,
        voiceName,
        languageCode,
        text: previewText,
      });

      if (!audio.length) {
        return NextResponse.json(
          {
            error: 'Bad Gateway',
            message: 'Google Cloud TTS returned empty audio for this preview.',
            statusCode: 502,
          } satisfies ApiError,
          { status: 502 }
        );
      }

      return new NextResponse(new Uint8Array(audio), {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to synthesize preview';
      console.error('[POST /api/translation/gcp-voice-preview]', error);
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: message.slice(0, 300),
          fields: ['ttsVoice'],
          statusCode: 400,
        } satisfies ApiError & { fields: string[] },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('[POST /api/translation/gcp-voice-preview]', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to preview GCP TTS voice',
        statusCode: 500,
      } satisfies ApiError,
      { status: 500 }
    );
  }
}
