// =============================================================================
// POST /api/translation/public/[slug]/want-audio
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  getChannelBySlug,
  capabilityInputFromDoc,
} from '@/lib/repositories/live-translation-channels';
import { isTranslationReady } from '@/lib/translation/capabilities';
import { setPublicListenerWantAudio } from '@/lib/translation/session-hub';
import { normalizeTranslationSlug } from '@/lib/translation/slug';

/**
 * Updates spoken-audio preference for an existing public SSE listener.
 * Used so the speaker toggle does not tear down and recreate the EventSource
 * (which briefly drops the only listener and bounces upstream STT).
 * @param req - JSON body `{ listenerId, wantAudio }`.
 * @param context - Route params with slug.
 * @returns `{ ok: true }` when updated, 404 when the listener is unknown.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await context.params;
  const slug = normalizeTranslationSlug(rawSlug);

  const channel = await getChannelBySlug(slug);
  if (!channel || !channel.publicEnabled) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!isTranslationReady(capabilityInputFromDoc(channel))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
  }

  const { listenerId, wantAudio } = body as {
    listenerId?: unknown;
    wantAudio?: unknown;
  };
  if (typeof listenerId !== 'string' || !listenerId.trim()) {
    return NextResponse.json({ error: 'listenerId is required' }, { status: 400 });
  }
  if (typeof wantAudio !== 'boolean') {
    return NextResponse.json({ error: 'wantAudio must be a boolean' }, { status: 400 });
  }

  const updated = setPublicListenerWantAudio({
    channelId: channel._id,
    listenerId: listenerId.trim(),
    wantAudio,
  });
  if (!updated) {
    return NextResponse.json({ error: 'Listener not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
