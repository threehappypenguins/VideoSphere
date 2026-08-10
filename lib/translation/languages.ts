// =============================================================================
// Curated live-translation language codes (ISO 639-1)
// =============================================================================

/**
 * A language option for source / target pickers.
 */
export interface TranslationLanguageOption {
  /** ISO 639-1 code passed to STT, translate prompts, and TTS. */
  code: string;
  /** English display name. */
  name: string;
  /** Autonym / endonym in the language’s own script when applicable. */
  nativeName: string;
}

/**
 * Languages curated for the suggested stack:
 * Groq/OpenRouter Whisper STT (`whisper-large-v3*`) plus OpenRouter chat translate
 * (e.g. `openai/gpt-oss-20b:free`). Codes are ISO 639-1; this is not fetched from
 * provider APIs — models do not expose a reliable language catalog.
 */
export const TRANSLATION_LANGUAGES: readonly TranslationLanguageOption[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська' },
  { code: 'zh', name: 'Chinese', nativeName: '中文' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi' },
  { code: 'tl', name: 'Tagalog', nativeName: 'Tagalog' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili' },
  { code: 'af', name: 'Afrikaans', nativeName: 'Afrikaans' },
] as const;

const BY_CODE = new Map(TRANSLATION_LANGUAGES.map((lang) => [lang.code, lang]));

/**
 * Returns whether a code is in the curated translation language list.
 * @param code - Language code to check.
 * @returns True when the code is curated.
 */
export function isKnownTranslationLanguage(code: string): boolean {
  return BY_CODE.has(code.trim().toLowerCase());
}

/**
 * Resolves the English display label for a language code.
 * @param code - ISO 639-1 (or legacy free-text) code.
 * @returns Curated English name, or the raw code when unknown.
 */
export function translationLanguageLabel(code: string): string {
  const normalized = code.trim().toLowerCase();
  return BY_CODE.get(normalized)?.name ?? code.trim();
}

/**
 * Builds the public listen-page label: English name plus native autonym in parentheses.
 * Omits the parenthetical when the native name matches the English name.
 * @param code - ISO 639-1 (or legacy free-text) code.
 * @returns Label such as `French (Français)` or `Chinese (中文)`.
 */
export function translationLanguagePublicLabel(code: string): string {
  const normalized = code.trim().toLowerCase();
  const lang = BY_CODE.get(normalized);
  if (!lang) {
    return code.trim();
  }
  if (lang.name.localeCompare(lang.nativeName, undefined, { sensitivity: 'accent' }) === 0) {
    return lang.name;
  }
  return `${lang.name} (${lang.nativeName})`;
}

/**
 * Resolves a curated language option for a code, or a synthetic fallback for legacy codes.
 * @param code - Language code.
 * @returns Option with English + native names.
 */
export function resolveTranslationLanguageOption(code: string): TranslationLanguageOption {
  const normalized = normalizeTranslationLanguageCode(code);
  const known = BY_CODE.get(normalized);
  if (known) return known;
  const raw = code.trim() || normalized;
  return { code: normalized || raw, name: raw, nativeName: raw };
}

/**
 * Lowercases text and strips combining marks so search ignores accents.
 * @param value - Raw text.
 * @returns Normalized searchable string.
 */
function searchableText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/**
 * Filters language options by English name, native name, or code (live search).
 * Matching ignores case and diacritics (e.g. `franc` matches `Français`).
 * @param options - Candidate languages.
 * @param query - User search text.
 * @returns Matching options in original order.
 */
export function filterTranslationLanguages(
  options: readonly TranslationLanguageOption[],
  query: string
): TranslationLanguageOption[] {
  const q = searchableText(query);
  if (!q) return [...options];
  return options.filter((lang) => {
    return (
      searchableText(lang.code).includes(q) ||
      searchableText(lang.name).includes(q) ||
      searchableText(lang.nativeName).includes(q)
    );
  });
}

/**
 * Normalizes a stored language code for comparison against the curated list.
 * @param code - Raw language code.
 * @returns Lowercased trimmed code.
 */
export function normalizeTranslationLanguageCode(code: string): string {
  return code.trim().toLowerCase();
}
