// =============================================================================
// Live translation capability gates (per-user, no shared defaults)
// =============================================================================

import { hasAnyGcpTtsVoice } from '@/lib/translation/gcp-tts-voices';

/**
 * Supported speech-to-text backends for live translation ingest.
 */
export type LiveTranslationSttProvider = 'openrouter' | 'groq';

/**
 * Normalizes a stored or request STT provider value.
 * @param value - Raw provider string.
 * @returns Canonical provider; defaults to `openrouter`.
 */
export function normalizeSttProvider(value: string | null | undefined): LiveTranslationSttProvider {
  return value === 'groq' ? 'groq' : 'openrouter';
}

/**
 * Fields required to evaluate translation / listen readiness.
 */
export interface TranslationCapabilityInput {
  /** Active STT backend. */
  sttProvider?: LiveTranslationSttProvider | string | null;
  /** Whether an OpenRouter API key is stored (required for translation). */
  hasOpenRouterKey: boolean;
  /** Whether a Groq API key is stored (required when STT provider is Groq). */
  hasGroqKey?: boolean;
  /**
   * STT model id for the active provider.
   * Stored historically as `openRouterSttModel` on the channel document.
   */
  sttModel: string | null | undefined;
  /** OpenRouter translation model id. */
  openRouterTranslateModel: string | null | undefined;
  /** Whether a GCP service-account JSON is stored. */
  hasGcpServiceAccount: boolean;
  /** Per-language GCP TTS voice names (ISO code → voice resource name). */
  gcpTtsVoices: Record<string, string> | null | undefined;
}

/**
 * Returns whether captions/translation may run for this channel owner.
 * Requires OpenRouter translate credentials plus STT credentials for the selected provider.
 * @param input - Stored capability fields for one user channel.
 * @returns True when translation is ready.
 */
export function isTranslationReady(input: TranslationCapabilityInput): boolean {
  const provider = normalizeSttProvider(input.sttProvider);
  const hasSttModel = Boolean(input.sttModel?.trim());
  const hasTranslateModel = Boolean(input.openRouterTranslateModel?.trim());
  if (!input.hasOpenRouterKey || !hasTranslateModel || !hasSttModel) {
    return false;
  }
  if (provider === 'groq') {
    return Boolean(input.hasGroqKey);
  }
  return true;
}

/**
 * Returns whether translated TTS listen may run for this channel owner.
 * Requires translation readiness plus GCP SA and at least one language voice.
 * @param input - Stored capability fields for one user channel.
 * @returns True when listen/TTS is ready.
 */
export function isListenReady(input: TranslationCapabilityInput): boolean {
  return (
    isTranslationReady(input) && input.hasGcpServiceAccount && hasAnyGcpTtsVoice(input.gcpTtsVoices)
  );
}
