// =============================================================================
// POST /api/translation/rtmp/publisher
// =============================================================================
// Optional MediaMTX runOnAvailable / runOnUnavailable webhook.
// Prefer TRANSLATION_RTMP_HOOK_SECRET. RTMP auth also starts the puller.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getChannelByStreamKey } from '@/lib/repositories/live-translation-channels';
import { getRtmpHookSecret, streamKeyFromMtxPath } from '@/lib/translation/rtmp-config';
import {
  isRtmpPcmPullConfigured,
  startRtmpPcmPuller,
  stopRtmpPcmPuller,
  verifyRtmpHookSecret,
} from '@/lib/translation/rtmp-pcm-puller';

/**
 * Starts or stops the RTSP→PCM puller when MediaMTX signals path availability.
 * @param req - Incoming webhook request.
 * @returns 200 when handled; 401 when unauthorized; 400 when invalid.
 */
export async function POST(req: NextRequest) {
  try {
    if (!getRtmpHookSecret()) {
      return NextResponse.json({ error: 'hook secret not configured' }, { status: 401 });
    }

    const headerSecret = req.headers.get('x-translation-rtmp-hook-secret');
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }

    const bodySecret =
      body && typeof body === 'object' && 'secret' in body
        ? String((body as { secret?: unknown }).secret ?? '')
        : '';
    if (!verifyRtmpHookSecret(headerSecret) && !verifyRtmpHookSecret(bodySecret)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    if (!isRtmpPcmPullConfigured()) {
      return NextResponse.json({ error: 'rtsp base not configured' }, { status: 503 });
    }

    const path =
      body && typeof body === 'object' && 'path' in body
        ? String((body as { path?: unknown }).path ?? '')
        : '';
    const eventRaw =
      body && typeof body === 'object' && 'event' in body
        ? String((body as { event?: unknown }).event ?? '')
        : '';
    const event = eventRaw.trim().toLowerCase();

    const streamKey = streamKeyFromMtxPath(path);
    if (!streamKey) {
      return NextResponse.json({ error: 'missing path' }, { status: 400 });
    }

    const channel = await getChannelByStreamKey(streamKey);
    if (!channel) {
      return NextResponse.json({ error: 'unknown stream' }, { status: 404 });
    }

    const mtxPath = path.replace(/^\/+/, '').replace(/\/+$/, '');

    if (event === 'available' || event === 'start') {
      startRtmpPcmPuller({
        channelId: channel._id,
        userId: channel.userId,
        mtxPath,
      });
      return NextResponse.json({ ok: true, action: 'started' });
    }

    if (event === 'notavailable' || event === 'unavailable' || event === 'stop') {
      stopRtmpPcmPuller(channel._id);
      return NextResponse.json({ ok: true, action: 'stopped' });
    }

    return NextResponse.json({ error: 'unknown event' }, { status: 400 });
  } catch (error) {
    console.error('[POST /api/translation/rtmp/publisher]', error);
    return NextResponse.json({ error: 'error' }, { status: 500 });
  }
}
