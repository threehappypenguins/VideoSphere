// =============================================================================
// Groq speech-to-text (per-user key + Whisper model; OpenAI-compatible multipart)
// =============================================================================

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
  form.append('response_format', 'json');
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

  const json = (await response.json()) as { text?: unknown };
  return typeof json.text === 'string' ? json.text.trim() : '';
}
