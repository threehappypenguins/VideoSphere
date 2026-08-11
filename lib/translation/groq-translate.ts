// =============================================================================
// Groq chat text translation (per-user key + model; OpenAI-compatible)
// =============================================================================

import { translationPromptLanguageName } from '@/lib/translation/languages';

/**
 * Thrown when Groq returns HTTP 429 for a translate call.
 */
export class GroqTranslateRateLimitError extends Error {
  /** Seconds to wait from Retry-After when present. */
  readonly retryAfterSeconds: number | null;

  /**
   * @param message - Error message including status/body snippet.
   * @param retryAfterSeconds - Optional Retry-After delay in seconds.
   */
  constructor(message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'GroqTranslateRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Parses a Retry-After header value into seconds.
 * @param raw - Header value (delta-seconds or HTTP date).
 * @returns Delay in seconds, or null when absent/invalid.
 */
function parseRetryAfterSeconds(raw: string | null): number | null {
  if (!raw?.trim()) return null;
  const asInt = Number.parseInt(raw.trim(), 10);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt;
  const when = Date.parse(raw);
  if (!Number.isFinite(when)) return null;
  return Math.max(0, Math.ceil((when - Date.now()) / 1000));
}

/**
 * Translates source text into a target language via Groq chat completions.
 * @param params - Per-user API key, model, source text, and language codes.
 * @returns Translated text.
 * @see https://console.groq.com/docs/text-chat
 */
export async function translateTextWithGroq(params: {
  apiKey: string;
  model: string;
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { apiKey, model, text, sourceLanguage, targetLanguage, signal } = params;
  if (!apiKey.trim() || !model.trim()) {
    throw new Error('Groq translation requires a per-user API key and model.');
  }
  const trimmed = text.trim();
  if (!trimmed) return '';

  const sourceName = translationPromptLanguageName(sourceLanguage);
  const targetName = translationPromptLanguageName(targetLanguage);

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model.trim(),
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are a precise live interpreter. Translate the user message into the target language. ' +
            'When the target is Mandarin or Cantonese, write natural text for that variety (not the other). ' +
            'Return ONLY the translation text with no quotes, labels, or commentary.',
        },
        {
          role: 'user',
          content: `Source language: ${sourceName}\nTarget language: ${targetName}\n\nText:\n${trimmed}`,
        },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const snippet = errText.slice(0, 400) || response.statusText;
    if (response.status === 429) {
      throw new GroqTranslateRateLimitError(
        `Groq translate error (429): ${snippet}`,
        parseRetryAfterSeconds(response.headers.get('retry-after'))
      );
    }
    throw new Error(`Groq translate error (${response.status}): ${snippet}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}
