// =============================================================================
// OpenRouter text translation (per-user key + model; no shared defaults)
// =============================================================================

/**
 * Translates source text into a target language via OpenRouter chat completions.
 * @param params - Per-user API key, model, source text, and language codes.
 * @returns Translated text.
 */
export async function translateTextWithOpenRouter(params: {
  apiKey: string;
  model: string;
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { apiKey, model, text, sourceLanguage, targetLanguage, signal } = params;
  if (!apiKey.trim() || !model.trim()) {
    throw new Error('OpenRouter translation requires a per-user API key and model.');
  }
  const trimmed = text.trim();
  if (!trimmed) return '';

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:9624';
  const appName = process.env.NEXT_PUBLIC_APP_NAME?.trim() || 'VideoSphere';

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': appUrl,
      'X-Title': appName,
    },
    body: JSON.stringify({
      model: model.trim(),
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are a precise live interpreter. Translate the user message into the target language. ' +
            'Return ONLY the translation text with no quotes, labels, or commentary.',
        },
        {
          role: 'user',
          content: `Source language: ${sourceLanguage}\nTarget language: ${targetLanguage}\n\nText:\n${trimmed}`,
        },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `OpenRouter translate error (${response.status}): ${errText.slice(0, 400) || response.statusText}`
    );
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}
