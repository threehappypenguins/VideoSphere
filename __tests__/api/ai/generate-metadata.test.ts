/**
 * Tests for POST /api/ai/generate-metadata
 *
 * Covers:
 *   - Authentication (401)
 *   - Input validation (400)
 *   - User not found (404)
 *   - Missing AI config (500)
 *   - Tier-based model selection (free vs premium)
 *   - Platform limit calculation (youtube-only, vimeo-only, both)
 *   - Successful metadata generation (200)
 *   - Defense-in-depth truncation
 *   - Rate-limit forwarding (429)
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

vi.mock('@/lib/repositories', () => ({
  getUserById: vi.fn(),
}));

vi.mock('@/lib/ai/openrouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/openrouter')>();
  return {
    generateMetadata: vi.fn(),
    RateLimitError: actual.RateLimitError,
    OpenRouterTimeoutError: actual.OpenRouterTimeoutError,
  };
});

import {
  POST,
  MAX_GENERATE_METADATA_FILE_NAME_CHARS,
  MAX_GENERATE_METADATA_USER_PROMPT_CHARS,
} from '@/app/api/ai/generate-metadata/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUserById } from '@/lib/repositories';
import { generateMetadata, OpenRouterTimeoutError, RateLimitError } from '@/lib/ai/openrouter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body?: unknown): NextRequest {
  const url = new URL('http://localhost:3000/api/ai/generate-metadata');
  const init: RequestInit = { method: 'POST' };
  const headers: Record<string, string> = {};

  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  init.headers = headers;

  return new NextRequest(url, init);
}

/** Creates a request with a body that is not valid JSON. */
function makeBadJsonRequest(): NextRequest {
  const url = new URL('http://localhost:3000/api/ai/generate-metadata');
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{{not valid json',
  });
}

const freeUser = {
  userId: 'user-123',
  email: 'free@example.com',
  isSupporter: false,
  role: 'user' as const,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

const premiumUser = {
  ...freeUser,
  userId: 'user-456',
  email: 'supporter@example.com',
  isSupporter: true,
};

const validBody = {
  fileName: 'my-video.mp4',
  platforms: ['youtube'],
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('POST /api/ai/generate-metadata', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.OPENROUTER_FREE_MODEL = 'openrouter/free';
    process.env.OPENROUTER_PREMIUM_MODEL = 'openai/gpt-4o';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
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
      const req = makeRequest(['not', 'an', 'object']);
      const res = await POST(req);
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

    it('returns 400 when fileName is not a string', async () => {
      const res = await POST(makeRequest({ fileName: 123, platforms: ['youtube'] }));
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

    it(`returns 400 when fileName exceeds ${MAX_GENERATE_METADATA_FILE_NAME_CHARS} characters`, async () => {
      const longName = 'v'.repeat(MAX_GENERATE_METADATA_FILE_NAME_CHARS + 1);
      const res = await POST(makeRequest({ fileName: longName, platforms: ['youtube'] }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain(String(MAX_GENERATE_METADATA_FILE_NAME_CHARS));
      expect(generateMetadata).not.toHaveBeenCalled();
    });

    it(`returns 400 when userPrompt exceeds ${MAX_GENERATE_METADATA_USER_PROMPT_CHARS} characters`, async () => {
      const longPrompt = 'p'.repeat(MAX_GENERATE_METADATA_USER_PROMPT_CHARS + 1);
      const res = await POST(
        makeRequest({
          fileName: 'video.mp4',
          userPrompt: longPrompt,
          platforms: ['youtube'],
        })
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain(String(MAX_GENERATE_METADATA_USER_PROMPT_CHARS));
      expect(generateMetadata).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // User lookup
  // -----------------------------------------------------------------------

  describe('user lookup', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    });

    it('returns 404 when user is not found in the database', async () => {
      vi.mocked(getUserById).mockResolvedValueOnce(null);

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.message).toBe('User not found');
    });
  });

  // -----------------------------------------------------------------------
  // AI configuration
  // -----------------------------------------------------------------------

  describe('AI configuration', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
      vi.mocked(getUserById).mockResolvedValue(freeUser);
    });

    it('returns 500 when OPENROUTER_FREE_MODEL is not set', async () => {
      delete process.env.OPENROUTER_FREE_MODEL;

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.message).toBe('AI service is not configured');
    });

    it('returns 500 when OPENROUTER_PREMIUM_MODEL is not set', async () => {
      delete process.env.OPENROUTER_PREMIUM_MODEL;

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.message).toBe('AI service is not configured');
    });
  });

  // -----------------------------------------------------------------------
  // Tier-based model selection
  // -----------------------------------------------------------------------

  describe('tier-based model selection', () => {
    it('uses free model for non-supporter users', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
      vi.mocked(getUserById).mockResolvedValue(freeUser);
      vi.mocked(generateMetadata).mockResolvedValueOnce({
        title: 'Title',
        description: 'Desc',
        tags: ['tag'],
      });

      await POST(makeRequest(validBody));

      expect(generateMetadata).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'openrouter/free'
      );
    });

    it('uses premium model for supporter users', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-456');
      vi.mocked(getUserById).mockResolvedValue(premiumUser);
      vi.mocked(generateMetadata).mockResolvedValueOnce({
        title: 'Title',
        description: 'Desc',
        tags: ['tag'],
      });

      await POST(makeRequest(validBody));

      expect(generateMetadata).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'openai/gpt-4o'
      );
    });
  });

  // -----------------------------------------------------------------------
  // Platform limits & system prompt
  // -----------------------------------------------------------------------

  describe('platform limits and prompt construction', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
      vi.mocked(getUserById).mockResolvedValue(freeUser);
      vi.mocked(generateMetadata).mockResolvedValue({
        title: 'Title',
        description: 'Desc',
        tags: ['tag'],
      });
    });

    it('includes YouTube limits in system prompt for youtube platform', async () => {
      await POST(makeRequest({ fileName: 'video.mp4', platforms: ['youtube'] }));

      const systemPrompt = vi.mocked(generateMetadata).mock.calls[0][0];
      expect(systemPrompt).toContain('youtube');
      expect(systemPrompt).toContain('100');
    });

    it('includes Vimeo limits in system prompt for vimeo platform', async () => {
      await POST(makeRequest({ fileName: 'video.mp4', platforms: ['vimeo'] }));

      const systemPrompt = vi.mocked(generateMetadata).mock.calls[0][0];
      expect(systemPrompt).toContain('vimeo');
      expect(systemPrompt).toContain('128');
    });

    it('uses most restrictive limits when both platforms are selected', async () => {
      await POST(makeRequest({ fileName: 'video.mp4', platforms: ['youtube', 'vimeo'] }));

      const systemPrompt = vi.mocked(generateMetadata).mock.calls[0][0];
      // YouTube title limit (100) is more restrictive than Vimeo (128)
      expect(systemPrompt).toContain('max 100 characters');
    });

    it('includes fileName in user prompt', async () => {
      await POST(makeRequest({ fileName: 'cooking-tutorial.mp4', platforms: ['youtube'] }));

      const userPrompt = vi.mocked(generateMetadata).mock.calls[0][1];
      expect(userPrompt).toContain('cooking-tutorial.mp4');
    });

    it('includes userPrompt in user message when provided', async () => {
      await POST(
        makeRequest({
          fileName: 'video.mp4',
          userPrompt: 'A tutorial about cooking pasta',
          platforms: ['youtube'],
        })
      );

      const userMessage = vi.mocked(generateMetadata).mock.calls[0][1];
      expect(userMessage).toContain('A tutorial about cooking pasta');
    });

    it('omits userPrompt line when not provided', async () => {
      await POST(makeRequest({ fileName: 'video.mp4', platforms: ['youtube'] }));

      const userMessage = vi.mocked(generateMetadata).mock.calls[0][1];
      expect(userMessage).not.toContain('Additional context');
    });
  });

  // -----------------------------------------------------------------------
  // Successful generation
  // -----------------------------------------------------------------------

  describe('successful generation', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
      vi.mocked(getUserById).mockResolvedValue(freeUser);
    });

    it('returns 200 with generated metadata', async () => {
      const metadata = {
        title: 'My Cooking Tutorial',
        description: 'Learn to cook pasta the Italian way.',
        tags: ['cooking', 'pasta', 'tutorial', 'Italian', 'food'],
      };
      vi.mocked(generateMetadata).mockResolvedValueOnce(metadata);

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual(metadata);
      expect(body.message).toBe('Metadata generated successfully');
    });
  });

  // -----------------------------------------------------------------------
  // Defense-in-depth: truncation (Issue #39)
  // -----------------------------------------------------------------------

  describe('defense-in-depth truncation', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
      vi.mocked(getUserById).mockResolvedValue(freeUser);
    });

    it('truncates title exceeding YouTube limit (100 chars)', async () => {
      const longTitle = 'A'.repeat(150);
      vi.mocked(generateMetadata).mockResolvedValueOnce({
        title: longTitle,
        description: 'Short desc',
        tags: ['tag'],
      });

      const res = await POST(makeRequest({ fileName: 'video.mp4', platforms: ['youtube'] }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.title).toHaveLength(100);
    });

    it('truncates description exceeding platform limit (5000 chars)', async () => {
      const longDesc = 'B'.repeat(6000);
      vi.mocked(generateMetadata).mockResolvedValueOnce({
        title: 'Title',
        description: longDesc,
        tags: ['tag'],
      });

      const res = await POST(makeRequest({ fileName: 'video.mp4', platforms: ['vimeo'] }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.description).toHaveLength(5000);
    });

    it('applies most restrictive title limit across platforms', async () => {
      const longTitle = 'C'.repeat(120);
      vi.mocked(generateMetadata).mockResolvedValueOnce({
        title: longTitle,
        description: 'Desc',
        tags: ['tag'],
      });

      // Both platforms: YouTube (100) is more restrictive than Vimeo (128)
      const res = await POST(
        makeRequest({ fileName: 'video.mp4', platforms: ['youtube', 'vimeo'] })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.title).toHaveLength(100);
    });

    it('preserves tags without modification', async () => {
      const tags = ['tag1', 'tag2', 'tag3', 'tag4', 'tag5'];
      vi.mocked(generateMetadata).mockResolvedValueOnce({
        title: 'Title',
        description: 'Desc',
        tags,
      });

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.tags).toEqual(tags);
    });
  });

  // -----------------------------------------------------------------------
  // Error forwarding from AI service
  // -----------------------------------------------------------------------

  describe('AI service errors', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
      vi.mocked(getUserById).mockResolvedValue(freeUser);
    });

    it('returns 429 when AI raises a rate-limit error', async () => {
      vi.mocked(generateMetadata).mockRejectedValueOnce(new RateLimitError());

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toBe('Too Many Requests');
    });

    it('returns 504 when AI request times out', async () => {
      vi.mocked(generateMetadata).mockRejectedValueOnce(new OpenRouterTimeoutError());

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(504);
      const body = await res.json();
      expect(body.error).toBe('Gateway Timeout');
      expect(body.message).toMatch(/timed out/i);
    });

    it('returns 502 for generic AI errors', async () => {
      vi.mocked(generateMetadata).mockRejectedValueOnce(
        new Error('OpenRouter API error (500): model overloaded')
      );

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe('Bad Gateway');
      expect(body.message).toBe('AI service is temporarily unavailable. Please try again.');
    });

    it('returns 502 for unknown errors (non-Error throws)', async () => {
      vi.mocked(generateMetadata).mockRejectedValueOnce('unexpected string error');

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(502);
    });
  });
});
