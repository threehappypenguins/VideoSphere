// =============================================================================
// Live-translation provider free-tier / pricing hints (UI + docs)
// =============================================================================

import type { LiveTranslationSttProvider } from '@/lib/translation/capabilities';

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

/** Groq rate-limits docs (free plan RPM/RPD/ASH). */
export const GROQ_RATE_LIMITS_URL = 'https://console.groq.com/docs/rate-limits';

/** Google Cloud Translation pricing. */
export const GCP_TRANSLATE_PRICING_URL = 'https://cloud.google.com/translate/pricing';

/** Deepgram pricing. */
export const DEEPGRAM_PRICING_URL = 'https://deepgram.com/pricing';

/** AssemblyAI pricing. */
export const ASSEMBLYAI_PRICING_URL = 'https://www.assemblyai.com/pricing';

/** Gladia pricing. */
export const GLADIA_PRICING_URL = 'https://www.gladia.io/pricing';

/** Speechmatics pricing. */
export const SPEECHMATICS_PRICING_URL = 'https://www.speechmatics.com/pricing';

/** Soniox docs / pricing. */
export const SONIOX_DOCS_URL = 'https://soniox.com/docs';

/** Modulate (Velma) API pricing. */
export const MODULATE_PRICING_URL = 'https://platform.modulate.ai/pricing';

/**
 * Speech-to-text provider pricing hints for the Configure AI UI.
 */
export const STT_PROVIDER_PRICING: Record<
  LiveTranslationSttProvider,
  TranslationProviderPricingInfo
> = {
  deepgram: {
    id: 'deepgram',
    label: 'Deepgram',
    freeUsageLimit: 'New accounts typically receive ~$200 signup credit (one-time).',
    priceAfterFree: 'Nova-3 streaming roughly US$0.34–0.46 / hour after credits.',
    pricingUrl: DEEPGRAM_PRICING_URL,
  },
  assemblyai: {
    id: 'assemblyai',
    label: 'AssemblyAI',
    freeUsageLimit: '$50 one-time free credits (no card required).',
    priceAfterFree:
      'Streaming billed on WebSocket session open time (~US$0.15–0.45 / hour by model).',
    pricingUrl: ASSEMBLYAI_PRICING_URL,
  },
  gladia: {
    id: 'gladia',
    label: 'Gladia',
    freeUsageLimit: '€50 one-time free credits (~60+ hours real-time at Starter rates).',
    priceAfterFree: 'Starter real-time ~US$0.75 / hour after credits.',
    pricingUrl: GLADIA_PRICING_URL,
  },
  speechmatics: {
    id: 'speechmatics',
    label: 'Speechmatics',
    freeUsageLimit: '$100 one-time credit to get started (no card required).',
    priceAfterFree: 'Pro usage billed per hour after credits (see portal rates).',
    pricingUrl: SPEECHMATICS_PRICING_URL,
  },
  soniox: {
    id: 'soniox',
    label: 'Soniox',
    freeUsageLimit: 'Check console for trial / credits; STT+translation on one stream.',
    priceAfterFree: 'Real-time STT roughly ~US$0.12 / hour (token-based; confirm in console).',
    pricingUrl: SONIOX_DOCS_URL,
  },
  modulate: {
    id: 'modulate',
    label: 'Modulate',
    freeUsageLimit:
      'New accounts include free credits (1,000 credits / no card) — enough for hundreds of STT hours at published rates.',
    priceAfterFree:
      'Multilingual streaming STT from ~US$0.06 / hour after credits (see Modulate pricing).',
    pricingUrl: MODULATE_PRICING_URL,
  },
  groq: {
    id: 'groq',
    label: 'Groq (chunked fallback)',
    freeUsageLimit:
      'Whisper free plan ≈ 20 RPM / 2,000 RPD · 7,200 audio-seconds/hour · 28,800 audio-seconds/day. Not streaming ASR.',
    priceAfterFree:
      'Developer plan billed per audio hour (see GroqCloud models docs); higher RPM/ASH.',
    pricingUrl: GROQ_RATE_LIMITS_URL,
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
export function sttProviderPricing(id: LiveTranslationSttProvider): TranslationProviderPricingInfo {
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
