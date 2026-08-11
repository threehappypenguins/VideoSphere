// =============================================================================
// Groq speech-to-text (per-user key + Whisper model; OpenAI-compatible multipart)
// =============================================================================

import { sanitizeSttTranscript } from '@/lib/translation/stt-quality';

/** Drop Whisper segments that look like silence (cloud APIs expose this in verbose_json). */
const NO_SPEECH_PROB_DROP = 0.6;

type GroqVerboseSegment = {
  text?: unknown;
  no_speech_prob?: unknown;
};

/**
 * Joins verbose_json segments that pass the no-speech gate.
 * @param segments - Groq verbose segments.
 * @returns Combined text, or empty when nothing reliable remains.
 */
function textFromVerboseSegments(segments: GroqVerboseSegment[]): string {
  const parts: string[] = [];
  for (const segment of segments) {
    const noSpeech =
      typeof segment.no_speech_prob === 'number' ? segment.no_speech_prob : Number.NaN;
    if (Number.isFinite(noSpeech) && noSpeech >= NO_SPEECH_PROB_DROP) {
      continue;
    }
    const part = typeof segment.text === 'string' ? segment.text.trim() : '';
    if (part) parts.push(part);
  }
  return parts.join(' ').trim();
}

/**
 * Transcribes an audio buffer via Groq `POST /openai/v1/audio/transcriptions`.
 * @param params - Per-user API key, Whisper model id, audio bytes, and optional language hint.
 * @returns Transcribed text (may be empty).
 * @see https://console.groq.com/docs/speech-to-text
 */
export async function transcribeAudioWithGroq(params: {
  apiKey: string;
  model: string;
  audio: Buffer;
  format: string;
  language?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { apiKey, model, audio, format, language, signal } = params;
  if (!apiKey.trim() || !model.trim()) {
    throw new Error('Groq STT requires a per-user API key and model.');
  }
  if (audio.length === 0) {
    return '';
  }

  const ext = format.trim().replace(/^\./, '') || 'wav';
  const mime =
    ext === 'wav'
      ? 'audio/wav'
      : ext === 'mp3'
        ? 'audio/mpeg'
        : ext === 'webm'
          ? 'audio/webm'
          : ext === 'flac'
            ? 'audio/flac'
            : `audio/${ext}`;

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `audio.${ext}`);
  form.append('model', model.trim());
  // verbose_json exposes no_speech_prob; temperature 0 keeps decoding deterministic.
  // Do not send `prompt` — Whisper often leaks/repeats prompt text on silence.
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  if (language?.trim()) {
    form.append('language', language.trim());
  }

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: form,
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `Groq STT error (${response.status}): ${errText.slice(0, 400) || response.statusText}`
    );
  }

  const json = (await response.json()) as {
    text?: unknown;
    segments?: GroqVerboseSegment[];
  };

  let text = '';
  if (Array.isArray(json.segments) && json.segments.length > 0) {
    text = textFromVerboseSegments(json.segments);
  } else if (typeof json.text === 'string') {
    text = json.text.trim();
  }

  return sanitizeSttTranscript(text);
}
