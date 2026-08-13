// =============================================================================
// Per-language GCP TTS speaking rate
// =============================================================================
// Live timing showed Mandarin speech duration ≈ English (1.03×), while French ran
// ~1.13× longer and slowly accumulated backlog. A modest native speakingRate cancels
// that expansion without the chipmunk effect of client-side resampling.
//
// Override any built-in default with TRANSLATION_TTS_SPEAKING_RATE (global) and/or
// TRANSLATION_TTS_SPEAKING_RATE_BY_LANG=fr:1.12,es:1.15 (per language, wins over both).
// =============================================================================

/** GCP `AudioConfig.speakingRate` lower bound. */
export const TTS_SPEAKING_RATE_MIN = 0.25;
/** GCP `AudioConfig.speakingRate` upper bound. */
export const TTS_SPEAKING_RATE_MAX = 2.0;

/**
 * Built-in rates from live calibration on this app's pipeline.
 * Only languages with measured expansion meaningfully above 1.0 are listed.
 */
const BUILTIN_SPEAKING_RATES: Readonly<Record<string, number>> = {
  fr: 1.12,
};

/**
 * Clamps a speaking rate into Google's supported range.
 * @param rate - Candidate rate.
 * @returns Rate in `[0.25, 2.0]`, or null when not a finite number.
 */
export function clampTtsSpeakingRate(rate: number): number | null {
  if (!Number.isFinite(rate)) return null;
  if (rate < TTS_SPEAKING_RATE_MIN || rate > TTS_SPEAKING_RATE_MAX) return null;
  return rate;
}

/**
 * Parses `lang:rate` pairs from an environment value.
 * @param raw - Comma-separated overrides such as `fr:1.12,es:1.15`.
 * @returns Map of lowercased language codes to rates.
 */
export function parseTtsSpeakingRateByLang(raw: string | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!raw?.trim()) return out;
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    const lang = trimmed.slice(0, colon).trim().toLowerCase();
    const rate = clampTtsSpeakingRate(Number(trimmed.slice(colon + 1).trim()));
    if (!lang || rate === null) continue;
    out.set(lang, rate);
  }
  return out;
}

/**
 * Resolves the GCP speaking rate for a listen language.
 *
 * Precedence: per-language env override → global env → built-in calibration → 1.0.
 * @param language - Listen language code (e.g. `fr`, `zh`).
 * @param env - Optional env snapshot (defaults to `process.env`).
 * @returns Speaking rate in `[0.25, 2.0]`.
 */
export function resolveTtsSpeakingRate(
  language: string,
  env: Record<string, string | undefined> = process.env
): number {
  const code = language.trim().toLowerCase();
  const byLang = parseTtsSpeakingRateByLang(env.TRANSLATION_TTS_SPEAKING_RATE_BY_LANG);
  const fromLang = code ? byLang.get(code) : undefined;
  if (fromLang !== undefined) return fromLang;

  // Also accept bare primary subtag (e.g. `fr` for `fr-CA`).
  const primary = code.split('-')[0] ?? '';
  if (primary && primary !== code) {
    const fromPrimary = byLang.get(primary);
    if (fromPrimary !== undefined) return fromPrimary;
  }

  const global = clampTtsSpeakingRate(Number((env.TRANSLATION_TTS_SPEAKING_RATE ?? '').trim()));
  if (global !== null) return global;

  if (code && BUILTIN_SPEAKING_RATES[code] !== undefined) {
    return BUILTIN_SPEAKING_RATES[code]!;
  }
  if (primary && BUILTIN_SPEAKING_RATES[primary] !== undefined) {
    return BUILTIN_SPEAKING_RATES[primary]!;
  }
  return 1;
}
