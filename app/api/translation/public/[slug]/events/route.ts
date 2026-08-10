// =============================================================================
// GET /api/translation/public/[slug]/events?language=&wantAudio=
// =============================================================================

import { NextRequest } from 'next/server';
import { getChannelBySlug, capabilityInputFromDoc } from '@/lib/repositories/live-translation-channels';
import { isTranslationReady } from '@/lib/translation/capabilities';
import { normalizeTranslationLanguageCode } from '@/lib/translation/languages';
import { subscribePublicListener, type TranslationHubEvent } from '@/lib/translation/session-hub';
import { normalizeTranslationSlug } from '@/lib/translation/slug';

/**
 * Server-Sent Events stream of live captions (and optional audio URLs) for a language.
 * First subscriber for a language starts translate work; disconnect stops after grace.
 * @param req - Incoming request with language / wantAudio query params.
 * @param context - Route params with slug.
 * @returns SSE response.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await context.params;
  const slug = normalizeTranslationSlug(rawSlug);
  const language = normalizeTranslationLanguageCode(
    (req.nextUrl.searchParams.get('language') ?? '').trim()
  );
  const wantAudio = req.nextUrl.searchParams.get('wantAudio') === '1';

  if (!language) {
    return new Response(JSON.stringify({ error: 'language is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const channel = await getChannelBySlug(slug);
  if (!channel || !channel.publicEnabled) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ready = isTranslationReady(capabilityInputFromDoc(channel));
  if (!ready) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const allowed = new Set(
    [channel.sourceLanguage || 'en', ...(channel.enabledLanguages ?? [])].map(
      normalizeTranslationLanguageCode
    )
  );
  if (!allowed.has(language)) {
    return new Response(JSON.stringify({ error: 'Language not enabled' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: TranslationHubEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      unsubscribe = subscribePublicListener({
        channelId: channel._id,
        userId: channel.userId,
        language,
        wantAudio,
        send,
      });

      heartbeat = setInterval(() => {
        send({ type: 'heartbeat', ts: Date.now() });
      }, 15_000);

      req.signal.addEventListener('abort', () => {
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
