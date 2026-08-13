// =============================================================================
// Live translation capability gates (per-user, no shared defaults)
// =============================================================================

import { hasAnyGcpTtsVoice } from '@/lib/translation/gcp-tts-voices';

/**
 * Streaming speech-to-text backends (WebSocket ASR).
 */
export type LiveTranslationStreamingSttProvider =
  | 'deepgram'
  | 'assemblyai'
  | 'gladia'
  | 'speechmatics'
  | 'soniox'
  | 'modulate'
  | 'elevenlabs';

/**
 * Supported speech-to-text backends for live translation ingest.
 * `groq` is chunked Whisper (free-tier fallback); all others are streaming ASR.
 */
export type LiveTranslationSttProvider = LiveTranslationStreamingSttProvider | 'groq';

/**
 * Supported caption text-translation backends (explicit choice; no auto-fallback).
 * Unused when STT is Soniox (combined STT+MT).
 */
export type LiveTranslationTextTranslateProvider = 'openrouter' | 'groq' | 'gcp';

/** Credential storage kinds for DELETE /api/translation/credentials/:kind. */
export type LiveTranslationCredentialKind =
  | 'openrouter'
  | 'groq'
  | 'gcp'
  | 'deepgram'
  | 'assemblyai'
  | 'gladia'
  | 'speechmatics'
  | 'soniox'
  | 'modulate'
  | 'elevenlabs';

const STREAMING_STT_PROVIDERS: ReadonlySet<string> = new Set([
  'deepgram',
  'assemblyai',
  'gladia',
  'speechmatics',
  'soniox',
  'modulate',
  'elevenlabs',
]);

/**
 * Returns whether the STT provider uses streaming WebSocket ASR.
 * @param provider - Canonical STT provider, or null.
 * @returns True for Deepgram / AssemblyAI / Gladia / Speechmatics / Soniox / Modulate / ElevenLabs.
 */
export function isStreamingSttProvider(
  provider: LiveTranslationSttProvider | string | null | undefined
): boolean {
  return typeof provider === 'string' && STREAMING_STT_PROVIDERS.has(provider);
}

/**
 * Returns whether the STT provider also delivers translated captions (skips MT).
 * @param provider - Canonical STT provider, or null.
 * @returns True only for Soniox.
 */
export function sttProvidesBuiltInTranslation(
  provider: LiveTranslationSttProvider | string | null | undefined
): boolean {
  return provider === 'soniox';
}

/**
 * Normalizes a stored or request STT provider value.
 * Legacy `openrouter` / `gcp` STT values are treated as unset (force reconfigure).
 * @param value - Raw provider string.
 * @returns Canonical provider, or `null` when unset/unknown (no implicit default).
 */
export function normalizeSttProvider(
  value: string | null | undefined
): LiveTranslationSttProvider | null {
  if (
    value === 'groq' ||
    value === 'deepgram' ||
    value === 'assemblyai' ||
    value === 'gladia' ||
    value === 'speechmatics' ||
    value === 'soniox' ||
    value === 'modulate' ||
    value === 'elevenlabs'
  ) {
    return value;
  }
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
 * Normalizes a credential kind path param.
 * @param value - Raw kind string.
 * @returns Canonical kind, or null.
 */
export function normalizeCredentialKind(
  value: string | null | undefined
): LiveTranslationCredentialKind | null {
  if (
    value === 'openrouter' ||
    value === 'groq' ||
    value === 'gcp' ||
    value === 'deepgram' ||
    value === 'assemblyai' ||
    value === 'gladia' ||
    value === 'speechmatics' ||
    value === 'soniox' ||
    value === 'modulate' ||
    value === 'elevenlabs'
  ) {
    return value;
  }
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
  /** Whether a Deepgram API key is stored. */
  hasDeepgramKey?: boolean;
  /** Whether an AssemblyAI API key is stored. */
  hasAssemblyaiKey?: boolean;
  /** Whether a Gladia API key is stored. */
  hasGladiaKey?: boolean;
  /** Whether a Speechmatics API key is stored. */
  hasSpeechmaticsKey?: boolean;
  /** Whether a Soniox API key is stored. */
  hasSonioxKey?: boolean;
  /** Whether a Modulate API key is stored. */
  hasModulateKey?: boolean;
  /** Whether an ElevenLabs API key is stored. */
  hasElevenLabsKey?: boolean;
  /**
   * STT model id for chunked Groq Whisper.
   * Unused for streaming ASR providers.
   */
  sttModel: string | null | undefined;
  /**
   * Chat translation model id for OpenRouter or Groq translate.
   * Unused when text translate provider is GCP, or when STT is Soniox.
   */
  openRouterTranslateModel: string | null | undefined;
  /** Whether a GCP service-account JSON is stored (Translation / TTS). */
  hasGcpServiceAccount: boolean;
  /** Per-language GCP TTS voice names (ISO code → voice resource name). */
  gcpTtsVoices: Record<string, string> | null | undefined;
}

/**
 * Resolves the effective text-translate provider for capability checks.
 * @param input - Capability fields.
 * @returns Canonical provider, or `null` when unset (or when Soniox STT embeds MT).
 */
export function effectiveTextTranslateProvider(
  input: TranslationCapabilityInput
): LiveTranslationTextTranslateProvider | null {
  if (sttProvidesBuiltInTranslation(normalizeSttProvider(input.sttProvider))) {
    return null;
  }
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
  if (provider === 'groq') {
    return Boolean(input.hasGroqKey && input.sttModel?.trim());
  }
  if (provider === 'deepgram') return Boolean(input.hasDeepgramKey);
  if (provider === 'assemblyai') return Boolean(input.hasAssemblyaiKey);
  if (provider === 'gladia') return Boolean(input.hasGladiaKey);
  if (provider === 'speechmatics') return Boolean(input.hasSpeechmaticsKey);
  if (provider === 'soniox') return Boolean(input.hasSonioxKey);
  if (provider === 'modulate') return Boolean(input.hasModulateKey);
  if (provider === 'elevenlabs') return Boolean(input.hasElevenLabsKey);
  return false;
}

/**
 * Returns whether a text-translation backend is configured for the selected provider.
 * Soniox STT always returns true (built-in translation).
 * @param input - Stored capability fields for one user channel.
 * @returns True when non-source captions can be translated.
 */
export function isTextTranslateReady(input: TranslationCapabilityInput): boolean {
  const stt = normalizeSttProvider(input.sttProvider);
  if (sttProvidesBuiltInTranslation(stt)) {
    return isSttReady(input);
  }
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
 * Needs STT credentials plus the selected text-translate provider (unless Soniox).
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
