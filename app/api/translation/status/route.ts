// =============================================================================
// GET /api/translation/status
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedSessionUserId } from '@/lib/api/auth';
import { getChannelOwnerViewForUser } from '@/lib/repositories/live-translation-channels';
import { getSubscriberStats } from '@/lib/translation/session-hub';
import type { ApiError } from '@/types';

/**
 * Returns live ingest / subscriber status for the owner's channel.
 * @param req - Incoming request.
 * @returns Status payload, or 404 when no channel exists.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await getAuthenticatedSessionUserId(req);
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Not authenticated', statusCode: 401 } satisfies ApiError,
        { status: 401 }
      );
    }

    const view = await getChannelOwnerViewForUser(userId);
    if (!view) {
      return NextResponse.json(
        {
          error: 'Not Found',
          message: 'Translation channel not configured',
          statusCode: 404,
        } satisfies ApiError,
        { status: 404 }
      );
    }

    const stats = getSubscriberStats(view.id);
    return NextResponse.json({
      channelId: view.id,
      translationReady: view.translationReady,
      listenReady: view.listenReady,
      publicEnabled: view.publicEnabled,
      ...stats,
    });
  } catch (error) {
    console.error('[GET /api/translation/status]', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to load translation status',
        statusCode: 500,
      } satisfies ApiError,
      { status: 500 }
    );
  }
}
