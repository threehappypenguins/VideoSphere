// =============================================================================
// Live-translation provider free-tier / pricing hints (UI + docs)
// =============================================================================

/**
 * Pricing summary shown next to STT / translate provider pickers.
 */
export interface TranslationProviderPricingInfo {
  /** Provider id. */
  id: string;
  /** Short label for dropdowns. */
  label: string;
  /** Free monthly / rate-limit summary from the vendor’s public docs. */
  freeUsageLimit: string;
  /** What happens after free / rate limits (high level). */
  priceAfterFree: string;
  /** Official pricing or limits page. */
  pricingUrl: string;
}

/** OpenRouter free-model rate-limit docs. */
export const OPENROUTER_LIMITS_URL = 'https://openrouter.ai/docs/api-reference/limits';

/** OpenRouter models catalog (STT and chat pricing vary by model). */
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/models';

/** Groq rate-limits docs (free plan RPM/RPD/ASH). */
export const GROQ_RATE_LIMITS_URL = 'https://console.groq.com/docs/rate-limits';

/**
 * GroqCloud model catalog with published per-model rates (including Whisper).
 * Prefer this over marketing URLs — `groq.com/pricing` is not a pricing page.
 */
export const GROQ_PRICING_URL = 'https://console.groq.com/docs/models';

/** Google Cloud Speech-to-Text pricing. */
export const GCP_STT_PRICING_URL = 'https://cloud.google.com/speech-to-text/pricing';

/** Google Cloud Translation pricing. */
export const GCP_TRANSLATE_PRICING_URL = 'https://cloud.google.com/translate/pricing';

/**
 * Speech-to-text provider pricing hints for the Configure AI UI.
 */
export const STT_PROVIDER_PRICING: Record<
  'openrouter' | 'groq' | 'gcp',
  TranslationProviderPricingInfo
> = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    freeUsageLimit:
      ':free models ≈ 20 RPM / 50 RPD (1,000 RPD after ≥$10 lifetime credits). Paid STT models bill per catalog rate.',
    priceAfterFree: 'Model catalog rate (duration or tokens); no OpenRouter markup on model cost.',
    pricingUrl: OPENROUTER_MODELS_URL,
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    freeUsageLimit:
      'Whisper free plan ≈ 20 RPM / 2,000 RPD · 7,200 audio-seconds/hour · 28,800 audio-seconds/day.',
    priceAfterFree:
      'Developer plan billed per audio hour (see GroqCloud models docs); higher RPM/ASH.',
    pricingUrl: GROQ_RATE_LIMITS_URL,
  },
  gcp: {
    id: 'gcp',
    label: 'Google Cloud',
    freeUsageLimit: 'First 60 minutes of audio / month free (V1 standard recognition).',
    priceAfterFree: 'About US$0.016 / minute after the free 60 minutes (standard recognition).',
    pricingUrl: GCP_STT_PRICING_URL,
  },
};

/**
 * Caption text-translate provider pricing hints for the Configure AI UI.
 */
export const TRANSLATE_PROVIDER_PRICING: Record<
  'openrouter' | 'groq' | 'gcp',
  TranslationProviderPricingInfo
> = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    freeUsageLimit:
      ':free chat models ≈ 20 RPM / 50 RPD (1,000 RPD after ≥$10 lifetime credits) — not enough for a full sermon.',
    priceAfterFree: 'Paid chat models bill per catalog token rates.',
    pricingUrl: OPENROUTER_LIMITS_URL,
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    freeUsageLimit:
      'Chat free plan roughly 30 RPM; daily/token caps vary by model (see Groq rate limits).',
    priceAfterFree: 'Developer plan billed per million tokens (see GroqCloud models docs).',
    pricingUrl: GROQ_RATE_LIMITS_URL,
  },
  gcp: {
    id: 'gcp',
    label: 'Google Cloud',
    freeUsageLimit:
      'NMT: first 500,000 characters / month free (Basic + Advanced NMT share the credit).',
    priceAfterFree: 'US$20 / 1,000,000 characters after the free allowance (NMT).',
    pricingUrl: GCP_TRANSLATE_PRICING_URL,
  },
};

/**
 * Looks up STT pricing metadata for a provider id.
 * @param id - STT provider.
 * @returns Pricing info.
 */
export function sttProviderPricing(
  id: 'openrouter' | 'groq' | 'gcp'
): TranslationProviderPricingInfo {
  return STT_PROVIDER_PRICING[id];
}

/**
 * Looks up text-translate pricing metadata for a provider id.
 * @param id - Translate provider.
 * @returns Pricing info.
 */
export function translateProviderPricing(
  id: 'openrouter' | 'groq' | 'gcp'
): TranslationProviderPricingInfo {
  return TRANSLATE_PROVIDER_PRICING[id];
}
