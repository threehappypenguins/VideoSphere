import { notFound } from 'next/navigation';
import { PublicListenClient } from '@/components/translation/PublicListenClient';
import {
  getChannelBySlug,
  capabilityInputFromDoc,
} from '@/lib/repositories/live-translation-channels';
import { isListenReady, isTranslationReady } from '@/lib/translation/capabilities';
import { languagesForSpokenAudio, normalizeGcpTtsVoices } from '@/lib/translation/gcp-tts-voices';
import { isChannelLive } from '@/lib/translation/is-channel-live';
import { normalizeTranslationSlug } from '@/lib/translation/slug';
import type { LiveTranslationPublicMeta } from '@/types';

/**
 * Public, unauthenticated listen page for live captions and optional spoken audio.
 * Source language plays live owner PCM; targets use GCP TTS when a voice is configured.
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
  const sourceLanguage = channel.sourceLanguage || 'en';
  const audioLanguages = languagesForSpokenAudio(
    sourceLanguage,
    [...(channel.enabledLanguages ?? [])],
    voices
  );

  const meta: LiveTranslationPublicMeta = {
    slug: channel.slug,
    publicEnabled: channel.publicEnabled,
    translationReady: true,
    listenAvailable: isListenReady(capability),
    audioLanguages,
    sourceLanguage,
    enabledLanguages: [...(channel.enabledLanguages ?? [])],
    live: isChannelLive(channel._id),
  };

  return (
    <main className="bg-background text-foreground min-h-dvh">
      <PublicListenClient meta={meta} />
    </main>
  );
}
