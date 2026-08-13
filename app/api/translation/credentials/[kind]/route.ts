// =============================================================================
// DELETE /api/translation/credentials/:kind
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedSessionUserId } from '@/lib/api/auth';
import { clearCredential } from '@/lib/repositories/live-translation-channels';
import { normalizeCredentialKind } from '@/lib/translation/capabilities';
import type { ApiError } from '@/types';

/**
 * Clears a stored credential for the authenticated owner.
 * @param req - Incoming request.
 * @param context - Route params with credential kind.
 * @returns Updated owner channel view.
 */
export async function DELETE(req: NextRequest, context: { params: Promise<{ kind: string }> }) {
  try {
    const userId = await getAuthenticatedSessionUserId(req);
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Not authenticated', statusCode: 401 } satisfies ApiError,
        { status: 401 }
      );
    }

    const { kind: rawKind } = await context.params;
    const kind = normalizeCredentialKind(rawKind);
    if (!kind) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message:
            'kind must be openrouter, groq, gcp, deepgram, assemblyai, gladia, speechmatics, soniox, modulate, or elevenlabs',
          statusCode: 400,
        } satisfies ApiError,
        { status: 400 }
      );
    }

    const view = await clearCredential(userId, kind);
    if (!view) {
      return NextResponse.json(
        {
          error: 'Not Found',
          message: 'Translation channel not found',
          statusCode: 404,
        } satisfies ApiError,
        { status: 404 }
      );
    }
    return NextResponse.json(view);
  } catch (error) {
    console.error('[DELETE /api/translation/credentials/:kind]', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to clear credential',
        statusCode: 500,
      } satisfies ApiError,
      { status: 500 }
    );
  }
}
