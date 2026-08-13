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
import {
  clarifySermonSourceForMt,
  repairSermonTranslation,
} from '@/lib/translation/sermon-source-clarify';

export { GroqTranslateRateLimitError, OpenRouterTranslateRateLimitError };

/**
 * Translates live caption text for a listen language using the owner-selected provider only.
 * Does not fall back across providers when credentials are missing.
 * Applies sermon source clarification for all providers, then a Mandarin/Cantonese
 * safety repair when “sin against” is still rendered as fight/defy.
 * @param params - Provider, credentials, text, and optional prior source context.
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
  /**
   * Prior source finals for chat MT disambiguation (ignored by GCP NMT).
   * Prefer several short recent lines over a long dump.
   */
  recentSourceContext?: string | null;
  signal?: AbortSignal;
}): Promise<string> {
  const trimmed = params.text.trim();
  if (!trimmed) return '';

  const provider = normalizeTextTranslateProvider(params.provider);
  if (!provider) {
    throw new Error('Caption translation provider is not configured.');
  }

  const clarified = clarifySermonSourceForMt(trimmed, params.recentSourceContext);

  let translated = '';

  if (provider === 'gcp') {
    const gcpJson = params.gcpServiceAccountJson?.trim();
    if (!gcpJson) {
      throw new Error('GCP translation requires a Google Cloud service account on this channel.');
    }
    translated = await translateTextWithGcp({
      serviceAccountJson: gcpJson,
      text: clarified,
      sourceLanguage: params.sourceLanguage,
      targetLanguage: params.targetLanguage,
      /** Already clarified upstream; skip a second rewrite. */
      skipSermonClarify: true,
    });
  } else if (provider === 'groq') {
    const apiKey = params.groqApiKey?.trim();
    const model = params.openRouterTranslateModel?.trim();
    if (!apiKey || !model) {
      throw new Error('Groq translation requires a per-user API key and chat model id.');
    }
    translated = await translateTextWithGroq({
      apiKey,
      model,
      text: clarified,
      sourceLanguage: params.sourceLanguage,
      targetLanguage: params.targetLanguage,
      recentSourceContext: params.recentSourceContext,
      signal: params.signal,
    });
  } else {
    const apiKey = params.openRouterApiKey?.trim();
    const model = params.openRouterTranslateModel?.trim();
    if (!apiKey || !model) {
      throw new Error('OpenRouter translation requires a per-user API key and model.');
    }

    translated = await translateTextWithOpenRouter({
      apiKey,
      model,
      text: clarified,
      sourceLanguage: params.sourceLanguage,
      targetLanguage: params.targetLanguage,
      recentSourceContext: params.recentSourceContext,
      signal: params.signal,
    });
  }

  return repairSermonTranslation({
    sourceText: `${trimmed}\n${clarified}`,
    recentSourceContext: params.recentSourceContext,
    translatedText: translated,
    targetLanguage: params.targetLanguage,
  });
}
