// =============================================================================
// POST /api/translation/stream-key
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedSessionUserId } from '@/lib/api/auth';
import { rotateStreamKey } from '@/lib/repositories/live-translation-channels';
import type { ApiError } from '@/types';

/**
 * Rotates the owner's RTMP stream key and returns plaintext once.
 * Requires an existing channel (created by saving AI credentials).
 * @param req - Incoming request.
 * @returns Owner view including streamKeyPlaintext.
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

    const view = await rotateStreamKey(userId);
    if (!view) {
      return NextResponse.json(
        {
          error: 'Not Found',
          message: 'Translation channel not found. Configure AI first.',
          statusCode: 404,
        } satisfies ApiError,
        { status: 404 }
      );
    }
    return NextResponse.json(view);
  } catch (error) {
    console.error('[POST /api/translation/stream-key]', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to rotate stream key',
        statusCode: 500,
      } satisfies ApiError,
      { status: 500 }
    );
  }
}
