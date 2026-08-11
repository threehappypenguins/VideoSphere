// =============================================================================
// OpenRouter text translation (per-user key + model; no shared defaults)
// =============================================================================

import { translationPromptLanguageName } from '@/lib/translation/languages';
import {
  liveSermonTranslateSystemPrompt,
  liveSermonTranslateUserPrompt,
} from '@/lib/translation/mt-prompt';

/**
 * Thrown when OpenRouter returns HTTP 429 for a translate call.
 */
export class OpenRouterTranslateRateLimitError extends Error {
  /** Seconds to wait from Retry-After when present. */
  readonly retryAfterSeconds: number | null;

  /**
   * @param message - Error message including status/body snippet.
   * @param retryAfterSeconds - Optional Retry-After delay in seconds.
   */
  constructor(message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'OpenRouterTranslateRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Builds OpenRouter model fallbacks for free-tier resilience (provider overload).
 * @param primary - User-configured model id.
 * @returns Models array for the OpenRouter `models` failover parameter.
 */
export function openRouterTranslateModelsList(primary: string): string[] {
  const model = primary.trim();
  if (!model) return [];
  const list = [model];
  // Auto free router helps when a specific `:free` upstream is saturated.
  if (model.endsWith(':free') && model !== 'openrouter/free') {
    list.push('openrouter/free');
  }
  return list;
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
 * Translates source text into a target language via OpenRouter chat completions.
 * @param params - Per-user API key, model, source text, languages, and optional prior context.
 * @returns Translated text.
 */
export async function translateTextWithOpenRouter(params: {
  apiKey: string;
  model: string;
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  /** Prior source finals for idiom/pronoun disambiguation. */
  recentSourceContext?: string | null;
  signal?: AbortSignal;
}): Promise<string> {
  const { apiKey, model, text, sourceLanguage, targetLanguage, recentSourceContext, signal } =
    params;
  if (!apiKey.trim() || !model.trim()) {
    throw new Error('OpenRouter translation requires a per-user API key and model.');
  }
  const trimmed = text.trim();
  if (!trimmed) return '';

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:9624';
  const appName = process.env.NEXT_PUBLIC_APP_NAME?.trim() || 'VideoSphere';
  const sourceName = translationPromptLanguageName(sourceLanguage);
  const targetName = translationPromptLanguageName(targetLanguage);
  const models = openRouterTranslateModelsList(model);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': appUrl,
      'X-Title': appName,
    },
    body: JSON.stringify({
      model: models[0],
      models: models.length > 1 ? models : undefined,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: liveSermonTranslateSystemPrompt(targetLanguage),
        },
        {
          role: 'user',
          content: liveSermonTranslateUserPrompt({
            sourceLanguageName: sourceName,
            targetLanguageName: targetName,
            text: trimmed,
            recentSourceContext,
          }),
        },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const snippet = errText.slice(0, 400) || response.statusText;
    if (response.status === 429) {
      throw new OpenRouterTranslateRateLimitError(
        `OpenRouter translate error (429): ${snippet}`,
        parseRetryAfterSeconds(response.headers.get('retry-after'))
      );
    }
    throw new Error(`OpenRouter translate error (${response.status}): ${snippet}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}
