/**
 * Tests for lib/ai/openrouter.ts — generateMetadata()
 *
 * Covers:
 *   - Missing API key
 *   - Successful metadata generation
 *   - Custom app URL / app name headers
 *   - Default app URL / app name when env vars are not set
 *   - HTTP 429 rate-limit handling
 *   - Non-OK HTTP responses (with JSON and text error bodies)
 *   - Invalid JSON body in response
 *   - Empty response (no choices)
 *   - AI content that is not valid JSON
 *   - AI content that is not an object (array, null)
 *   - Missing / wrong-type title, description, tags fields
 *   - Network / fetch failure
 *   - Request timeout (AbortController / OpenRouterTimeoutError)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// We stub global.fetch so no real network calls are made.
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import {
  generateMetadata,
  OpenRouterTimeoutError,
  OPENROUTER_FETCH_TIMEOUT_MS,
} from '@/lib/ai/openrouter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock Response for a successful OpenRouter completion. */
function okResponse(content: object | string): Response {
  const aiContent = typeof content === 'string' ? content : JSON.stringify(content);
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: aiContent } }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

/** Build a mock error Response. */
function errorResponse(status: number, body?: object | string, statusText = ''): Response {
  const init: ResponseInit = { status, statusText };
  if (body !== undefined) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, { ...init, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(null, init);
}

const VALID_METADATA = {
  title: 'My Great Video',
  description: 'A description of my great video.',
  tags: ['video', 'tutorial', 'demo'],
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('generateMetadata (OpenRouter client)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test-key');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://test.app');
    vi.stubEnv('NEXT_PUBLIC_APP_NAME', 'TestApp');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // -----------------------------------------------------------------------
  // Environment validation
  // -----------------------------------------------------------------------

  describe('environment validation', () => {
    it('throws when OPENROUTER_API_KEY is not set', async () => {
      delete process.env.OPENROUTER_API_KEY;
      await expect(generateMetadata('system', 'user', 'test-model')).rejects.toThrow(
        'OPENROUTER_API_KEY environment variable is not set'
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Successful response
  // -----------------------------------------------------------------------

  describe('successful response', () => {
    it('returns parsed GeneratedMetadata on a valid response', async () => {
      fetchMock.mockResolvedValueOnce(okResponse(VALID_METADATA));

      const result = await generateMetadata('system prompt', 'user prompt', 'openai/gpt-4o');

      expect(result).toEqual(VALID_METADATA);
    });

    it('sends the correct request structure to OpenRouter', async () => {
      fetchMock.mockResolvedValueOnce(okResponse(VALID_METADATA));

      await generateMetadata('sys', 'usr', 'my-model');

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(init.method).toBe('POST');

      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBe('Bearer sk-test-key');
      expect(headers['HTTP-Referer']).toBe('https://test.app');
      expect(headers['X-Title']).toBe('TestApp');

      const body = JSON.parse(init.body as string);
      expect(body).toEqual({
        models: ['my-model'],
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'usr' },
        ],
        response_format: { type: 'json_object' },
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.signal?.aborted).toBe(false);
    });

    it('uses default app URL and name when env vars are unset', async () => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined);
      vi.stubEnv('NEXT_PUBLIC_APP_NAME', undefined);
      fetchMock.mockResolvedValueOnce(okResponse(VALID_METADATA));

      await generateMetadata('sys', 'usr', 'model');

      const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<
        string,
        string
      >;
      expect(headers['HTTP-Referer']).toBe('https://videosphere.app');
      expect(headers['X-Title']).toBe('VideoSphere');
    });
  });

  // -----------------------------------------------------------------------
  // HTTP error handling
  // -----------------------------------------------------------------------

  describe('HTTP error handling', () => {
    it('throws a rate-limit error on HTTP 429', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(429));
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'AI rate limit reached. Please wait a moment and try again.'
      );
    });

    it('includes JSON error detail for non-OK responses', async () => {
      fetchMock.mockResolvedValueOnce(
        errorResponse(500, { error: { message: 'model overloaded' } })
      );
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'OpenRouter API error (500): model overloaded'
      );
    });

    it('includes provider diagnostic fields when available', async () => {
      fetchMock
        .mockResolvedValueOnce(
          errorResponse(502, {
            error: {
              message: 'Provider returned error.',
              code: 'PROVIDER_ERROR',
              provider: 'openai',
              metadata: { upstreamStatus: 502, requestId: 'req_123' },
            },
          })
        )
        .mockResolvedValueOnce(
          errorResponse(502, {
            error: {
              message: 'Provider returned error.',
              code: 'PROVIDER_ERROR',
              provider: 'openai',
              metadata: { upstreamStatus: 502, requestId: 'req_123' },
            },
          })
        );

      try {
        await generateMetadata('sys', 'usr', 'model');
        throw new Error('Expected generateMetadata to throw');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        expect(msg).toContain('provider=openai');
        expect(msg).toContain('code=PROVIDER_ERROR');
      }
    });

    it('includes stringified body when error.message is missing', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(500, { detail: 'something went wrong' }));
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'OpenRouter API error (500):'
      );
    });

    it('falls back to statusText when body cannot be parsed', async () => {
      const res = new Response('not json', {
        status: 503,
        statusText: 'Service Unavailable',
      });
      fetchMock.mockResolvedValueOnce(res);
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'OpenRouter API error (503)'
      );
    });
  });

  // -----------------------------------------------------------------------
  // Network failure
  // -----------------------------------------------------------------------

  describe('network failure', () => {
    it('wraps fetch errors with a descriptive message', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'Failed to connect to OpenRouter API: ECONNREFUSED'
      );
    });

    it('handles non-Error throw from fetch', async () => {
      fetchMock.mockRejectedValueOnce('network down');
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'Failed to connect to OpenRouter API: network down'
      );
    });
  });

  // -----------------------------------------------------------------------
  // Request timeout
  // -----------------------------------------------------------------------

  describe('request timeout', () => {
    it('throws OpenRouterTimeoutError when fetch does not settle before the deadline', async () => {
      vi.useFakeTimers();
      try {
        fetchMock.mockImplementation((_url, init?: RequestInit) => {
          return new Promise<Response>((resolve, reject) => {
            const signal = init?.signal;
            if (!signal) {
              reject(new Error('expected AbortSignal'));
              return;
            }
            if (signal.aborted) {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
              return;
            }
            signal.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          });
        });

        // Subscribe to generateMetadata before flushing timers so its rejection is never "unhandled"
        await expect(
          Promise.all([
            generateMetadata('sys', 'usr', 'model'),
            vi.advanceTimersByTimeAsync(OPENROUTER_FETCH_TIMEOUT_MS),
          ])
        ).rejects.toThrow(OpenRouterTimeoutError);
      } finally {
        vi.useRealTimers();
      }
    });

    it('maps AbortError from fetch to OpenRouterTimeoutError', async () => {
      const abortErr = new Error('The operation was aborted') as Error & { name: string };
      abortErr.name = 'AbortError';
      fetchMock.mockRejectedValueOnce(abortErr);
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(OpenRouterTimeoutError);
    });
  });

  // -----------------------------------------------------------------------
  // Response body parsing
  // -----------------------------------------------------------------------

  describe('response body parsing', () => {
    it('throws on invalid JSON in the response body', async () => {
      const res = new Response('[[not json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      fetchMock.mockResolvedValueOnce(res);
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'OpenRouter returned an invalid JSON response'
      );
    });

    it('throws when choices array is empty', async () => {
      const res = new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      fetchMock.mockResolvedValueOnce(res);
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'OpenRouter returned an empty response'
      );
    });

    it('throws when message content is empty string', async () => {
      const res = new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      fetchMock.mockResolvedValueOnce(res);
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'OpenRouter returned an empty response'
      );
    });
  });

  // -----------------------------------------------------------------------
  // AI content validation
  // -----------------------------------------------------------------------

  describe('AI content validation', () => {
    it('strips markdown code fences (```json) and parses successfully', async () => {
      const fenced = '```json\n{"title":"T","description":"D","tags":["a"]}\n```';
      const res = new Response(JSON.stringify({ choices: [{ message: { content: fenced } }] }), {
        status: 200,
      });
      fetchMock.mockResolvedValueOnce(res);
      const result = await generateMetadata('sys', 'usr', 'model');
      expect(result).toEqual({ title: 'T', description: 'D', tags: ['a'] });
    });

    it('strips plain code fences (```) and parses successfully', async () => {
      const fenced = '```\n{"title":"T","description":"D","tags":["a"]}\n```';
      const res = new Response(JSON.stringify({ choices: [{ message: { content: fenced } }] }), {
        status: 200,
      });
      fetchMock.mockResolvedValueOnce(res);
      const result = await generateMetadata('sys', 'usr', 'model');
      expect(result).toEqual({ title: 'T', description: 'D', tags: ['a'] });
    });

    it('throws when AI returns non-JSON content', async () => {
      const res = new Response(
        JSON.stringify({
          choices: [{ message: { content: 'This is plain text, not JSON' } }],
        }),
        { status: 200 }
      );
      fetchMock.mockResolvedValueOnce(res);
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'AI response was not valid JSON'
      );
    });

    it('throws when AI returns a JSON array instead of object', async () => {
      const res = new Response(
        JSON.stringify({
          choices: [{ message: { content: '["a","b"]' } }],
        }),
        { status: 200 }
      );
      fetchMock.mockResolvedValueOnce(res);
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'AI response JSON was not an object'
      );
    });

    it('throws when AI returns JSON null', async () => {
      const res = new Response(
        JSON.stringify({
          choices: [{ message: { content: 'null' } }],
        }),
        { status: 200 }
      );
      fetchMock.mockResolvedValueOnce(res);
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'AI response JSON was not an object'
      );
    });

    it('throws when title is missing', async () => {
      fetchMock.mockResolvedValueOnce(okResponse({ description: 'desc', tags: ['a'] }));
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'AI response is missing a valid "title" string field'
      );
    });

    it('throws when title is not a string', async () => {
      fetchMock.mockResolvedValueOnce(okResponse({ title: 123, description: 'desc', tags: ['a'] }));
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'AI response is missing a valid "title" string field'
      );
    });

    it('throws when description is missing', async () => {
      fetchMock.mockResolvedValueOnce(okResponse({ title: 'Title', tags: ['a'] }));
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'AI response is missing a valid "description" string field'
      );
    });

    it('throws when description is not a string', async () => {
      fetchMock.mockResolvedValueOnce(okResponse({ title: 'Title', description: 42, tags: ['a'] }));
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'AI response is missing a valid "description" string field'
      );
    });

    it('throws when tags is missing', async () => {
      fetchMock.mockResolvedValueOnce(okResponse({ title: 'Title', description: 'desc' }));
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'AI response is missing a valid "tags" array of strings'
      );
    });

    it('throws when tags contains non-strings', async () => {
      fetchMock.mockResolvedValueOnce(
        okResponse({ title: 'Title', description: 'desc', tags: ['ok', 123] })
      );
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'AI response is missing a valid "tags" array of strings'
      );
    });

    it('throws when tags is not an array', async () => {
      fetchMock.mockResolvedValueOnce(
        okResponse({ title: 'Title', description: 'desc', tags: 'not-array' })
      );
      await expect(generateMetadata('sys', 'usr', 'model')).rejects.toThrow(
        'AI response is missing a valid "tags" array of strings'
      );
    });
  });
});
