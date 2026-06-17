/**
 * SermonAudio language catalog from `GET /v2/node/languages`.
 */

/** Default SermonAudio sermon language when unset (`SermonParamsCreate.languageCode`). */
export const SERMON_AUDIO_DEFAULT_LANGUAGE_CODE = 'en';

/**
 * A SermonAudio language option for draft UI and upload metadata.
 * @property code - ISO-style language code sent as `languageCode` on sermon create.
 * @property name - Human-readable label for the draft UI.
 */
export interface SermonAudioLanguageOption {
  code: string;
  name: string;
}

/**
 * Parses a SermonAudio language object from API JSON.
 * @param item - Raw language payload from `GET /v2/node/languages`.
 * @returns Normalized language option, or null when invalid.
 */
export function parseSermonAudioLanguage(item: unknown): SermonAudioLanguageOption | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const code = typeof record.languageCode === 'string' ? record.languageCode.trim() : '';
  if (code === '') return null;

  const localizedName = typeof record.localizedName === 'string' ? record.localizedName.trim() : '';
  const languageName = typeof record.languageName === 'string' ? record.languageName.trim() : '';
  const name = localizedName || languageName || code;
  return { code, name };
}

/**
 * Parses language options from a paginated SermonAudio languages list body.
 * @param body - Parsed JSON from `GET /v2/node/languages`.
 * @returns Deduplicated language options in API order.
 */
export function parseSermonAudioLanguagesFromListBody(body: unknown): SermonAudioLanguageOption[] {
  if (!body || typeof body !== 'object') return [];
  const results = (body as Record<string, unknown>).results;
  if (!Array.isArray(results)) return [];

  const seen = new Set<string>();
  const options: SermonAudioLanguageOption[] = [];
  for (const item of results) {
    const parsed = parseSermonAudioLanguage(item);
    if (!parsed || seen.has(parsed.code)) continue;
    seen.add(parsed.code);
    options.push(parsed);
  }
  return options;
}

/**
 * Sorts SermonAudio language options for display (English first, then name).
 * @param options - Unsorted language options.
 * @returns Sorted copy for UI select lists.
 */
export function sortSermonAudioLanguageOptions(
  options: readonly SermonAudioLanguageOption[]
): SermonAudioLanguageOption[] {
  return [...options].sort((a, b) => {
    if (a.code === SERMON_AUDIO_DEFAULT_LANGUAGE_CODE) return -1;
    if (b.code === SERMON_AUDIO_DEFAULT_LANGUAGE_CODE) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}
