// =============================================================================
// OpenRouter AI Client
// =============================================================================
// Sends requests to the OpenRouter chat completions endpoint (OpenAI-compatible
// format) and parses the JSON response into a typed GeneratedMetadata object.
//
// Environment variables required:
//   OPENROUTER_API_KEY — secret key from https://openrouter.ai/
// =============================================================================

import type { GeneratedMetadata } from '@/types';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  response_format: { type: 'json_object' };
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://videosphere.app';
  const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'VideoSphere';

  const requestBody: OpenRouterRequest = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
  };

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
    });
  } catch (err) {
    throw new Error(
      `Failed to connect to OpenRouter API: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (response.status === 429) {
    throw new Error('AI rate limit reached. Please wait a moment and try again.');
  }

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errorBody = await response.json();
      errorDetail = errorBody?.error?.message ?? JSON.stringify(errorBody);
    } catch {
      errorDetail = await response.text().catch(() => '');
    }
    throw new Error(
      `OpenRouter API error (${response.status}): ${errorDetail || response.statusText}`
    );
  }

  let data: OpenRouterResponse;
  try {
    data = (await response.json()) as OpenRouterResponse;
  } catch {
    throw new Error('OpenRouter returned an invalid JSON response');
  }

  const rawContent = data?.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('OpenRouter returned an empty response');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
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
}
