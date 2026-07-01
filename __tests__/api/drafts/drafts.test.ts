/**
 * Tests for POST /api/drafts and GET /api/drafts
 *
 * Covers authentication, input validation, and successful responses.
 * Mocks the auth helper and drafts repository to isolate route logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { normalizeBackupFileNameSettings } from '@/lib/backup-filename';

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
  createDraft: vi.fn(),
  listDraftsByUser: vi.fn(),
  markDraftUsedInUpload: vi.fn(async () => null),
}));

// ---------------------------------------------------------------------------
// Mock upload-jobs repository (GET /api/drafts backfill)
// ---------------------------------------------------------------------------

vi.mock('@/lib/repositories/upload-jobs', () => ({
  listUploadJobsByUserForDraftIds: vi.fn(async () => []),
}));

vi.mock('@/lib/repositories/users', () => ({
  upsertDraftLabelsInLibrary: vi.fn(),
}));

import { POST, GET } from '@/app/api/drafts/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { createDraft, listDraftsByUser, markDraftUsedInUpload } from '@/lib/repositories/drafts';
import { listUploadJobsByUserForDraftIds } from '@/lib/repositories/upload-jobs';
import { upsertDraftLabelsInLibrary } from '@/lib/repositories/users';
import { DraftDocumentTooLargeError, MAX_DRAFT_TITLE_LENGTH } from '@/lib/draft-upload-metadata';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_COOKIE = 'videosphere_session';

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
// Test suite
// ---------------------------------------------------------------------------

describe('POST /api/drafts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Authentication', () => {
    it('returns 401 when no session cookie is present', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);
      const req = makeRequest('POST', { title: 'Test', targets: ['youtube'] });
      const res = await POST(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toMatch(/unauthorized/i);
    });

    it('returns 401 when session is invalid', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);
      const req = makeRequest('POST', { title: 'Test' }, { [SESSION_COOKIE]: 'bad-token' });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });
  });

  describe('Input validation', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    });

    it('returns 400 when targets is missing', async () => {
      const req = makeRequest('POST', { title: 'T' }, { [SESSION_COOKIE]: 'tok' });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toMatch(/targets/i);
    });

    it('returns 400 when targets is empty', async () => {
      const req = makeRequest('POST', { title: 'T', targets: [] }, { [SESSION_COOKIE]: 'tok' });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('allows creating a draft when the title field is omitted', async () => {
      vi.mocked(createDraft).mockResolvedValueOnce({ ...baseDraft, title: '' });

      const req = makeRequest(
        'POST',
        { description: 'No title', targets: ['youtube'] },
        { [SESSION_COOKIE]: 'tok' }
      );
      const res = await POST(req);
      expect(res.status).toBe(201);
      expect(createDraft).toHaveBeenCalledWith(
        expect.objectContaining({ title: '', targets: ['youtube'] })
      );
    });

    it('allows an empty shared title when platform overrides are present', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce('user-123');
      vi.mocked(createDraft).mockResolvedValueOnce({
        ...baseDraft,
        title: 'YouTube Title',
        platforms: { youtube: { titleOverride: 'YouTube Title' } },
      });

      const req = makeRequest(
        'POST',
        {
          title: '',
          targets: ['youtube', 'vimeo'],
          platforms: {
            youtube: { titleOverride: 'YouTube Title' },
            vimeo: { titleOverride: 'Vimeo Title' },
          },
        },
        { [SESSION_COOKIE]: 'tok' }
      );
      const res = await POST(req);
      expect(res.status).toBe(201);
      expect(createDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '',
          platforms: {
            youtube: { titleOverride: 'YouTube Title' },
            vimeo: { titleOverride: 'Vimeo Title' },
          },
        })
      );
    });

    it('allows creating a draft with an empty title when no overrides are present', async () => {
      vi.mocked(createDraft).mockResolvedValueOnce({ ...baseDraft, title: '' });

      const req = makeRequest(
        'POST',
        { title: '   ', targets: ['youtube'] },
        { [SESSION_COOKIE]: 'tok' }
      );
      const res = await POST(req);
      expect(res.status).toBe(201);
      expect(createDraft).toHaveBeenCalledWith(
        expect.objectContaining({ title: '', targets: ['youtube'] })
      );
    });

    it(`returns 400 when title is longer than ${MAX_DRAFT_TITLE_LENGTH} characters (after trim)`, async () => {
      const req = makeRequest(
        'POST',
        { title: 'x'.repeat(MAX_DRAFT_TITLE_LENGTH + 1), targets: ['youtube'] },
        { [SESSION_COOKIE]: 'tok' }
      );
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toMatch(/100|YouTube/i);
    });

    it('returns 400 when platforms is not an object', async () => {
      const req = makeRequest(
        'POST',
        { title: 'Valid', targets: ['youtube'], platforms: 'bad' },
        { [SESSION_COOKIE]: 'tok' }
      );
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toMatch(/platforms/i);
    });

    it('returns 400 when description is not a string', async () => {
      const req = makeRequest(
        'POST',
        { title: 'Valid', targets: ['youtube'], description: 42 },
        { [SESSION_COOKIE]: 'tok' }
      );
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toMatch(/description/i);
    });

    it('accepts an empty string for description', async () => {
      vi.mocked(createDraft).mockResolvedValueOnce({ ...baseDraft, description: '' });
      const req = makeRequest(
        'POST',
        { title: 'Valid', targets: ['youtube'], description: '' },
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
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    });

    it('creates a draft with all fields and returns 201', async () => {
      vi.mocked(createDraft).mockResolvedValueOnce(baseDraft);

      const req = makeRequest(
        'POST',
        {
          title: 'My Video',
          description: 'Great video',
          targets: ['youtube', 'vimeo'],
        },
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
        tags: [],
        labels: [],
        targets: ['youtube', 'vimeo'],
        platforms: {},
        backupNaming: normalizeBackupFileNameSettings(undefined),
      });
    });

    it('creates a draft with only title and targets (optional fields default correctly)', async () => {
      const minimalDraft = { ...baseDraft, description: '', targets: ['youtube'] as const };
      vi.mocked(createDraft).mockResolvedValueOnce(minimalDraft);

      const req = makeRequest(
        'POST',
        { title: 'Title Only', targets: ['youtube'] },
        { [SESSION_COOKIE]: 'tok' }
      );
      const res = await POST(req);

      expect(res.status).toBe(201);
      expect(createDraft).toHaveBeenCalledWith(
        expect.objectContaining({ description: '', platforms: {} })
      );
    });

    it('trims whitespace from title', async () => {
      vi.mocked(createDraft).mockResolvedValueOnce(baseDraft);

      const req = makeRequest(
        'POST',
        { title: '  Padded  ', targets: ['youtube'] },
        { [SESSION_COOKIE]: 'tok' }
      );
      await POST(req);

      expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ title: 'Padded' }));
    });

    it('sets userId from the authenticated session', async () => {
      vi.mocked(createDraft).mockResolvedValueOnce(baseDraft);

      const req = makeRequest(
        'POST',
        { title: 'Test', targets: ['youtube'] },
        { [SESSION_COOKIE]: 'tok' }
      );
      await POST(req);

      expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-123' }));
    });

    it('returns 201 when label library upsert fails after the draft is created', async () => {
      vi.mocked(createDraft).mockResolvedValueOnce({ ...baseDraft, labels: ['Sunday'] });
      vi.mocked(upsertDraftLabelsInLibrary).mockRejectedValueOnce(new Error('db down'));

      const req = makeRequest(
        'POST',
        { title: 'My Video', targets: ['youtube'], labels: ['Sunday'] },
        { [SESSION_COOKIE]: 'tok' }
      );
      const res = await POST(req);

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.message).toBe('Draft created');
      expect(body.data.labels).toEqual(['Sunday']);
      expect(upsertDraftLabelsInLibrary).toHaveBeenCalledWith('user-123', ['Sunday']);
    });
  });

  describe('Repository errors', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    });

    it('returns 500 when createDraft throws', async () => {
      vi.mocked(createDraft).mockRejectedValueOnce(new Error('DB error'));

      const req = makeRequest(
        'POST',
        { title: 'Test', targets: ['youtube'] },
        { [SESSION_COOKIE]: 'tok' }
      );
      const res = await POST(req);

      expect(res.status).toBe(500);
    });

    it('returns 400 when createDraft throws DraftDocumentTooLargeError', async () => {
      vi.mocked(createDraft).mockRejectedValueOnce(
        new DraftDocumentTooLargeError(
          'Draft document JSON is 20000 characters; storage layer allows at most 16383 in the document column.'
        )
      );

      const req = makeRequest(
        'POST',
        { title: 'Test', targets: ['youtube'] },
        { [SESSION_COOKIE]: 'tok' }
      );
      const res = await POST(req);
      const body = (await res.json()) as { message?: string };

      expect(res.status).toBe(400);
      expect(body.message).toContain('16383');
    });
  });
});

// ---------------------------------------------------------------------------

describe('GET /api/drafts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Authentication', () => {
    it('returns 401 when no session cookie is present', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);
      const req = makeRequest('GET');
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it('returns 401 when session is invalid', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);
      const req = makeRequest('GET', undefined, { [SESSION_COOKIE]: 'bad' });
      const res = await GET(req);
      expect(res.status).toBe(401);
    });
  });

  describe('Successful listing', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
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

  describe('usedInUploadAt backfill (upload_jobs scan)', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    });

    it('calls listUploadJobsByUserForDraftIds only for drafts missing usedInUploadAt (including whitespace-only)', async () => {
      vi.mocked(listDraftsByUser).mockResolvedValueOnce([
        {
          ...baseDraft,
          id: 'draft-kept',
          usedInUploadAt: '2025-06-01T00:00:00.000Z',
        },
        { ...baseDraft, id: 'draft-missing-a' },
        {
          ...baseDraft,
          id: 'draft-missing-b',
          usedInUploadAt: '   ',
        },
      ]);
      vi.mocked(listUploadJobsByUserForDraftIds).mockResolvedValueOnce([]);

      const req = makeRequest('GET', undefined, { [SESSION_COOKIE]: 'tok' });
      await GET(req);

      expect(listUploadJobsByUserForDraftIds).toHaveBeenCalledTimes(1);
      expect(listUploadJobsByUserForDraftIds).toHaveBeenCalledWith(
        'user-123',
        ['draft-missing-a', 'draft-missing-b'],
        expect.objectContaining({ maxRows: 5000, signal: expect.any(Object) })
      );
    });

    it('does not call listUploadJobsByUserForDraftIds when every draft has a non-empty usedInUploadAt', async () => {
      vi.mocked(listDraftsByUser).mockResolvedValueOnce([
        {
          ...baseDraft,
          id: 'draft-1',
          usedInUploadAt: '2025-01-01T00:00:00.000Z',
        },
        {
          ...baseDraft,
          id: 'draft-2',
          usedInUploadAt: '2025-02-01T00:00:00.000Z',
        },
      ]);

      const req = makeRequest('GET', undefined, { [SESSION_COOKIE]: 'tok' });
      await GET(req);

      expect(listUploadJobsByUserForDraftIds).not.toHaveBeenCalled();
    });

    it('uses a bounded backfill scan instead of Infinity', async () => {
      vi.mocked(listDraftsByUser).mockResolvedValueOnce([{ ...baseDraft, id: 'draft-missing-a' }]);
      vi.mocked(listUploadJobsByUserForDraftIds).mockResolvedValueOnce([]);

      const req = makeRequest('GET', undefined, { [SESSION_COOKIE]: 'tok' });
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(listUploadJobsByUserForDraftIds).toHaveBeenCalledWith(
        'user-123',
        ['draft-missing-a'],
        expect.objectContaining({ maxRows: 5000, signal: expect.any(Object) })
      );
    });

    it('merges the first upload job $createdAt per draft into usedInUploadAt when missing', async () => {
      vi.mocked(listDraftsByUser).mockResolvedValueOnce([
        {
          ...baseDraft,
          id: 'draft-1',
          usedInUploadAt: '2025-01-01T00:00:00.000Z',
        },
        { ...baseDraft, id: 'draft-needs-backfill' },
      ]);
      vi.mocked(listUploadJobsByUserForDraftIds).mockResolvedValueOnce([
        {
          id: 'job-older',
          userId: 'user-123',
          draftId: 'draft-needs-backfill',
          r2Key: 'k',
          status: 'completed' as const,
          errorMessage: null,
          $createdAt: '2026-01-05T00:00:00.000Z',
          $updatedAt: '2026-01-05T00:00:00.000Z',
        },
        {
          id: 'job-newer',
          userId: 'user-123',
          draftId: 'draft-needs-backfill',
          r2Key: 'k',
          status: 'completed' as const,
          errorMessage: null,
          $createdAt: '2026-01-20T00:00:00.000Z',
          $updatedAt: '2026-01-20T00:00:00.000Z',
        },
      ]);

      const req = makeRequest('GET', undefined, { [SESSION_COOKIE]: 'tok' });
      const res = await GET(req);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Array<{ id: string; usedInUploadAt?: string }> };
      const backfilled = body.data.find((d) => d.id === 'draft-needs-backfill');
      const preserved = body.data.find((d) => d.id === 'draft-1');

      expect(preserved?.usedInUploadAt).toBe('2025-01-01T00:00:00.000Z');
      expect(backfilled?.usedInUploadAt).toBe('2026-01-05T00:00:00.000Z');
    });

    it('best-effort persists backfilled usedInUploadAt for missing drafts', async () => {
      vi.mocked(listDraftsByUser).mockResolvedValueOnce([
        { ...baseDraft, id: 'draft-missing-a' },
        { ...baseDraft, id: 'draft-missing-b', usedInUploadAt: '   ' },
        { ...baseDraft, id: 'draft-kept', usedInUploadAt: '2025-01-01T00:00:00.000Z' },
      ]);
      vi.mocked(listUploadJobsByUserForDraftIds).mockResolvedValueOnce([
        {
          id: 'job-a',
          userId: 'user-123',
          draftId: 'draft-missing-a',
          r2Key: 'k',
          status: 'completed' as const,
          errorMessage: null,
          $createdAt: '2026-01-05T00:00:00.000Z',
          $updatedAt: '2026-01-05T00:00:00.000Z',
        },
        {
          id: 'job-b',
          userId: 'user-123',
          draftId: 'draft-missing-b',
          r2Key: 'k',
          status: 'completed' as const,
          errorMessage: null,
          $createdAt: '2026-01-07T00:00:00.000Z',
          $updatedAt: '2026-01-07T00:00:00.000Z',
        },
      ]);

      const req = makeRequest('GET', undefined, { [SESSION_COOKIE]: 'tok' });
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(markDraftUsedInUpload).toHaveBeenCalledTimes(2);
      expect(markDraftUsedInUpload).toHaveBeenCalledWith(
        'draft-missing-a',
        '2026-01-05T00:00:00.000Z'
      );
      expect(markDraftUsedInUpload).toHaveBeenCalledWith(
        'draft-missing-b',
        '2026-01-07T00:00:00.000Z'
      );
      expect(markDraftUsedInUpload).not.toHaveBeenCalledWith('draft-kept', expect.any(String));
    });

    it('still returns 200 when persisting backfilled usedInUploadAt fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(listDraftsByUser).mockResolvedValueOnce([{ ...baseDraft, id: 'draft-missing-a' }]);
      vi.mocked(listUploadJobsByUserForDraftIds).mockResolvedValueOnce([
        {
          id: 'job-a',
          userId: 'user-123',
          draftId: 'draft-missing-a',
          r2Key: 'k',
          status: 'completed' as const,
          errorMessage: null,
          $createdAt: '2026-01-05T00:00:00.000Z',
          $updatedAt: '2026-01-05T00:00:00.000Z',
        },
      ]);
      vi.mocked(markDraftUsedInUpload).mockRejectedValueOnce(new Error('write failed'));

      const req = makeRequest('GET', undefined, { [SESSION_COOKIE]: 'tok' });
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(markDraftUsedInUpload).toHaveBeenCalledWith(
        'draft-missing-a',
        '2026-01-05T00:00:00.000Z'
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to persist usedInUploadAt backfill'),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('Repository errors', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    });

    it('returns 500 when listDraftsByUser throws', async () => {
      vi.mocked(listDraftsByUser).mockRejectedValueOnce(new Error('DB error'));

      const req = makeRequest('GET', undefined, { [SESSION_COOKIE]: 'tok' });
      const res = await GET(req);

      expect(res.status).toBe(500);
    });
  });
});
