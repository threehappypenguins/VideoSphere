// =============================================================================
// Shared STT dispatcher (Groq chunked Whisper only)
// =============================================================================

import { normalizeSttProvider } from '@/lib/translation/capabilities';
import { transcribeAudioWithGroq } from '@/lib/translation/groq-stt';

/**
 * Transcribes audio with Groq Whisper (chunked free-tier fallback).
 * Streaming ASR providers are handled by `lib/translation/streaming-asr`.
 * @param params - Credentials, audio payload, and optional language hint.
 * @returns Transcribed text (may be empty).
 */
export async function transcribeAudio(params: {
  provider: string | null | undefined;
  openRouterApiKey?: string | null | undefined;
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
  if (provider !== 'groq') {
    throw new Error(
      'Chunked STT is only available for Groq. Use a streaming ASR provider instead.'
    );
  }
  const model = params.model.trim();
  if (!model) {
    throw new Error('STT model is required.');
  }
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
