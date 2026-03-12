/**
 * Tests for GET /api/drafts/[id], PATCH /api/drafts/[id], DELETE /api/drafts/[id]
 *
 * Covers authentication, ownership enforcement, input validation, and successful responses.
 * Mocks the auth helper and drafts repository to isolate route logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mock shared auth helper
// ---------------------------------------------------------------------------

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock drafts repository
// ---------------------------------------------------------------------------

vi.mock('@/lib/repositories/drafts', () => ({
  getDraftById: vi.fn(),
  updateDraft: vi.fn(),
  deleteDraft: vi.fn(),
}));

import { GET, PATCH, DELETE } from '@/app/api/drafts/[id]/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getDraftById, updateDraft, deleteDraft } from '@/lib/repositories/drafts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_COOKIE = 'a_session_test-project';
const DRAFT_ID = 'draft-abc';

function makeRequest(
  method: string,
  body?: Record<string, unknown>,
  cookies: Record<string, string> = {}
): NextRequest {
  const url = new URL(`http://localhost:3000/api/drafts/${DRAFT_ID}`);
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

function makeParams(id = DRAFT_ID) {
  return { params: Promise.resolve({ id }) };
}

const baseDraft = {
  id: DRAFT_ID,
  userId: 'user-123',
  title: 'My Video',
  description: 'Great video',
  tags: ['tag1', 'tag2'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// GET /api/drafts/[id]
// ---------------------------------------------------------------------------

describe('GET /api/drafts/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Authentication', () => {
    it('returns 401 when no session cookie is present', async () => {
      const res = await GET(makeRequest('GET'), makeParams());
      expect(res.status).toBe(401);
    });

    it('returns 401 when Appwrite rejects the session', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);
      const res = await GET(
        makeRequest('GET', undefined, { [SESSION_COOKIE]: 'bad' }),
        makeParams()
      );
      expect(res.status).toBe(401);
    });
  });

  describe('Ownership enforcement', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    });

    it('returns 404 when draft does not exist', async () => {
      vi.mocked(getDraftById).mockResolvedValueOnce(null);

      const res = await GET(
        makeRequest('GET', undefined, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );
      expect(res.status).toBe(404);
    });

    it('returns 404 when draft belongs to a different user', async () => {
      vi.mocked(getDraftById).mockResolvedValueOnce({ ...baseDraft, userId: 'other-user' });

      const res = await GET(
        makeRequest('GET', undefined, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );
      expect(res.status).toBe(404);
    });
  });

  describe('Successful fetch', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    });

    it('returns 200 with the draft when owned by the session user', async () => {
      vi.mocked(getDraftById).mockResolvedValueOnce(baseDraft);

      const res = await GET(
        makeRequest('GET', undefined, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual(baseDraft);
      expect(getDraftById).toHaveBeenCalledWith(DRAFT_ID);
    });
  });

  describe('Repository errors', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    });

    it('returns 500 when getDraftById throws', async () => {
      vi.mocked(getDraftById).mockRejectedValueOnce(new Error('DB error'));

      const res = await GET(
        makeRequest('GET', undefined, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );
      expect(res.status).toBe(500);
    });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/drafts/[id]
// ---------------------------------------------------------------------------

describe('PATCH /api/drafts/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Authentication', () => {
    it('returns 401 when no session cookie is present', async () => {
      const res = await PATCH(makeRequest('PATCH', { title: 'New' }), makeParams());
      expect(res.status).toBe(401);
    });

    it('returns 401 when Appwrite rejects the session', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);
      const res = await PATCH(
        makeRequest('PATCH', { title: 'New' }, { [SESSION_COOKIE]: 'bad' }),
        makeParams()
      );
      expect(res.status).toBe(401);
    });
  });

  describe('Ownership enforcement', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    });

    it('returns 404 when draft does not exist', async () => {
      vi.mocked(getDraftById).mockResolvedValueOnce(null);

      const res = await PATCH(
        makeRequest('PATCH', { title: 'New' }, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );
      expect(res.status).toBe(404);
    });

    it('returns 404 when draft belongs to a different user', async () => {
      vi.mocked(getDraftById).mockResolvedValueOnce({ ...baseDraft, userId: 'other-user' });

      const res = await PATCH(
        makeRequest('PATCH', { title: 'New' }, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );
      expect(res.status).toBe(404);
    });
  });

  describe('Input validation', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
      vi.mocked(getDraftById).mockResolvedValue(baseDraft);
    });

    it('returns 400 when no fields are provided', async () => {
      const res = await PATCH(makeRequest('PATCH', {}, { [SESSION_COOKIE]: 'tok' }), makeParams());
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toMatch(/at least one field/i);
    });

    it('returns 400 when title is an empty string', async () => {
      const res = await PATCH(
        makeRequest('PATCH', { title: '' }, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toMatch(/title/i);
    });

    it('returns 400 when tags is not an array', async () => {
      const res = await PATCH(
        makeRequest('PATCH', { tags: 'bad' }, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toMatch(/tags/i);
    });

    it('returns 400 when tags contains non-string items', async () => {
      const res = await PATCH(
        makeRequest('PATCH', { tags: [1, 2] }, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when description is not a string', async () => {
      const res = await PATCH(
        makeRequest('PATCH', { description: 99 }, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toMatch(/description/i);
    });

    it('accepts an empty string to clear description', async () => {
      const updated = { ...baseDraft, description: '' };
      vi.mocked(updateDraft).mockResolvedValueOnce(updated);
      const res = await PATCH(
        makeRequest('PATCH', { description: '' }, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );
      expect(res.status).toBe(200);
      expect(updateDraft).toHaveBeenCalledWith(DRAFT_ID, { description: '' });
    });

    it('returns 400 when body is not valid JSON', async () => {
      const url = new URL(`http://localhost:3000/api/drafts/${DRAFT_ID}`);
      const req = new NextRequest(url, {
        method: 'PATCH',
        body: 'not-json',
        headers: { Cookie: `${SESSION_COOKIE}=tok`, 'Content-Type': 'application/json' },
      });
      const res = await PATCH(req, makeParams());
      expect(res.status).toBe(400);
    });

    it('returns 400 when body is JSON null', async () => {
      const url = new URL(`http://localhost:3000/api/drafts/${DRAFT_ID}`);
      const req = new NextRequest(url, {
        method: 'PATCH',
        body: 'null',
        headers: { Cookie: `${SESSION_COOKIE}=tok`, 'Content-Type': 'application/json' },
      });
      const res = await PATCH(req, makeParams());
      expect(res.status).toBe(400);
    });

    it('returns 400 when body is a JSON array', async () => {
      const url = new URL(`http://localhost:3000/api/drafts/${DRAFT_ID}`);
      const req = new NextRequest(url, {
        method: 'PATCH',
        body: '["title","value"]',
        headers: { Cookie: `${SESSION_COOKIE}=tok`, 'Content-Type': 'application/json' },
      });
      const res = await PATCH(req, makeParams());
      expect(res.status).toBe(400);
    });
  });

  describe('Successful partial update', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
      vi.mocked(getDraftById).mockResolvedValue(baseDraft);
    });

    it('updates only the title when only title is supplied', async () => {
      const updated = { ...baseDraft, title: 'New Title' };
      vi.mocked(updateDraft).mockResolvedValueOnce(updated);

      const res = await PATCH(
        makeRequest('PATCH', { title: 'New Title' }, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual(updated);
      expect(updateDraft).toHaveBeenCalledWith(DRAFT_ID, { title: 'New Title' });
    });

    it('trims whitespace from title', async () => {
      vi.mocked(updateDraft).mockResolvedValueOnce(baseDraft);

      await PATCH(
        makeRequest('PATCH', { title: '  Trimmed  ' }, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );

      expect(updateDraft).toHaveBeenCalledWith(DRAFT_ID, { title: 'Trimmed' });
    });

    it('updates only tags when only tags are supplied', async () => {
      const updated = { ...baseDraft, tags: ['new'] };
      vi.mocked(updateDraft).mockResolvedValueOnce(updated);

      const res = await PATCH(
        makeRequest('PATCH', { tags: ['new'] }, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );

      expect(res.status).toBe(200);
      expect(updateDraft).toHaveBeenCalledWith(DRAFT_ID, { tags: ['new'] });
    });

    it('updates multiple fields at once', async () => {
      const updated = { ...baseDraft, title: 'New', description: 'Desc', tags: [] };
      vi.mocked(updateDraft).mockResolvedValueOnce(updated);

      const res = await PATCH(
        makeRequest(
          'PATCH',
          { title: 'New', description: 'Desc', tags: [] },
          { [SESSION_COOKIE]: 'tok' }
        ),
        makeParams()
      );

      expect(res.status).toBe(200);
      expect(updateDraft).toHaveBeenCalledWith(DRAFT_ID, {
        title: 'New',
        description: 'Desc',
        tags: [],
      });
    });

    it('does not pass unrecognised fields to updateDraft', async () => {
      vi.mocked(updateDraft).mockResolvedValueOnce(baseDraft);

      await PATCH(
        makeRequest('PATCH', { title: 'Good', userId: 'hacker' }, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );

      const call = vi.mocked(updateDraft).mock.calls[0][1];
      expect(call).not.toHaveProperty('userId');
    });
  });

  describe('Repository errors', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
      vi.mocked(getDraftById).mockResolvedValue(baseDraft);
    });

    it('returns 500 when updateDraft throws', async () => {
      vi.mocked(updateDraft).mockRejectedValueOnce(new Error('DB error'));

      const res = await PATCH(
        makeRequest('PATCH', { title: 'Test' }, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );
      expect(res.status).toBe(500);
    });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/drafts/[id]
// ---------------------------------------------------------------------------

describe('DELETE /api/drafts/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Authentication', () => {
    it('returns 401 when no session cookie is present', async () => {
      const res = await DELETE(makeRequest('DELETE'), makeParams());
      expect(res.status).toBe(401);
    });

    it('returns 401 when Appwrite rejects the session', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);
      const res = await DELETE(
        makeRequest('DELETE', undefined, { [SESSION_COOKIE]: 'bad' }),
        makeParams()
      );
      expect(res.status).toBe(401);
    });
  });

  describe('Ownership enforcement', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    });

    it('returns 404 when draft does not exist', async () => {
      vi.mocked(getDraftById).mockResolvedValueOnce(null);

      const res = await DELETE(
        makeRequest('DELETE', undefined, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );
      expect(res.status).toBe(404);
    });

    it('returns 404 when draft belongs to a different user', async () => {
      vi.mocked(getDraftById).mockResolvedValueOnce({ ...baseDraft, userId: 'other-user' });

      const res = await DELETE(
        makeRequest('DELETE', undefined, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );
      expect(res.status).toBe(404);
      expect(deleteDraft).not.toHaveBeenCalled();
    });
  });

  describe('Successful deletion', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
      vi.mocked(getDraftById).mockResolvedValue(baseDraft);
    });

    it('returns 200 with confirmation message', async () => {
      vi.mocked(deleteDraft).mockResolvedValueOnce(undefined);

      const res = await DELETE(
        makeRequest('DELETE', undefined, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toBe('Draft deleted');
      expect(deleteDraft).toHaveBeenCalledWith(DRAFT_ID);
    });

    it('calls deleteDraft with the correct id', async () => {
      vi.mocked(deleteDraft).mockResolvedValueOnce(undefined);

      await DELETE(
        makeRequest('DELETE', undefined, { [SESSION_COOKIE]: 'tok' }),
        makeParams('some-other-id')
      );

      expect(deleteDraft).toHaveBeenCalledWith('some-other-id');
    });
  });

  describe('Repository errors', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
      vi.mocked(getDraftById).mockResolvedValue(baseDraft);
    });

    it('returns 500 when deleteDraft throws', async () => {
      vi.mocked(deleteDraft).mockRejectedValueOnce(new Error('DB error'));

      const res = await DELETE(
        makeRequest('DELETE', undefined, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );
      expect(res.status).toBe(500);
    });
  });
});
