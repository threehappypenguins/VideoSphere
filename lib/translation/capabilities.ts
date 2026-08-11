// =============================================================================
// Live translation capability gates (per-user, no shared defaults)
// =============================================================================

import { hasAnyGcpTtsVoice } from '@/lib/translation/gcp-tts-voices';

/**
 * Supported speech-to-text backends for live translation ingest.
 */
export type LiveTranslationSttProvider = 'openrouter' | 'groq' | 'gcp';

/**
 * Supported caption text-translation backends (explicit choice; no auto-fallback).
 */
export type LiveTranslationTextTranslateProvider = 'openrouter' | 'groq' | 'gcp';

/**
 * Normalizes a stored or request STT provider value.
 * @param value - Raw provider string.
 * @returns Canonical provider, or `null` when unset/unknown (no implicit default).
 */
export function normalizeSttProvider(
  value: string | null | undefined
): LiveTranslationSttProvider | null {
  if (value === 'groq' || value === 'gcp' || value === 'openrouter') return value;
  return null;
}

/**
 * Normalizes a stored or request text-translate provider value.
 * @param value - Raw provider string.
 * @returns Canonical provider, or `null` when unset/unknown (no implicit default).
 */
export function normalizeTextTranslateProvider(
  value: string | null | undefined
): LiveTranslationTextTranslateProvider | null {
  if (value === 'groq' || value === 'gcp' || value === 'openrouter') return value;
  return null;
}

/**
 * Fields required to evaluate translation / listen readiness.
 */
export interface TranslationCapabilityInput {
  /** Active STT backend. */
  sttProvider?: LiveTranslationSttProvider | string | null;
  /** Active caption translation backend. */
  textTranslateProvider?: LiveTranslationTextTranslateProvider | string | null;
  /** Whether an OpenRouter API key is stored. */
  hasOpenRouterKey: boolean;
  /** Whether a Groq API key is stored. */
  hasGroqKey?: boolean;
  /**
   * STT model id for the active provider.
   * Stored historically as `openRouterSttModel` on the channel document.
   */
  sttModel: string | null | undefined;
  /**
   * Chat translation model id for OpenRouter or Groq translate.
   * Unused when text translate provider is GCP.
   */
  openRouterTranslateModel: string | null | undefined;
  /** Whether a GCP service-account JSON is stored (Speech / Translation / TTS). */
  hasGcpServiceAccount: boolean;
  /** Per-language GCP TTS voice names (ISO code → voice resource name). */
  gcpTtsVoices: Record<string, string> | null | undefined;
}

/**
 * Resolves the effective text-translate provider for capability checks.
 * @param input - Capability fields.
 * @returns Canonical provider, or `null` when unset.
 */
export function effectiveTextTranslateProvider(
  input: TranslationCapabilityInput
): LiveTranslationTextTranslateProvider | null {
  return normalizeTextTranslateProvider(input.textTranslateProvider);
}

/**
 * Returns whether caption STT credentials are present for the selected provider.
 * @param input - Stored capability fields for one user channel.
 * @returns True when STT can run.
 */
export function isSttReady(input: TranslationCapabilityInput): boolean {
  const provider = normalizeSttProvider(input.sttProvider);
  if (!provider) return false;
  const hasSttModel = Boolean(input.sttModel?.trim());
  if (!hasSttModel) return false;
  if (provider === 'groq') return Boolean(input.hasGroqKey);
  if (provider === 'gcp') return Boolean(input.hasGcpServiceAccount);
  return Boolean(input.hasOpenRouterKey);
}

/**
 * Returns whether a text-translation backend is configured for the selected provider.
 * @param input - Stored capability fields for one user channel.
 * @returns True when non-source captions can be translated.
 */
export function isTextTranslateReady(input: TranslationCapabilityInput): boolean {
  const provider = effectiveTextTranslateProvider(input);
  if (!provider) return false;
  if (provider === 'gcp') return Boolean(input.hasGcpServiceAccount);
  if (provider === 'groq') {
    return Boolean(input.hasGroqKey && input.openRouterTranslateModel?.trim());
  }
  return Boolean(input.hasOpenRouterKey && input.openRouterTranslateModel?.trim());
}

/**
 * Returns whether captions/translation may run for this channel owner.
 * Needs STT credentials plus the selected text-translate provider.
 * @param input - Stored capability fields for one user channel.
 * @returns True when translation is ready.
 */
export function isTranslationReady(input: TranslationCapabilityInput): boolean {
  return isSttReady(input) && isTextTranslateReady(input);
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
