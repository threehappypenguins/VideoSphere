import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { ListenPageShell } from '@/components/translation/ListenPageShell';
import { PublicListenClient } from '@/components/translation/PublicListenClient';
import {
  getChannelBySlug,
  capabilityInputFromDoc,
} from '@/lib/repositories/live-translation-channels';
import { isListenReady, isTranslationReady } from '@/lib/translation/capabilities';
import { languagesForSpokenAudio, normalizeGcpTtsVoices } from '@/lib/translation/gcp-tts-voices';
import { isChannelLive } from '@/lib/translation/is-channel-live';
import {
  listenLanguageCookieName,
  normalizeListenLanguagePreferenceValue,
} from '@/lib/translation/listen-language-preference';
import {
  normalizeTranslationLanguageCode,
  resolveTranslationLanguageOption,
} from '@/lib/translation/languages';
import { normalizeTranslationSlug } from '@/lib/translation/slug';
import type { LiveTranslationPublicMeta } from '@/types';
import type { ListenNavControlsSeed } from '@/components/translation/ListenNavControlsProvider';

/**
 * Builds the public listen language option list for a channel.
 * @param sourceLanguage - Channel source language code.
 * @param enabledLanguages - Enabled target language codes.
 * @returns Deduped resolved language options.
 */
function buildListenLanguageOptions(
  sourceLanguage: string,
  enabledLanguages: readonly string[]
): ListenNavControlsSeed['languageOptions'] {
  const codes = [...new Set([sourceLanguage, ...enabledLanguages])];
  return codes
    .map((code) => resolveTranslationLanguageOption(code))
    .filter((option) => Boolean(option.code));
}

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
  const enabledLanguages = [...(channel.enabledLanguages ?? [])];
  const audioLanguages = languagesForSpokenAudio(sourceLanguage, enabledLanguages, voices);

  const allowedLanguages = new Set(
    [sourceLanguage, ...enabledLanguages].map((code) => normalizeTranslationLanguageCode(code))
  );
  const cookieStore = await cookies();
  const cookieLanguage = normalizeListenLanguagePreferenceValue(
    cookieStore.get(listenLanguageCookieName(slug))?.value
  );
  const initialLanguage =
    cookieLanguage && allowedLanguages.has(cookieLanguage) ? cookieLanguage : null;

  const languageOptions = buildListenLanguageOptions(sourceLanguage, enabledLanguages);
  const audioLanguageSet = new Set(
    audioLanguages.map((code) => normalizeTranslationLanguageCode(code))
  );
  const navSeed: ListenNavControlsSeed | null =
    languageOptions.length === 0
      ? null
      : {
          languageOptions,
          language: initialLanguage ?? '',
          audioAvailable: Boolean(initialLanguage && audioLanguageSet.has(initialLanguage)),
        };

  const meta: LiveTranslationPublicMeta = {
    slug: channel.slug,
    publicEnabled: channel.publicEnabled,
    translationReady: true,
    listenAvailable: isListenReady(capability),
    audioLanguages,
    sourceLanguage,
    enabledLanguages,
    live: isChannelLive(channel._id),
  };

  return (
    <ListenPageShell navSeed={navSeed}>
      <main className="text-foreground flex h-full min-h-0 flex-1 flex-col">
        <PublicListenClient meta={meta} initialLanguage={initialLanguage} />
      </main>
    </ListenPageShell>
  );
}
