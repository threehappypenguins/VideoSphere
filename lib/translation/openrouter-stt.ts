// =============================================================================
// OpenRouter speech-to-text (per-user key + model; no shared defaults)
// =============================================================================

/**
 * Transcribes an audio buffer via OpenRouter `/api/v1/audio/transcriptions`.
 * @param params - Per-user API key, model, audio bytes, and optional language hint.
 * @returns Transcribed text (may be empty).
 */
export async function transcribeAudioWithOpenRouter(params: {
  apiKey: string;
  model: string;
  audio: Buffer;
  format: string;
  language?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { apiKey, model, audio, format, language, signal } = params;
  if (!apiKey.trim() || !model.trim()) {
    throw new Error('OpenRouter STT requires a per-user API key and model.');
  }
  if (audio.length === 0) {
    return '';
  }

  const body: Record<string, unknown> = {
    model: model.trim(),
    input_audio: {
      data: audio.toString('base64'),
      format,
    },
  };
  if (language?.trim()) {
    body.language = language.trim();
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:9624';
  const appName = process.env.NEXT_PUBLIC_APP_NAME?.trim() || 'VideoSphere';

  const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': appUrl,
      'X-Title': appName,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `OpenRouter STT error (${response.status}): ${errText.slice(0, 400) || response.statusText}`
    );
  }

  const json = (await response.json()) as { text?: unknown };
  return typeof json.text === 'string' ? json.text.trim() : '';
}
