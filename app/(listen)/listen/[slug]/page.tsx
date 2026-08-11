import { notFound } from 'next/navigation';
import { PublicListenClient } from '@/components/translation/PublicListenClient';
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
import { isChannelLive } from '@/lib/translation/session-hub';
import { normalizeTranslationSlug } from '@/lib/translation/slug';
import type { LiveTranslationPublicMeta } from '@/types';

/**
 * Public, unauthenticated listen page for live captions and optional TTS.
 * @param props - Route params containing the public slug.
 * @returns Mobile-first listen UI, or 404 when unavailable.
 */
export default async function PublicListenPage(props: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = await props.params;
  const slug = normalizeTranslationSlug(raw);
  const channel = await getChannelBySlug(slug);
  if (!channel || !channel.publicEnabled) {
    notFound();
  }

  const capability = capabilityInputFromDoc(channel);

  if (!isTranslationReady(capability)) {
    notFound();
  }

  const voices = normalizeGcpTtsVoices(channel.gcpTtsVoices);
  const audioLanguages = languagesForTtsConfig(channel.sourceLanguage || 'en', [
    ...(channel.enabledLanguages ?? []),
  ]).filter((code) => Boolean(gcpTtsVoiceForLanguage(voices, code)));

  const meta: LiveTranslationPublicMeta = {
    slug: channel.slug,
    publicEnabled: channel.publicEnabled,
    translationReady: true,
    listenAvailable: isListenReady(capability),
    audioLanguages,
    sourceLanguage: channel.sourceLanguage || 'en',
    enabledLanguages: [...(channel.enabledLanguages ?? [])],
    live: isChannelLive(channel._id),
  };

  return (
    <main className="bg-background text-foreground min-h-dvh">
      <PublicListenClient meta={meta} />
    </main>
  );
}
