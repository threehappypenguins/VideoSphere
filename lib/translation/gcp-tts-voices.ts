// =============================================================================
// Per-language GCP TTS voice helpers
// =============================================================================

import { normalizeTranslationLanguageCode } from '@/lib/translation/languages';

/**
 * Reported SSML gender from Google Cloud `listVoices`.
 */
export type GcpTtsSsmlGender = 'male' | 'female' | 'neutral';

/**
 * Normalizes Google’s `ssmlGender` enum/string into a UI-friendly value.
 * @param raw - Value from `listVoices` (`MALE`, `1`, etc.).
 * @returns Normalized gender, or null when unspecified/unknown.
 */
export function normalizeGcpTtsSsmlGender(raw: unknown): GcpTtsSsmlGender | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    // google.cloud.texttospeech.v1.SsmlVoiceGender
    if (raw === 1) return 'male';
    if (raw === 2) return 'female';
    if (raw === 3) return 'neutral';
    return null;
  }
  const value = String(raw).trim().toUpperCase();
  if (value === 'MALE' || value === '1') return 'male';
  if (value === 'FEMALE' || value === '2') return 'female';
  if (value === 'NEUTRAL' || value === '3') return 'neutral';
  return null;
}

/**
 * Formats a voice option label including gender for admin dropdowns.
 * @param voice - Voice name and optional gender.
 * @returns Label such as `es-US-Neural2-A (female)`.
 */
export function formatGcpTtsVoiceOptionLabel(voice: {
  name: string;
  ssmlGender?: GcpTtsSsmlGender | null;
}): string {
  const gender = voice.ssmlGender;
  if (!gender) return voice.name;
  return `${voice.name} (${gender})`;
}

/**
 * Derives a BCP-47 language hint from a GCP voice name for `listVoices` / synthesize.
 * @param voiceName - Voice resource name such as `es-US-Neural2-A` or `cmn-CN-Wavenet-A`.
 * @returns Language code hint, or undefined when the name is too short to parse.
 */
export function languageCodeHintFromVoiceName(voiceName: string): string | undefined {
  const trimmed = voiceName.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split('-');
  if (parts.length < 2) return parts[0] || undefined;
  // Region subtag is typically two letters (en-US, cmn-CN, nb-NO).
  if (/^[A-Za-z]{2}$/.test(parts[1])) {
    return `${parts[0]}-${parts[1]}`;
  }
  return parts[0];
}

/**
 * GCP TTS language-code bases that correspond to a VideoSphere listen language.
 * Google often uses tags other than ISO 639-1 (e.g. `cmn`/`yue` for Chinese, `fil` for Tagalog).
 * @param listenLanguage - Channel listen language (e.g. `zh`).
 * @returns Lowercase base tags to match against voice names / `languageCodes`.
 */
export function gcpTtsLanguageBasesForListenLanguage(listenLanguage: string): string[] {
  const listen =
    normalizeTranslationLanguageCode(listenLanguage)?.toLowerCase() ||
    listenLanguage.trim().toLowerCase();
  if (!listen) return [];

  const aliases: Record<string, string[]> = {
    // Mandarin: Cloud TTS uses `cmn-*` (and occasionally `zh-*`).
    zh: ['zh', 'cmn'],
    // Cantonese (Hong Kong): Cloud TTS uses `yue-HK-*`.
    yue: ['yue'],
    // Cloud TTS lists Filipino as `fil-PH`; Whisper uses `tl`.
    tl: ['tl', 'fil'],
    // Norwegian: GCP often uses `nb-NO`.
    no: ['no', 'nb', 'nn'],
    // Legacy Hebrew tag still appears in some catalogs.
    he: ['he', 'iw'],
  };

  return [...new Set(aliases[listen] ?? [listen])];
}

/**
 * Returns whether a GCP voice belongs to a listen language (including Chinese aliases).
 * @param voice - Voice name and optional `languageCodes` from `listVoices`.
 * @param listenLanguage - Listen / channel language code (e.g. `zh`).
 * @returns True when the voice matches any accepted base tag for that language.
 */
export function gcpVoiceMatchesListenLanguage(
  voice: { name: string; languageCodes?: string[] },
  listenLanguage: string
): boolean {
  const bases = new Set(gcpTtsLanguageBasesForListenLanguage(listenLanguage));
  if (bases.size === 0) return false;

  const nameBase = languageCodeHintFromVoiceName(voice.name)?.split('-')[0]?.toLowerCase();
  if (nameBase && bases.has(nameBase)) return true;

  for (const code of voice.languageCodes ?? []) {
    const base = code.split('-')[0]?.trim().toLowerCase();
    if (base && bases.has(base)) return true;
  }
  return false;
}

/**
 * Map of ISO language code → GCP TTS voice resource name.
 */
export type GcpTtsVoicesMap = Record<string, string>;

/**
 * Normalizes a stored or request voices map to trimmed language → voice entries.
 * @param raw - Unknown payload (object, Map, or null).
 * @returns Clean map (empty when invalid).
 */
export function normalizeGcpTtsVoices(raw: unknown): GcpTtsVoicesMap {
  if (raw == null) return {};
  const entries: Array<[string, string]> = [];
  if (raw instanceof Map) {
    for (const [k, v] of raw.entries()) {
      entries.push([String(k), String(v)]);
    }
  } else if (typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') entries.push([k, v]);
    }
  } else {
    return {};
  }

  const out: GcpTtsVoicesMap = {};
  for (const [lang, voice] of entries) {
    const code = normalizeTranslationLanguageCode(lang) || lang.trim().toLowerCase();
    const name = voice.trim();
    if (!code || !name) continue;
    out[code] = name;
  }
  return out;
}

/**
 * Returns whether any voice is configured.
 * @param voices - Voices map.
 * @returns True when at least one non-empty voice exists.
 */
export function hasAnyGcpTtsVoice(voices: GcpTtsVoicesMap | null | undefined): boolean {
  if (!voices) return false;
  return Object.values(voices).some((v) => Boolean(v?.trim()));
}

/**
 * Looks up the configured voice for a listen/source language.
 * @param voices - Voices map.
 * @param language - Listen language code.
 * @returns Voice name, or null.
 */
export function gcpTtsVoiceForLanguage(
  voices: GcpTtsVoicesMap | null | undefined,
  language: string
): string | null {
  if (!voices) return null;
  const code = normalizeTranslationLanguageCode(language) || language.trim().toLowerCase();
  const voice = voices[code]?.trim();
  return voice || null;
}

/**
 * Languages that should have optional TTS voice dropdowns (source + targets).
 * @param sourceLanguage - Channel source language.
 * @param enabledLanguages - Enabled listen target languages.
 * @returns Deduped normalized language codes.
 */
export function languagesForTtsConfig(
  sourceLanguage: string,
  enabledLanguages: string[]
): string[] {
  const source = normalizeTranslationLanguageCode(sourceLanguage) || 'en';
  const targets = enabledLanguages
    .map(normalizeTranslationLanguageCode)
    .filter((code): code is string => Boolean(code) && code !== source);
  return [source, ...targets];
}

/**
 * Returns whether a GCP voice’s language family matches a listen language.
 * @param voiceName - Voice resource name (e.g. `es-US-Neural2-A` or `yue-HK-Chirp3-HD-Aoede`).
 * @param listenLanguage - Listen page language (e.g. `es` or `zh`).
 * @returns True when the voice matches that listen language (including GCP aliases).
 */
export function voiceMatchesListenLanguage(voiceName: string, listenLanguage: string): boolean {
  return gcpVoiceMatchesListenLanguage({ name: voiceName }, listenLanguage);
}

/**
 * Keeps only voices for languages still in the active set.
 * @param voices - Current voices map.
 * @param activeLanguages - Languages that may keep a voice.
 * @returns Pruned map.
 */
export function pruneGcpTtsVoicesToLanguages(
  voices: GcpTtsVoicesMap,
  activeLanguages: string[]
): GcpTtsVoicesMap {
  const allowed = new Set(
    activeLanguages
      .map((l) => normalizeTranslationLanguageCode(l) || l.trim().toLowerCase())
      .filter(Boolean)
  );
  const out: GcpTtsVoicesMap = {};
  for (const [lang, voice] of Object.entries(voices)) {
    if (allowed.has(lang)) out[lang] = voice;
  }
  return out;
}
