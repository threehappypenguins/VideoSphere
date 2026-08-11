// =============================================================================
// Live caption translation dispatcher (explicit provider; no auto-fallback)
// =============================================================================

import {
  normalizeTextTranslateProvider,
  type LiveTranslationTextTranslateProvider,
} from '@/lib/translation/capabilities';
import { translateTextWithGcp } from '@/lib/translation/gcp-translate';
import {
  GroqTranslateRateLimitError,
  translateTextWithGroq,
} from '@/lib/translation/groq-translate';
import {
  OpenRouterTranslateRateLimitError,
  translateTextWithOpenRouter,
} from '@/lib/translation/openrouter-translate';

export { GroqTranslateRateLimitError, OpenRouterTranslateRateLimitError };

/**
 * Translates live caption text for a listen language using the owner-selected provider only.
 * Does not fall back across providers when credentials are missing.
 * @param params - Provider, credentials, and text.
 * @returns Translated text.
 */
export async function translateLiveCaptionText(params: {
  provider: LiveTranslationTextTranslateProvider | string | null | undefined;
  gcpServiceAccountJson?: string | null;
  openRouterApiKey?: string | null;
  groqApiKey?: string | null;
  /** Chat model id for OpenRouter or Groq translate. */
  openRouterTranslateModel?: string | null;
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  signal?: AbortSignal;
}): Promise<string> {
  const trimmed = params.text.trim();
  if (!trimmed) return '';

  const provider = normalizeTextTranslateProvider(params.provider);
  if (!provider) {
    throw new Error('Caption translation provider is not configured.');
  }

  if (provider === 'gcp') {
    const gcpJson = params.gcpServiceAccountJson?.trim();
    if (!gcpJson) {
      throw new Error('GCP translation requires a Google Cloud service account on this channel.');
    }
    return translateTextWithGcp({
      serviceAccountJson: gcpJson,
      text: trimmed,
      sourceLanguage: params.sourceLanguage,
      targetLanguage: params.targetLanguage,
    });
  }

  if (provider === 'groq') {
    const apiKey = params.groqApiKey?.trim();
    const model = params.openRouterTranslateModel?.trim();
    if (!apiKey || !model) {
      throw new Error('Groq translation requires a per-user API key and chat model id.');
    }
    return translateTextWithGroq({
      apiKey,
      model,
      text: trimmed,
      sourceLanguage: params.sourceLanguage,
      targetLanguage: params.targetLanguage,
      signal: params.signal,
    });
  }

  const apiKey = params.openRouterApiKey?.trim();
  const model = params.openRouterTranslateModel?.trim();
  if (!apiKey || !model) {
    throw new Error('OpenRouter translation requires a per-user API key and model.');
  }

  return translateTextWithOpenRouter({
    apiKey,
    model,
    text: trimmed,
    sourceLanguage: params.sourceLanguage,
    targetLanguage: params.targetLanguage,
    signal: params.signal,
  });
}
