// =============================================================================
// SSE (Server-Sent Event) parsing utilities for OpenRouter streaming responses
//
// OpenRouter (OpenAI-compatible) SSE format:
//   data: {"id":"...","choices":[{"delta":{"content":"token"},"finish_reason":null}]}
//   data: [DONE]
//
// A single HTTP chunk may contain multiple lines (and therefore multiple events).
// These utilities assemble the token deltas into a single JSON string and detect
// stream completion or upstream error events.
// =============================================================================

/** Result of processing one `data:` SSE line. */
export interface SseLineResult {
  /** Stream is complete — all tokens have been received. */
  done: boolean;
  /** Upstream returned an error event — generation failed. */
  error?: string;
  /** Token text delta from this line (may be empty string). */
  deltaContent?: string;
}

/**
 * Parses a single SSE `data:` line and returns a typed result.
 *
 * @param line - A raw SSE line, e.g. `"data: {...}"` or `"data: [DONE]"`.
 * @returns `null` if the line is not a `data:` line (e.g. comment, empty).
 */
export function parseSseLine(line: string): SseLineResult | null {
  if (!line.startsWith('data: ')) return null;

  const payload = line.slice(6); // everything after "data: "

  if (payload === '[DONE]') return { done: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    // Malformed JSON in a delta — skip
    return { done: false };
  }

  // Upstream error event: { "error": { "message": "..." } } or { "error": "..." }
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if ('error' in obj) {
      const errField = obj.error;
      let msg: string;
      if (typeof errField === 'string') {
        msg = errField;
      } else if (errField !== null && typeof errField === 'object') {
        const errObj = errField as Record<string, unknown>;
        msg = typeof errObj.message === 'string' ? errObj.message : 'Unknown AI error';
      } else {
        msg = 'Unknown AI error';
      }
      return { done: false, error: msg };
    }

    // Normal delta chunk: extract choices[0].delta.content
    const choices = obj.choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const delta = (choices[0] as Record<string, unknown>)?.delta;
      if (delta !== null && typeof delta === 'object') {
        const content = (delta as Record<string, unknown>).content;
        if (typeof content === 'string') {
          return { done: false, deltaContent: content };
        }
      }
    }
  }

  return { done: false };
}

/**
 * Processes a raw SSE HTTP response chunk (which may contain multiple lines)
 * and returns all parsed line results in order.
 *
 * @param chunk - Raw text decoded from a `ReadableStream` chunk.
 */
export function parseSseChunk(chunk: string): SseLineResult[] {
  const results: SseLineResult[] = [];
  for (const line of chunk.split('\n')) {
    const result = parseSseLine(line.trim());
    if (result !== null) results.push(result);
  }
  return results;
}
