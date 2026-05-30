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

vi.mock('@/lib/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/r2')>();
  return {
    ...actual,
    deleteObject: vi.fn(),
    getObjectUrl: vi.fn(),
  };
});

import { GET, PATCH, DELETE } from '@/app/api/drafts/[id]/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getDraftById, updateDraft, deleteDraft } from '@/lib/repositories/drafts';
import { deleteObject, buildDraftThumbnailFinalKey } from '@/lib/r2';
import { DraftDocumentTooLargeError, MAX_DRAFT_TITLE_LENGTH } from '@/lib/draft-upload-metadata';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_COOKIE = 'videosphere_session';
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
  targets: ['youtube', 'vimeo'] as const,
  title: 'My Video',
  description: 'Great video',
  tags: [] as string[],
  visibility: 'private' as const,
  platforms: {} as const,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// GET /api/drafts/[id]
// ---------------------------------------------------------------------------

describe('GET /api/drafts/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Authentication', () => {
    it('returns 401 when no session cookie is present', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);
      const res = await GET(makeRequest('GET'), makeParams());
      expect(res.status).toBe(401);
    });

    it('returns 401 when session is invalid', async () => {
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
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Authentication', () => {
    it('returns 401 when no session cookie is present', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);
      const res = await PATCH(makeRequest('PATCH', { title: 'New' }), makeParams());
      expect(res.status).toBe(401);
    });

    it('returns 401 when session is invalid', async () => {
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

    it(`returns 400 when title exceeds ${MAX_DRAFT_TITLE_LENGTH} characters`, async () => {
      const res = await PATCH(
        makeRequest(
          'PATCH',
          { title: 'y'.repeat(MAX_DRAFT_TITLE_LENGTH + 1) },
          { [SESSION_COOKIE]: 'tok' }
        ),
        makeParams()
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toMatch(/100|YouTube/i);
    });

    it('returns 400 when platforms is not an object', async () => {
      const res = await PATCH(
        makeRequest('PATCH', { platforms: 'bad' }, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toMatch(/platforms/i);
    });

    it('returns 400 when targets is empty', async () => {
      const res = await PATCH(
        makeRequest('PATCH', { targets: [] }, { [SESSION_COOKIE]: 'tok' }),
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

    it('passes platforms as platformsPatch for partial platform merge', async () => {
      const updated = {
        ...baseDraft,
        platforms: { youtube: { categoryId: '10' } },
      };
      vi.mocked(updateDraft).mockResolvedValueOnce(updated);

      const res = await PATCH(
        makeRequest(
          'PATCH',
          { platforms: { youtube: { categoryId: '10' } } },
          { [SESSION_COOKIE]: 'tok' }
        ),
        makeParams()
      );

      expect(res.status).toBe(200);
      expect(updateDraft).toHaveBeenCalledWith(DRAFT_ID, {
        platformsPatch: { youtube: { categoryId: '10' } },
      });
    });

    it('accepts platforms: null like POST (normalized to empty object)', async () => {
      vi.mocked(updateDraft).mockResolvedValueOnce(baseDraft);

      const res = await PATCH(
        makeRequest('PATCH', { platforms: null }, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );

      expect(res.status).toBe(200);
      expect(updateDraft).toHaveBeenCalledWith(DRAFT_ID, { platformsPatch: {} });
    });

    it('passes raw platforms patch so empty string can clear vimeo categoryUri', async () => {
      vi.mocked(updateDraft).mockResolvedValueOnce(baseDraft);

      const res = await PATCH(
        makeRequest(
          'PATCH',
          { platforms: { vimeo: { categoryUri: '' } } },
          { [SESSION_COOKIE]: 'tok' }
        ),
        makeParams()
      );

      expect(res.status).toBe(200);
      expect(updateDraft).toHaveBeenCalledWith(DRAFT_ID, {
        platformsPatch: { vimeo: { categoryUri: '' } },
      });
    });

    it('passes tags array to updateDraft', async () => {
      const updated = { ...baseDraft, tags: ['a', 'b'] };
      vi.mocked(updateDraft).mockResolvedValueOnce(updated);

      const res = await PATCH(
        makeRequest('PATCH', { tags: ['a', 'b'] }, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );

      expect(res.status).toBe(200);
      expect(updateDraft).toHaveBeenCalledWith(DRAFT_ID, { tags: ['a', 'b'] });
    });

    it('updates multiple fields at once', async () => {
      const updated = {
        ...baseDraft,
        title: 'New',
        description: 'Desc',
        targets: ['youtube'] as const,
      };
      vi.mocked(updateDraft).mockResolvedValueOnce(updated);

      const res = await PATCH(
        makeRequest(
          'PATCH',
          { title: 'New', description: 'Desc', targets: ['youtube'] },
          { [SESSION_COOKIE]: 'tok' }
        ),
        makeParams()
      );

      expect(res.status).toBe(200);
      expect(updateDraft).toHaveBeenCalledWith(DRAFT_ID, {
        title: 'New',
        description: 'Desc',
        targets: ['youtube'],
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

    it('returns 400 when updateDraft throws DraftDocumentTooLargeError', async () => {
      vi.mocked(updateDraft).mockRejectedValueOnce(
        new DraftDocumentTooLargeError(
          'Draft document JSON is 20000 characters; storage layer allows at most 16383 in the document column.'
        )
      );

      const res = await PATCH(
        makeRequest('PATCH', { description: 'x' }, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );
      const body = (await res.json()) as { message?: string };

      expect(res.status).toBe(400);
      expect(body.message).toContain('16383');
    });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/drafts/[id]
// ---------------------------------------------------------------------------

describe('DELETE /api/drafts/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Authentication', () => {
    it('returns 401 when no session cookie is present', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);
      const res = await DELETE(makeRequest('DELETE'), makeParams());
      expect(res.status).toBe(401);
    });

    it('returns 401 when session is invalid', async () => {
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

    it('retains R2 thumbnail when deleteDraft throws (thumbnail not deleted)', async () => {
      const thumbKey = buildDraftThumbnailFinalKey('user-123', DRAFT_ID, 'u1', 'jpg');
      vi.mocked(getDraftById).mockResolvedValue({
        ...baseDraft,
        thumbnailR2Key: thumbKey,
        thumbnailContentType: 'image/jpeg',
      });
      vi.mocked(deleteDraft).mockRejectedValueOnce(new Error('DB error'));

      const res = await DELETE(
        makeRequest('DELETE', undefined, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );

      expect(res.status).toBe(500);
      expect(deleteObject).not.toHaveBeenCalled();
    });
  });

  describe('Thumbnail cleanup ordering', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
      vi.mocked(deleteDraft).mockResolvedValue(undefined);
      vi.mocked(deleteObject).mockResolvedValue(undefined);
    });

    it('deletes draft from DB before cleaning up R2 thumbnail', async () => {
      const thumbKey = buildDraftThumbnailFinalKey('user-123', DRAFT_ID, 'u1', 'jpg');
      vi.mocked(getDraftById).mockResolvedValue({
        ...baseDraft,
        thumbnailR2Key: thumbKey,
        thumbnailContentType: 'image/jpeg',
      });

      const res = await DELETE(
        makeRequest('DELETE', undefined, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );

      expect(res.status).toBe(200);
      expect(deleteDraft).toHaveBeenCalledWith(DRAFT_ID);
      expect(deleteObject).toHaveBeenCalledWith(thumbKey);

      // DB delete must precede R2 cleanup so a persistence failure leaves the
      // thumbnail intact (draft still exists) rather than breaking a live draft.
      const dbOrder = vi.mocked(deleteDraft).mock.invocationCallOrder[0];
      const r2Order = vi.mocked(deleteObject).mock.invocationCallOrder[0];
      expect(dbOrder).toBeLessThan(r2Order);
    });
  });
});
