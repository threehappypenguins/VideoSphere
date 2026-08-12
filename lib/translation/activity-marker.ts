// =============================================================================
// Music marker shown in place of captions during singing / music
// =============================================================================
// Localized here rather than translated at runtime: the marker is a fixed UI string,
// so routing it through the MT provider and TTS would cost money on every song for
// a word we already know in every supported language.
//
// One label covers both singing and instrumental music. The detector can say
// "this is not speech" with reasonable confidence, but singing-versus-instrumental
// is a much shakier call to put in front of listeners.
// =============================================================================

import { normalizeTranslationLanguageCode } from '@/lib/translation/languages';

/** Language-neutral music glyph, matching broadcast captioning convention. */
export const MUSIC_MARKER_GLYPH = '♪';

/**
 * The word "Music" in each curated translation language.
 */
const MUSIC_MARKER_LABELS: Readonly<Record<string, string>> = {
  af: 'Musiek',
  ar: 'موسيقى',
  bn: 'সঙ্গীত',
  cs: 'Hudba',
  da: 'Musik',
  de: 'Musik',
  el: 'Μουσική',
  en: 'Music',
  es: 'Música',
  fi: 'Musiikki',
  fr: 'Musique',
  he: 'מוזיקה',
  hi: 'संगीत',
  hu: 'Zene',
  id: 'Musik',
  it: 'Musica',
  ja: '音楽',
  ko: '음악',
  ms: 'Muzik',
  nl: 'Muziek',
  no: 'Musikk',
  pl: 'Muzyka',
  pt: 'Música',
  ro: 'Muzică',
  ru: 'Музыка',
  sv: 'Musik',
  sw: 'Muziki',
  ta: 'இசை',
  te: 'సంగీతం',
  th: 'ดนตรี',
  tl: 'Musika',
  tr: 'Müzik',
  uk: 'Музика',
  vi: 'Âm nhạc',
  yue: '音樂',
  zh: '音乐',
};

/**
 * Builds the caption-line marker shown while music is detected.
 *
 * Falls back to the bare glyph for languages without a curated label, which still
 * reads correctly to any listener.
 * @param language - Listener's language code.
 * @returns Marker text such as `♪ Música ♪`, or `♪` when the language is unknown.
 */
export function musicMarkerText(language: string): string {
  const label = MUSIC_MARKER_LABELS[normalizeTranslationLanguageCode(language)];
  if (!label) return MUSIC_MARKER_GLYPH;
  return `${MUSIC_MARKER_GLYPH} ${label} ${MUSIC_MARKER_GLYPH}`;
}
