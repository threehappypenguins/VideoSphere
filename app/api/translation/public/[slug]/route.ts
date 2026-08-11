// =============================================================================
// GET /api/translation/public/[slug]
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  getChannelBySlug,
  capabilityInputFromDoc,
} from '@/lib/repositories/live-translation-channels';
import { isListenReady, isTranslationReady } from '@/lib/translation/capabilities';
import {
  gcpTtsVoiceForLanguage,
  languagesForTtsConfig,
  normalizeGcpTtsVoices,
} from '@/lib/translation/gcp-tts-voices';
import { isChannelLive } from '@/lib/translation/is-channel-live';
import { normalizeTranslationSlug } from '@/lib/translation/slug';
import type { ApiError, LiveTranslationPublicMeta } from '@/types';

/**
 * Returns non-secret public metadata for a listen page.
 * @param _req - Incoming request.
 * @param context - Route params with slug.
 * @returns Public meta payload.
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug: rawSlug } = await context.params;
    const slug = normalizeTranslationSlug(rawSlug);
    const channel = await getChannelBySlug(slug);
    if (!channel || !channel.publicEnabled) {
      return NextResponse.json(
        {
          error: 'Not Found',
          message: 'Listen page not found',
          statusCode: 404,
        } satisfies ApiError,
        { status: 404 }
      );
    }

    const capability = capabilityInputFromDoc(channel);

    const translationReady = isTranslationReady(capability);
    if (!translationReady) {
      return NextResponse.json(
        {
          error: 'Not Found',
          message: 'Listen page not found',
          statusCode: 404,
        } satisfies ApiError,
        { status: 404 }
      );
    }

    const voices = normalizeGcpTtsVoices(channel.gcpTtsVoices);
    const audioLanguages = languagesForTtsConfig(channel.sourceLanguage || 'en', [
      ...(channel.enabledLanguages ?? []),
    ]).filter((code) => Boolean(gcpTtsVoiceForLanguage(voices, code)));

    const payload: LiveTranslationPublicMeta = {
      slug: channel.slug,
      publicEnabled: channel.publicEnabled,
      translationReady,
      listenAvailable: isListenReady(capability),
      audioLanguages,
      sourceLanguage: channel.sourceLanguage || 'en',
      enabledLanguages: [...(channel.enabledLanguages ?? [])],
      live: isChannelLive(channel._id),
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[GET /api/translation/public/:slug]', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to load public translation page',
        statusCode: 500,
      } satisfies ApiError,
      { status: 500 }
    );
  }
}
