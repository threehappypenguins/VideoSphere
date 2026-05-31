/**
 * Tests for POST /api/ai/generate-metadata/stream
 *
 * Covers:
 *   - Authentication (401)
 *   - Input validation (400)
 *   - Missing AI config (500)
 *   - Happy path: 200 text/event-stream with upstream body piped through
 *   - Rate-limit forwarding (429)
 *   - Timeout forwarding (504)
 *   - Client disconnect (499)
 *   - AI service errors (502)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the import of the route module
// ---------------------------------------------------------------------------

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/ai/openrouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/openrouter')>();
  return {
    streamMetadata: vi.fn(),
    RateLimitError: actual.RateLimitError,
    OpenRouterTimeoutError: actual.OpenRouterTimeoutError,
  };
});

import { POST } from '@/app/api/ai/generate-metadata/stream/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { streamMetadata, OpenRouterTimeoutError, RateLimitError } from '@/lib/ai/openrouter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body?: unknown): NextRequest {
  const url = new URL('http://localhost:3000/api/ai/generate-metadata/stream');
  const init: RequestInit = { method: 'POST' };
  const headers: Record<string, string> = {};

  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  init.headers = headers;

  return new NextRequest(url, init);
}

function makeBadJsonRequest(): NextRequest {
  const url = new URL('http://localhost:3000/api/ai/generate-metadata/stream');
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{{not valid json',
  });
}

/** Creates a minimal mock Response with a ReadableStream body. */
function makeSseResponse(chunks: string[] = ['data: [DONE]\n']): Response {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const validBody = {
  fileName: 'my-video.mp4',
  platforms: ['youtube'],
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('POST /api/ai/generate-metadata/stream', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test-key');
    vi.stubEnv('OPENROUTER_MODEL', 'openrouter/default');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // -----------------------------------------------------------------------
  // Authentication
  // -----------------------------------------------------------------------

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
      expect(body.message).toBe('Not authenticated');
    });
  });

  // -----------------------------------------------------------------------
  // Input validation
  // -----------------------------------------------------------------------

  describe('input validation', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await POST(makeBadJsonRequest());
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toBe('Invalid JSON body');
    });

    it('returns 400 when body is an array', async () => {
      const res = await POST(makeRequest(['not', 'an', 'object']));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toBe('Request body must be a JSON object');
    });

    it('returns 400 when fileName is missing', async () => {
      const res = await POST(makeRequest({ platforms: ['youtube'] }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toBe('fileName is required');
    });

    it('returns 400 when fileName is empty string', async () => {
      const res = await POST(makeRequest({ fileName: '  ', platforms: ['youtube'] }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toBe('fileName is required');
    });

    it('returns 400 when userPrompt is provided but not a string', async () => {
      const res = await POST(
        makeRequest({ fileName: 'video.mp4', userPrompt: 123, platforms: ['youtube'] })
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toBe('userPrompt must be a string');
    });

    it('returns 400 when platforms is missing', async () => {
      const res = await POST(makeRequest({ fileName: 'video.mp4' }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toMatch(/platforms/i);
    });

    it('returns 400 when platforms is empty array', async () => {
      const res = await POST(makeRequest({ fileName: 'video.mp4', platforms: [] }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toMatch(/platforms/i);
    });

    it('returns 400 when platforms contains invalid value', async () => {
      const res = await POST(makeRequest({ fileName: 'video.mp4', platforms: ['tiktok'] }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toMatch(/platforms/i);
    });
  });

  // -----------------------------------------------------------------------
  // AI configuration
  // -----------------------------------------------------------------------

  describe('AI configuration', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    });

    it('returns 500 when OPENROUTER_API_KEY is not set', async () => {
      vi.stubEnv('OPENROUTER_API_KEY', undefined);

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.message).toBe('AI service is not configured');
      expect(streamMetadata).not.toHaveBeenCalled();
    });

    it('returns 500 when OPENROUTER_MODEL is not set', async () => {
      vi.stubEnv('OPENROUTER_MODEL', undefined);

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.message).toBe('AI service is not configured');
      expect(streamMetadata).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Happy path — SSE passthrough
  // -----------------------------------------------------------------------

  describe('successful streaming', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    });

    it('returns 200 with Content-Type text/event-stream', async () => {
      vi.mocked(streamMetadata).mockResolvedValueOnce(makeSseResponse());

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    });

    it('pipes the upstream body directly to the client', async () => {
      const sseChunks = ['data: {"choices":[{"delta":{"content":"hello"}}]}\n', 'data: [DONE]\n'];
      vi.mocked(streamMetadata).mockResolvedValueOnce(makeSseResponse(sseChunks));

      const res = await POST(makeRequest(validBody));

      expect(res.body).not.toBeNull();
      const text = await res.text();
      expect(text).toContain('data: [DONE]');
    });

    it('uses OPENROUTER_MODEL for authenticated users', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
      vi.mocked(streamMetadata).mockResolvedValueOnce(makeSseResponse());

      await POST(makeRequest(validBody));

      expect(streamMetadata).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'openrouter/default',
        expect.anything(),
        undefined
      );
    });

    it('passes fallback models when OPENROUTER_MODEL is a comma-separated list', async () => {
      vi.stubEnv('OPENROUTER_MODEL', 'model-a, model-b , model-c');
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
      vi.mocked(streamMetadata).mockResolvedValueOnce(makeSseResponse());

      await POST(makeRequest(validBody));

      expect(streamMetadata).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'model-a',
        expect.anything(),
        ['model-b', 'model-c']
      );
    });
  });

  // -----------------------------------------------------------------------
  // Error forwarding from AI service
  // -----------------------------------------------------------------------

  describe('AI service errors', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    });

    it('returns 429 when AI raises a rate-limit error', async () => {
      vi.mocked(streamMetadata).mockRejectedValueOnce(new RateLimitError());

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toBe('Too Many Requests');
    });

    it('returns 504 when AI request times out', async () => {
      vi.mocked(streamMetadata).mockRejectedValueOnce(new OpenRouterTimeoutError());

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(504);
      const body = await res.json();
      expect(body.error).toBe('Gateway Timeout');
      expect(body.message).toMatch(/timed out/i);
    });

    it('returns 499 on client disconnect (AbortError)', async () => {
      const abortErr = new DOMException('The user aborted a request.', 'AbortError');
      vi.mocked(streamMetadata).mockRejectedValueOnce(abortErr);

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(499);
    });

    it('returns 502 for generic AI errors', async () => {
      vi.mocked(streamMetadata).mockRejectedValueOnce(
        new Error('OpenRouter API error (500): model overloaded')
      );

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe('Bad Gateway');
      expect(body.message).toContain('AI service is temporarily unavailable. Please try again.');
    });

    it('returns 502 for unknown errors (non-Error throws)', async () => {
      vi.mocked(streamMetadata).mockRejectedValueOnce('unexpected string error');

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(502);
    });

    it('returns 502 when upstream response has no body', async () => {
      vi.mocked(streamMetadata).mockResolvedValueOnce(new Response(null, { status: 200 }));

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.message).toContain('empty response');
    });
  });
});
