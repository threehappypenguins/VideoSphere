/**
 * Tests for DELETE /api/drafts/[id]/thumbnail
 *
 * Covers auth, ownership, prefix-gated R2 delete, updateDraft outcomes, and errors.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/repositories/drafts', () => ({
  getDraftById: vi.fn(),
  updateDraft: vi.fn(),
}));

vi.mock('@/lib/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/r2')>();
  return {
    ...actual,
    deleteObject: vi.fn(),
  };
});

import { DELETE } from '@/app/api/drafts/[id]/thumbnail/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getDraftById, updateDraft } from '@/lib/repositories/drafts';
import { deleteObject, buildDraftThumbnailFinalKey } from '@/lib/r2';
import { DraftDocumentTooLargeError } from '@/lib/draft-upload-metadata';

const SESSION_COOKIE = 'videosphere_session';
const USER_ID = 'user-123';
const DRAFT_ID = 'draft-abc';

const baseDraft = {
  id: DRAFT_ID,
  userId: USER_ID,
  targets: ['youtube'] as const,
  title: 'My Video',
  description: '',
  tags: [] as string[],
  visibility: 'private' as const,
  platforms: {} as const,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeRequest(cookies: Record<string, string> = {}, platform?: string): NextRequest {
  const url = new URL(`http://localhost:3000/api/drafts/${DRAFT_ID}/thumbnail`);
  if (platform) {
    url.searchParams.set('platform', platform);
  }
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  const headers: Record<string, string> = {};
  if (cookieHeader) headers['Cookie'] = cookieHeader;
  return new NextRequest(url, { method: 'DELETE', headers });
}

function makeParams(id = DRAFT_ID) {
  return { params: Promise.resolve({ id }) };
}

describe('DELETE /api/drafts/[id]/thumbnail', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(deleteObject).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);
    const res = await DELETE(makeRequest({ [SESSION_COOKIE]: 'tok' }), makeParams());
    expect(res.status).toBe(401);
  });

  it('returns 404 when draft does not exist', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce(null);
    const res = await DELETE(makeRequest({ [SESSION_COOKIE]: 'tok' }), makeParams());
    expect(res.status).toBe(404);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('returns 404 when draft belongs to another user', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce({ ...baseDraft, userId: 'other' });
    const res = await DELETE(makeRequest({ [SESSION_COOKIE]: 'tok' }), makeParams());
    expect(res.status).toBe(404);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('clears draft fields and does not call deleteObject when thumbnail key is missing', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce(baseDraft);
    vi.mocked(updateDraft).mockResolvedValueOnce({ ...baseDraft });

    const res = await DELETE(makeRequest({ [SESSION_COOKIE]: 'tok' }), makeParams());

    expect(res.status).toBe(200);
    expect(updateDraft).toHaveBeenCalledWith(DRAFT_ID, {
      thumbnailR2Key: null,
      thumbnailContentType: null,
    });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('clears draft and deletes R2 when thumbnail key matches final prefix for user/draft', async () => {
    const goodKey = buildDraftThumbnailFinalKey(USER_ID, DRAFT_ID, 'u1', 'jpg');
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce({
      ...baseDraft,
      thumbnailR2Key: goodKey,
      thumbnailContentType: 'image/jpeg',
    });
    vi.mocked(updateDraft).mockResolvedValueOnce({
      ...baseDraft,
      thumbnailR2Key: undefined,
      thumbnailContentType: undefined,
    });

    const res = await DELETE(makeRequest({ [SESSION_COOKIE]: 'tok' }), makeParams());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toBe('Thumbnail removed');
    expect(deleteObject).toHaveBeenCalledWith(goodKey);

    // Draft fields must be cleared before the R2 delete so a failed deleteObject
    // leaves an orphaned object rather than a stale key in the draft.
    const updateOrder = vi.mocked(updateDraft).mock.invocationCallOrder[0];
    const deleteOrder = vi.mocked(deleteObject).mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(deleteOrder);
  });

  it('clears draft but skips deleteObject when stored key does not match final prefix', async () => {
    const badKey = 'draft-thumbnails/other-user/draft-abc/x.jpg';
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce({
      ...baseDraft,
      thumbnailR2Key: badKey,
      thumbnailContentType: 'image/jpeg',
    });
    vi.mocked(updateDraft).mockResolvedValueOnce({ ...baseDraft });

    const res = await DELETE(makeRequest({ [SESSION_COOKIE]: 'tok' }), makeParams());

    expect(res.status).toBe(200);
    expect(updateDraft).toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('returns 404 when updateDraft returns null', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce(baseDraft);
    vi.mocked(updateDraft).mockResolvedValueOnce(null);

    const res = await DELETE(makeRequest({ [SESSION_COOKIE]: 'tok' }), makeParams());

    expect(res.status).toBe(404);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('returns 400 when updateDraft throws DraftDocumentTooLargeError', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce(baseDraft);
    vi.mocked(updateDraft).mockRejectedValueOnce(new DraftDocumentTooLargeError('too large'));

    const res = await DELETE(makeRequest({ [SESSION_COOKIE]: 'tok' }), makeParams());

    expect(res.status).toBe(400);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('rethrows when updateDraft throws a generic error', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce(baseDraft);
    vi.mocked(updateDraft).mockRejectedValueOnce(new Error('db error'));

    await expect(DELETE(makeRequest({ [SESSION_COOKIE]: 'tok' }), makeParams())).rejects.toThrow(
      'db error'
    );
  });

  it('returns 200 and logs error when deleteObject rejects (best-effort cleanup)', async () => {
    const errLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const goodKey = buildDraftThumbnailFinalKey(USER_ID, DRAFT_ID, 'u1', 'jpg');
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce({
      ...baseDraft,
      thumbnailR2Key: goodKey,
      thumbnailContentType: 'image/jpeg',
    });
    vi.mocked(updateDraft).mockResolvedValueOnce({ ...baseDraft });
    vi.mocked(deleteObject).mockRejectedValueOnce(new Error('R2 delete failed'));

    const res = await DELETE(makeRequest({ [SESSION_COOKIE]: 'tok' }), makeParams());
    errLog.mockRestore();

    // Draft is already cleared; R2 failure is logged but must not surface as an error.
    expect(res.status).toBe(200);
    expect(updateDraft).toHaveBeenCalledWith(DRAFT_ID, {
      thumbnailR2Key: null,
      thumbnailContentType: null,
    });
    expect(deleteObject).toHaveBeenCalledWith(goodKey);
  });

  it.each(['facebook', 'sermon_audio'] as const)(
    'clears per-platform override and deletes R2 for %s',
    async (platform) => {
      const goodKey = buildDraftThumbnailFinalKey(USER_ID, DRAFT_ID, `${platform}-thumb`, 'jpg');
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
      vi.mocked(getDraftById).mockResolvedValueOnce({
        ...baseDraft,
        platforms: {
          [platform]: {
            thumbnailR2KeyOverride: goodKey,
            thumbnailContentTypeOverride: 'image/jpeg',
          },
        },
      });
      vi.mocked(updateDraft).mockResolvedValueOnce({
        ...baseDraft,
        platforms: {
          [platform]: {
            thumbnailR2KeyOverride: '',
            thumbnailContentTypeOverride: '',
          },
        },
      });

      const res = await DELETE(makeRequest({ [SESSION_COOKIE]: 'tok' }, platform), makeParams());

      expect(res.status).toBe(200);
      expect(updateDraft).toHaveBeenCalledWith(DRAFT_ID, {
        platformsPatch: {
          [platform]: {
            thumbnailR2KeyOverride: '',
            thumbnailContentTypeOverride: '',
          },
        },
      });
      expect(deleteObject).toHaveBeenCalledWith(goodKey);
    }
  );
});
