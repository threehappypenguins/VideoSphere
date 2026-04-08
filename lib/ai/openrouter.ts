// =============================================================================
// OpenRouter AI Client
// =============================================================================
// Sends requests to the OpenRouter chat completions endpoint (OpenAI-compatible
// format) and parses the JSON response into a typed GeneratedMetadata object.
//
// Environment variables required:
//   OPENROUTER_API_KEY — secret key from https://openrouter.ai/
//
// Requests use AbortController + OPENROUTER_FETCH_TIMEOUT_MS so slow upstream
// cannot hold a serverless invocation open indefinitely (PRD under-10s target).
// =============================================================================

import type { GeneratedMetadata } from '@/types';

/**
 * Provides rate limit error behavior.
 */
export class RateLimitError extends Error {
  constructor(message = 'AI rate limit reached. Please wait a moment and try again.') {
    super(message);
    this.name = 'RateLimitError';
  }
}

/** Wall-clock bound for the HTTP request and reading the response body (PRD response-time target). */
export const OPENROUTER_FETCH_TIMEOUT_MS = 10_000;

/** Thrown when the OpenRouter request exceeds {@link OPENROUTER_FETCH_TIMEOUT_MS} ms. */
export class OpenRouterTimeoutError extends Error {
  constructor(
    message = 'OpenRouter request timed out. The AI service took too long to respond — please try again.'
  ) {
    super(message);
    this.name = 'OpenRouterTimeoutError';
  }
}

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return true;
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause instanceof Error && cause.name === 'AbortError') return true;
  return false;
}

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  response_format?: { type: 'json_object' };
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatOpenRouterErrorDetail(rawText: string, statusText: string): string {
  if (!rawText.trim()) return statusText;

  try {
    const parsed = JSON.parse(rawText) as {
      error?: {
        message?: string;
        code?: string | number;
        provider?: string;
        metadata?: unknown;
      };
      [key: string]: unknown;
    };
    const top = parsed?.error;
    const msg = typeof top?.message === 'string' ? top.message : '';
    const code = top?.code != null ? ` code=${String(top.code)}` : '';
    const provider = typeof top?.provider === 'string' ? ` provider=${top.provider}` : '';
    const metadata =
      top?.metadata !== undefined ? ` metadata=${truncate(JSON.stringify(top.metadata), 500)}` : '';

    const compact = truncate(JSON.stringify(parsed), 700);
    return `${msg || statusText}${code}${provider}${metadata}` + (compact ? ` raw=${compact}` : '');
  } catch {
    return truncate(rawText, 700);
  }
}

function getTimeoutMsForModel(model: string): number {
  void model;
  const envTimeout = Number.parseInt(process.env.OPENROUTER_FETCH_TIMEOUT_MS ?? '', 10);
  if (Number.isFinite(envTimeout) && envTimeout > 0) {
    return envTimeout;
  }
  return OPENROUTER_FETCH_TIMEOUT_MS;
}

async function requestMetadataFromOpenRouter(
  requestBody: OpenRouterRequest,
  apiKey: string,
  appUrl: string,
  appName: string
): Promise<GeneratedMetadata> {
  const controller = new AbortController();
  const timeoutMs = getTimeoutMsForModel(requestBody.model);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': appUrl,
          'X-Title': appName,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw new OpenRouterTimeoutError();
      }
      throw new Error(`Failed to connect to OpenRouter API: ${getErrorMessage(err)}`);
    }

    if (response.status === 429) {
      throw new RateLimitError();
    }

    if (!response.ok) {
      let errorDetail = '';
      try {
        const text = await response.text();
        errorDetail = formatOpenRouterErrorDetail(text, response.statusText);
      } catch (err) {
        if (isAbortError(err)) {
          throw new OpenRouterTimeoutError();
        }
        errorDetail = '';
      }
      throw new Error(
        `OpenRouter API error (${response.status}): ${errorDetail || response.statusText}`
      );
    }

    let data: OpenRouterResponse;
    try {
      data = (await response.json()) as OpenRouterResponse;
    } catch (err) {
      if (isAbortError(err)) {
        throw new OpenRouterTimeoutError();
      }
      throw new Error('OpenRouter returned an invalid JSON response');
    }

    const rawContent = data?.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error('OpenRouter returned an empty response');
    }

    // Some models wrap their response in markdown code fences (```json ... ```)
    // despite instructions not to. Strip them before parsing.
    const cleaned = rawContent
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`AI response was not valid JSON. Received: ${rawContent.slice(0, 200)}`);
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('AI response JSON was not an object');
    }

    const obj = parsed as Record<string, unknown>;

    if (typeof obj.title !== 'string') {
      throw new Error('AI response is missing a valid "title" string field');
    }
    if (typeof obj.description !== 'string') {
      throw new Error('AI response is missing a valid "description" string field');
    }
    if (!Array.isArray(obj.tags) || !obj.tags.every((t) => typeof t === 'string')) {
      throw new Error('AI response is missing a valid "tags" array of strings');
    }

    return {
      title: obj.title,
      description: obj.description,
      tags: obj.tags as string[],
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildOpenRouterRequestBody(
  model: string,
  systemPrompt: string,
  userPrompt: string
): OpenRouterRequest {
  return {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
  };
}

/**
 * Sends a chat completion request to OpenRouter and parses the response into
 * a typed GeneratedMetadata object with title, description, and tags fields.
 *
 * @param systemPrompt - Instructions for the AI (platform limits, format, etc.)
 * @param userPrompt   - The user-facing content (filename, context)
 * @param model        - OpenRouter model identifier (e.g. "openai/gpt-4o")
 * @throws Error if the API key is missing, the request fails, or the response
 *         is malformed / missing required fields.
 */
export async function generateMetadata(
  systemPrompt: string,
  userPrompt: string,
  model: string
): Promise<GeneratedMetadata> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is not set');
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    'https://videosphere.app';
  const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'VideoSphere';
  return requestMetadataFromOpenRouter(
    buildOpenRouterRequestBody(model, systemPrompt, userPrompt),
    apiKey,
    appUrl,
    appName
  );
}

/**
 * Opens a streaming chat completion request to OpenRouter and returns the raw
 * upstream `Response` object whose body is an SSE `text/event-stream`.
 *
 * The caller is responsible for piping `response.body` to the client.
 * The request is aborted when `signal` fires (i.e. client disconnect).
 *
 * @param systemPrompt - Instructions for the AI
 * @param userPrompt   - The user-facing content
 * @param model        - OpenRouter model identifier
 * @param signal       - Optional AbortSignal (e.g. from the Next.js request)
 * @throws RateLimitError on HTTP 429
 * @throws Error on any other non-2xx or network failure
 */
export async function streamMetadata(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  signal?: AbortSignal
): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is not set');
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    'https://videosphere.app';
  const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'VideoSphere';

  const requestBody = {
    ...buildOpenRouterRequestBody(model, systemPrompt, userPrompt),
    stream: true,
  };

  // Guard the connection with the same configurable timeout used by the
  // non-streaming path.  The caller's disconnect signal is composed via
  // AbortSignal.any so that either a timeout or a client disconnect will cancel
  // the fetch — and the combined signal remains active for the full lifetime of
  // the stream, preventing upstream connection leaks after headers arrive.
  const timeoutMs = getTimeoutMsForModel(requestBody.model);
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  const signals = signal ? [timeoutController.signal, signal] : [timeoutController.signal];
  const combinedSignal = AbortSignal.any(signals);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': appUrl,
        'X-Title': appName,
      },
      body: JSON.stringify(requestBody),
      signal: combinedSignal,
    });
  } catch (err) {
    if (isAbortError(err)) {
      if (timeoutController.signal.aborted) throw new OpenRouterTimeoutError();
      throw err; // propagate caller disconnect so the route can respond accordingly
    }
    throw new Error(`Failed to connect to OpenRouter API: ${getErrorMessage(err)}`);
  } finally {
    // Clear the timeout regardless of outcome — the combined signal keeps
    // the caller-disconnect path active for the body stream via AbortSignal.any.
    clearTimeout(timeoutId);
  }

  if (response.status === 429) {
    throw new RateLimitError();
  }

  if (!response.ok) {
    let errorDetail = '';
    try {
      const text = await response.text();
      errorDetail = formatOpenRouterErrorDetail(text, response.statusText);
    } catch {
      errorDetail = response.statusText;
    }
    throw new Error(
      `OpenRouter API error (${response.status}): ${errorDetail || response.statusText}`
    );
  }

  return response;
}
