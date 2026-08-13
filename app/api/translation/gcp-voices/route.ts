// =============================================================================
// POST /api/translation/gcp-voices — list voices for SA JSON (or stored SA)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedSessionUserId } from '@/lib/api/auth';
import { getRuntimeSecretsForUser } from '@/lib/repositories/live-translation-channels';
import { listGcpTtsVoices } from '@/lib/translation/validate-gcp-tts';
import type { ApiError } from '@/types';

/**
 * Lists GCP TTS voices using pasted or stored service-account JSON.
 * @param req - Incoming request with optional `gcpServiceAccountJson`.
 * @returns Voice catalog for dropdowns.
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
      body = {};
    }

    const raw = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    let serviceAccountJson =
      typeof raw.gcpServiceAccountJson === 'string' ? raw.gcpServiceAccountJson.trim() : '';

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

    const listed = await listGcpTtsVoices(serviceAccountJson);
    if (listed.ok === false) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: listed.message,
          fields: listed.fields,
          statusCode: 400,
        } satisfies ApiError & { fields: string[] },
        { status: 400 }
      );
    }

    return NextResponse.json({ voices: listed.voices });
  } catch (error) {
    console.error('[POST /api/translation/gcp-voices]', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to list GCP TTS voices',
        statusCode: 500,
      } satisfies ApiError,
      { status: 500 }
    );
  }
}
