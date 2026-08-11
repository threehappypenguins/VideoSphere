// =============================================================================
// POST /api/translation/rtmp/auth
// =============================================================================
// MediaMTX HTTP authentication hook. Validates the stream key in the path
// against a per-user stored hash. No shared credentials.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  getChannelByStreamKey,
  capabilityInputFromDoc,
} from '@/lib/repositories/live-translation-channels';
import { isTranslationReady } from '@/lib/translation/capabilities';

/**
 * Authenticates an optional MediaMTX publish attempt using the owner's stream key.
 * MediaMTX sends JSON including `path` (e.g. `live/<streamKey>`).
 * @param req - Incoming auth hook request.
 * @returns 200 when allowed; 401 when denied.
 */
export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid body' }, { status: 401 });
    }

    const path =
      body && typeof body === 'object' && 'path' in body
        ? String((body as { path?: unknown }).path ?? '')
        : '';
    const action =
      body && typeof body === 'object' && 'action' in body
        ? String((body as { action?: unknown }).action ?? '')
        : '';

    // Allow reads loosely; require stream key match for publish.
    if (action && action !== 'publish' && action !== 'publishIdle') {
      return NextResponse.json({ ok: true });
    }

    const segments = path.split('/').filter(Boolean);
    const streamKey = segments[segments.length - 1] ?? '';
    if (!streamKey) {
      return NextResponse.json({ error: 'missing stream key' }, { status: 401 });
    }

    const channel = await getChannelByStreamKey(streamKey);
    if (!channel) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const ready = isTranslationReady(capabilityInputFromDoc(channel));
    if (!ready || !channel.publicEnabled) {
      return NextResponse.json({ error: 'translation not ready' }, { status: 401 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[POST /api/translation/rtmp/auth]', error);
    return NextResponse.json({ error: 'error' }, { status: 401 });
  }
}
