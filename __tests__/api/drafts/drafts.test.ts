/**
 * Tests for POST /api/drafts and GET /api/drafts
 *
 * Covers authentication, input validation, and successful responses.
 * Mocks Appwrite and the drafts repository to isolate route logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mock node-appwrite — must be defined before importing the route
// ---------------------------------------------------------------------------

const mockAccountGet = vi.fn();

vi.mock('node-appwrite', () => {
  const mockClient = {
    setEndpoint: vi.fn(function () {
      return this;
    }),
    setProject: vi.fn(function () {
      return this;
    }),
    setSession: vi.fn(function () {
      return this;
    }),
  };

  function MockClient() {
    return mockClient;
  }

  function MockAccount(_client: unknown) {
    this.get = mockAccountGet;
  }

  return { Client: MockClient, Account: MockAccount };
});

// ---------------------------------------------------------------------------
// Mock drafts repository
// ---------------------------------------------------------------------------

vi.mock('@/lib/repositories/drafts', () => ({
  createDraft: vi.fn(),
  listDraftsByUser: vi.fn(),
}));

import { POST, GET } from '@/app/api/drafts/route';
import { createDraft, listDraftsByUser } from '@/lib/repositories/drafts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_COOKIE = 'a_session_test-project';

function makeRequest(
  method: string,
  body?: Record<string, unknown>,
  cookies: Record<string, string> = {}
): NextRequest {
  const url = new URL('http://localhost:3000/api/drafts');
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  const init: RequestInit = { method };
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  if (cookieHeader) headers['Cookie'] = cookieHeader;
  init.headers = headers;

  return new NextRequest(url, init);
}

const baseDraft = {
  id: 'draft-1',
  userId: 'user-123',
  title: 'My Video',
  description: 'Great video',
  tags: ['tag1', 'tag2'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('POST /api/drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Authentication', () => {
    it('returns 401 when no session cookie is present', async () => {
      const req = makeRequest('POST', { title: 'Test' });
      const res = await POST(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it('returns 401 when Appwrite rejects the session', async () => {
      mockAccountGet.mockRejectedValueOnce(new Error('Invalid session'));
      const req = makeRequest('POST', { title: 'Test' }, { [SESSION_COOKIE]: 'bad-token' });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });
  });

  describe('Input validation', () => {
    beforeEach(() => {
      mockAccountGet.mockResolvedValue({ $id: 'user-123' });
    });

    it('returns 400 when title is missing', async () => {
      const req = makeRequest('POST', { description: 'No title' }, { [SESSION_COOKIE]: 'tok' });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/title/i);
    });

    it('returns 400 when title is an empty string', async () => {
      const req = makeRequest('POST', { title: '   ' }, { [SESSION_COOKIE]: 'tok' });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/title/i);
    });

    it('returns 400 when tags is not an array', async () => {
      const req = makeRequest(
        'POST',
        { title: 'Valid', tags: 'not-an-array' },
        { [SESSION_COOKIE]: 'tok' }
      );
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/tags/i);
    });

    it('returns 400 when tags contains non-string items', async () => {
      const req = makeRequest(
        'POST',
        { title: 'Valid', tags: [1, 2] },
        { [SESSION_COOKIE]: 'tok' }
      );
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when description is not a string', async () => {
      const req = makeRequest(
        'POST',
        { title: 'Valid', description: 42 },
        { [SESSION_COOKIE]: 'tok' }
      );
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/description/i);
    });

    it('accepts an empty string for description', async () => {
      vi.mocked(createDraft).mockResolvedValueOnce({ ...baseDraft, description: '' });
      const req = makeRequest(
        'POST',
        { title: 'Valid', description: '' },
        { [SESSION_COOKIE]: 'tok' }
      );
      const res = await POST(req);
      expect(res.status).toBe(201);
      expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ description: '' }));
    });

    it('returns 400 when body is not valid JSON', async () => {
      const url = new URL('http://localhost:3000/api/drafts');
      const req = new NextRequest(url, {
        method: 'POST',
        body: 'not-json',
        headers: { Cookie: `${SESSION_COOKIE}=tok`, 'Content-Type': 'application/json' },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when body is JSON null', async () => {
      const url = new URL('http://localhost:3000/api/drafts');
      const req = new NextRequest(url, {
        method: 'POST',
        body: 'null',
        headers: { Cookie: `${SESSION_COOKIE}=tok`, 'Content-Type': 'application/json' },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when body is a JSON array', async () => {
      const url = new URL('http://localhost:3000/api/drafts');
      const req = new NextRequest(url, {
        method: 'POST',
        body: '["title","value"]',
        headers: { Cookie: `${SESSION_COOKIE}=tok`, 'Content-Type': 'application/json' },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe('Successful creation', () => {
    beforeEach(() => {
      mockAccountGet.mockResolvedValue({ $id: 'user-123' });
    });

    it('creates a draft with all fields and returns 201', async () => {
      vi.mocked(createDraft).mockResolvedValueOnce(baseDraft);

      const req = makeRequest(
        'POST',
        { title: 'My Video', description: 'Great video', tags: ['tag1', 'tag2'] },
        { [SESSION_COOKIE]: 'valid-token' }
      );
      const res = await POST(req);

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data).toEqual(baseDraft);
      expect(body.message).toBe('Draft created');
      expect(createDraft).toHaveBeenCalledWith({
        userId: 'user-123',
        title: 'My Video',
        description: 'Great video',
        tags: ['tag1', 'tag2'],
      });
    });

    it('creates a draft with only title (optional fields default correctly)', async () => {
      const minimalDraft = { ...baseDraft, description: '', tags: [] };
      vi.mocked(createDraft).mockResolvedValueOnce(minimalDraft);

      const req = makeRequest('POST', { title: 'Title Only' }, { [SESSION_COOKIE]: 'tok' });
      const res = await POST(req);

      expect(res.status).toBe(201);
      expect(createDraft).toHaveBeenCalledWith(
        expect.objectContaining({ description: '', tags: [] })
      );
    });

    it('trims whitespace from title', async () => {
      vi.mocked(createDraft).mockResolvedValueOnce(baseDraft);

      const req = makeRequest('POST', { title: '  Padded  ' }, { [SESSION_COOKIE]: 'tok' });
      await POST(req);

      expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ title: 'Padded' }));
    });

    it('sets userId from the authenticated session', async () => {
      vi.mocked(createDraft).mockResolvedValueOnce(baseDraft);

      const req = makeRequest('POST', { title: 'Test' }, { [SESSION_COOKIE]: 'tok' });
      await POST(req);

      expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-123' }));
    });
  });

  describe('Repository errors', () => {
    beforeEach(() => {
      mockAccountGet.mockResolvedValue({ $id: 'user-123' });
    });

    it('returns 500 when createDraft throws', async () => {
      vi.mocked(createDraft).mockRejectedValueOnce(new Error('DB error'));

      const req = makeRequest('POST', { title: 'Test' }, { [SESSION_COOKIE]: 'tok' });
      const res = await POST(req);

      expect(res.status).toBe(500);
    });
  });
});

// ---------------------------------------------------------------------------

describe('GET /api/drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Authentication', () => {
    it('returns 401 when no session cookie is present', async () => {
      const req = makeRequest('GET');
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it('returns 401 when Appwrite rejects the session', async () => {
      mockAccountGet.mockRejectedValueOnce(new Error('Bad session'));
      const req = makeRequest('GET', undefined, { [SESSION_COOKIE]: 'bad' });
      const res = await GET(req);
      expect(res.status).toBe(401);
    });
  });

  describe('Successful listing', () => {
    beforeEach(() => {
      mockAccountGet.mockResolvedValue({ $id: 'user-123' });
    });

    it('returns 200 with the user drafts list', async () => {
      vi.mocked(listDraftsByUser).mockResolvedValueOnce([baseDraft]);

      const req = makeRequest('GET', undefined, { [SESSION_COOKIE]: 'tok' });
      const res = await GET(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([baseDraft]);
      expect(listDraftsByUser).toHaveBeenCalledWith('user-123');
    });

    it('returns an empty array when user has no drafts', async () => {
      vi.mocked(listDraftsByUser).mockResolvedValueOnce([]);

      const req = makeRequest('GET', undefined, { [SESSION_COOKIE]: 'tok' });
      const res = await GET(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
    });

    it('does not return drafts belonging to other users', async () => {
      // listDraftsByUser is called with the session userId — the repo filters by userId.
      // We verify only the correct userId is passed to the repository.
      vi.mocked(listDraftsByUser).mockResolvedValueOnce([baseDraft]);

      const req = makeRequest('GET', undefined, { [SESSION_COOKIE]: 'tok' });
      await GET(req);

      expect(listDraftsByUser).toHaveBeenCalledWith('user-123');
      expect(listDraftsByUser).not.toHaveBeenCalledWith('other-user');
    });
  });

  describe('Repository errors', () => {
    beforeEach(() => {
      mockAccountGet.mockResolvedValue({ $id: 'user-123' });
    });

    it('returns 500 when listDraftsByUser throws', async () => {
      vi.mocked(listDraftsByUser).mockRejectedValueOnce(new Error('DB error'));

      const req = makeRequest('GET', undefined, { [SESSION_COOKIE]: 'tok' });
      const res = await GET(req);

      expect(res.status).toBe(500);
    });
  });
});
