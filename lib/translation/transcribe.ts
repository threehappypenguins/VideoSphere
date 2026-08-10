// =============================================================================
// Shared STT dispatcher (OpenRouter or Groq)
// =============================================================================

import { transcribeAudioWithGroq } from '@/lib/translation/groq-stt';
import { transcribeAudioWithOpenRouter } from '@/lib/translation/openrouter-stt';
import {
  normalizeSttProvider,
  type LiveTranslationSttProvider,
} from '@/lib/translation/capabilities';

/**
 * Transcribes audio with the owner-configured STT provider.
 * @param params - Provider, credentials, audio payload, and optional language hint.
 * @returns Transcribed text (may be empty).
 */
export async function transcribeAudio(params: {
  provider: LiveTranslationSttProvider | string | null | undefined;
  openRouterApiKey: string | null | undefined;
  groqApiKey: string | null | undefined;
  model: string;
  audio: Buffer;
  format: string;
  language?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const provider = normalizeSttProvider(params.provider);
  const model = params.model.trim();
  if (!model) {
    throw new Error('STT model is required.');
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
