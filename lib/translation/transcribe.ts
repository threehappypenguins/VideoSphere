// =============================================================================
// Shared STT dispatcher (OpenRouter, Groq, or GCP)
// =============================================================================

import {
  normalizeSttProvider,
  type LiveTranslationSttProvider,
} from '@/lib/translation/capabilities';
import { transcribeAudioWithGcp } from '@/lib/translation/gcp-stt';
import { transcribeAudioWithGroq } from '@/lib/translation/groq-stt';
import { transcribeAudioWithOpenRouter } from '@/lib/translation/openrouter-stt';

/**
 * Transcribes audio with the owner-configured STT provider.
 * @param params - Provider, credentials, audio payload, and optional language hint.
 * @returns Transcribed text (may be empty).
 */
export async function transcribeAudio(params: {
  provider: LiveTranslationSttProvider | string | null | undefined;
  openRouterApiKey: string | null | undefined;
  groqApiKey: string | null | undefined;
  gcpServiceAccountJson?: string | null;
  model: string;
  audio: Buffer;
  format: string;
  sampleRateHertz?: number;
  language?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const provider = normalizeSttProvider(params.provider);
  if (!provider) {
    throw new Error('STT provider is not configured.');
  }
  const model = params.model.trim();
  if (!model) {
    throw new Error('STT model is required.');
  }

  if (provider === 'gcp') {
    const serviceAccountJson = params.gcpServiceAccountJson?.trim();
    if (!serviceAccountJson) {
      throw new Error('GCP STT requires a per-user service account JSON.');
    }
    return transcribeAudioWithGcp({
      serviceAccountJson,
      model,
      audio: params.audio,
      format: params.format,
      sampleRateHertz: params.sampleRateHertz,
      language: params.language,
    });
  }

  if (provider === 'groq') {
    const apiKey = params.groqApiKey?.trim();
    if (!apiKey) {
      throw new Error('Groq STT requires a per-user API key.');
    }
    return transcribeAudioWithGroq({
      apiKey,
      model,
      audio: params.audio,
      format: params.format,
      language: params.language,
      signal: params.signal,
    });
  }

  const apiKey = params.openRouterApiKey?.trim();
  if (!apiKey) {
    throw new Error('OpenRouter STT requires a per-user API key.');
  }
  return transcribeAudioWithOpenRouter({
    apiKey,
    model,
    audio: params.audio,
    format: params.format,
    language: params.language,
    signal: params.signal,
  });
}
