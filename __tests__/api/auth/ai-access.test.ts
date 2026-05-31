import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

import { GET } from '@/app/api/auth/ai-access/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/auth/ai-access', {
    method: 'GET',
  });
}

describe('GET /api/auth/ai-access', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns false when OPENROUTER_MODEL is missing', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce('user-1');
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test-missing-model');
    vi.stubEnv('OPENROUTER_MODEL', undefined);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.canUseAiMetadata).toBe(false);
  });

  it('returns false when OPENROUTER_API_KEY is missing', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce('user-1');
    vi.stubEnv('OPENROUTER_API_KEY', undefined);
    vi.stubEnv('OPENROUTER_MODEL', 'openai/gpt-4o-mini');

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.canUseAiMetadata).toBe(false);
  });

  it('returns true when OPENROUTER_API_KEY and OPENROUTER_MODEL are set', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce('user-1');
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-valid-key');
    vi.stubEnv('OPENROUTER_MODEL', 'openai/gpt-4o-mini');

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.canUseAiMetadata).toBe(true);
  });

  it('returns true when model list contains primary and fallback values', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce('user-1');
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-valid-key');
    vi.stubEnv('OPENROUTER_MODEL', 'openai/gpt-4o-mini,openai/gpt-4.1-mini');

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.canUseAiMetadata).toBe(true);
  });
});
