// =============================================================================
// GET /api/translation/public/audio/[audioId]
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAudioBytes } from '@/lib/translation/session-hub';
import type { ApiError } from '@/types';

/**
 * Serves short-lived synthesized TTS audio for public listeners.
 * @param _req - Incoming request.
 * @param context - Route params with audio id.
 * @returns MP3/audio bytes or 404.
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ audioId: string }> }) {
  const { audioId } = await context.params;
  const entry = getAudioBytes(audioId);
  if (!entry) {
    return NextResponse.json(
      { error: 'Not Found', message: 'Audio not found', statusCode: 404 } satisfies ApiError,
      { status: 404 }
    );
  }

  return new NextResponse(new Uint8Array(entry.data), {
    status: 200,
    headers: {
      'Content-Type': entry.mime,
      'Cache-Control': 'no-store',
    },
  });
}
