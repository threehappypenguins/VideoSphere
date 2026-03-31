/**
 * Tests for POST /api/drafts/[id]/thumbnail/complete
 *
 * Covers auth, pendingKey validation, HEAD/R2 errors, size/type checks, copy/update/delete ordering,
 * and preview URL handling.
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
    headObjectMetadata: vi.fn(),
    copyObjectInBucket: vi.fn(),
    deleteObject: vi.fn(),
    getObjectUrl: vi.fn(),
  };
});

import { POST } from '@/app/api/drafts/[id]/thumbnail/complete/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getDraftById, updateDraft } from '@/lib/repositories/drafts';
import {
  headObjectMetadata,
  copyObjectInBucket,
  deleteObject,
  getObjectUrl,
  R2ObjectNotFoundError,
  buildDraftThumbnailPendingKey,
  buildDraftThumbnailFinalKey,
} from '@/lib/r2';

function finalKeyFromCopyMock(): string {
  expect(copyObjectInBucket).toHaveBeenCalled();
  return vi.mocked(copyObjectInBucket).mock.calls[0][1];
}
import { DraftDocumentTooLargeError } from '@/lib/draft-upload-metadata';
import { MAX_DRAFT_THUMBNAIL_BYTES } from '@/lib/draft-thumbnail';

const SESSION_COOKIE = 'a_session_test-project';
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

const pendingKey = buildDraftThumbnailPendingKey(USER_ID, DRAFT_ID, 'pend-1', 'jpg');

function makeRequest(
  body: Record<string, unknown> | null,
  cookies: Record<string, string> = {}
): NextRequest {
  const url = new URL(`http://localhost:3000/api/drafts/${DRAFT_ID}/thumbnail/complete`);
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  const init: RequestInit = { method: 'POST' };
  const headers: Record<string, string> = {};
  if (body !== null) {
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

describe('POST /api/drafts/[id]/thumbnail/complete', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(deleteObject).mockResolvedValue(undefined);
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ pendingKey }), makeParams());
    expect(res.status).toBe(401);
  });

  it('returns 400 when JSON body is invalid', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    const url = new URL(`http://localhost:3000/api/drafts/${DRAFT_ID}/thumbnail/complete`);
    const req = new NextRequest(url, {
      method: 'POST',
      body: 'not-json{',
      headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE}=tok` },
    });
    const res = await POST(req, makeParams());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/invalid json/i);
  });

  it('returns 400 when pendingKey is missing or invalid for this draft', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(USER_ID);
    const resEmpty = await POST(
      makeRequest({ pendingKey: '' }, { [SESSION_COOKIE]: 'tok' }),
      makeParams()
    );
    expect(resEmpty.status).toBe(400);

    const badKey = 'temp/draft-thumbnail-pending/other-user/draft-abc/x.jpg';
    const resBad = await POST(
      makeRequest({ pendingKey: badKey }, { [SESSION_COOKIE]: 'tok' }),
      makeParams()
    );
    expect(resBad.status).toBe(400);
    expect(headObjectMetadata).not.toHaveBeenCalled();
  });

  it('returns 404 when draft does not exist', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ pendingKey }, { [SESSION_COOKIE]: 'tok' }), makeParams());
    expect(res.status).toBe(404);
  });

  it('returns 404 when draft belongs to another user', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce({ ...baseDraft, userId: 'other' });
    const res = await POST(makeRequest({ pendingKey }, { [SESSION_COOKIE]: 'tok' }), makeParams());
    expect(res.status).toBe(404);
  });

  it('returns 400 when HEAD reports object missing (R2ObjectNotFoundError)', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce(baseDraft);
    vi.mocked(headObjectMetadata).mockRejectedValueOnce(new R2ObjectNotFoundError(pendingKey));

    const res = await POST(makeRequest({ pendingKey }, { [SESSION_COOKIE]: 'tok' }), makeParams());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/not found in storage/i);
  });

  it('returns 500 when HEAD fails for non-404 R2 errors', async () => {
    const errLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce(baseDraft);
    vi.mocked(headObjectMetadata).mockRejectedValueOnce(new Error('network down'));

    const res = await POST(makeRequest({ pendingKey }, { [SESSION_COOKIE]: 'tok' }), makeParams());
    errLog.mockRestore();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toMatch(/verify thumbnail in storage/i);
  });

  it('returns 400 and deletes pending when size is out of range', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce(baseDraft);
    vi.mocked(headObjectMetadata).mockResolvedValueOnce({
      contentLength: 0,
      contentType: 'image/jpeg',
    });

    const res = await POST(makeRequest({ pendingKey }, { [SESSION_COOKIE]: 'tok' }), makeParams());
    expect(res.status).toBe(400);
    expect(deleteObject).toHaveBeenCalledWith(pendingKey);
    expect(copyObjectInBucket).not.toHaveBeenCalled();

    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce(baseDraft);
    vi.mocked(headObjectMetadata).mockResolvedValueOnce({
      contentLength: MAX_DRAFT_THUMBNAIL_BYTES + 1,
      contentType: 'image/jpeg',
    });

    const res2 = await POST(makeRequest({ pendingKey }, { [SESSION_COOKIE]: 'tok' }), makeParams());
    expect(res2.status).toBe(400);
  });

  it('returns 500 when copyObjectInBucket fails', async () => {
    const errLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce(baseDraft);
    vi.mocked(headObjectMetadata).mockResolvedValueOnce({
      contentLength: 100,
      contentType: 'image/jpeg',
    });
    vi.mocked(copyObjectInBucket).mockRejectedValueOnce(new Error('copy failed'));

    const res = await POST(makeRequest({ pendingKey }, { [SESSION_COOKIE]: 'tok' }), makeParams());
    errLog.mockRestore();
    expect(res.status).toBe(500);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('returns 404 and deletes final object when updateDraft returns null', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce(baseDraft);
    vi.mocked(headObjectMetadata).mockResolvedValueOnce({
      contentLength: 100,
      contentType: 'image/jpeg',
    });
    vi.mocked(copyObjectInBucket).mockResolvedValueOnce(undefined);
    vi.mocked(deleteObject).mockResolvedValue(undefined);
    vi.mocked(updateDraft).mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ pendingKey }, { [SESSION_COOKIE]: 'tok' }), makeParams());
    expect(res.status).toBe(404);
    expect(deleteObject).toHaveBeenCalledWith(finalKeyFromCopyMock());
    expect(deleteObject).not.toHaveBeenCalledWith(pendingKey);
  });

  it('returns 400 when updateDraft throws DraftDocumentTooLargeError', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce(baseDraft);
    vi.mocked(headObjectMetadata).mockResolvedValueOnce({
      contentLength: 100,
      contentType: 'image/jpeg',
    });
    vi.mocked(copyObjectInBucket).mockResolvedValueOnce(undefined);
    vi.mocked(deleteObject).mockResolvedValue(undefined);
    vi.mocked(updateDraft).mockRejectedValueOnce(new DraftDocumentTooLargeError('too large'));

    const res = await POST(makeRequest({ pendingKey }, { [SESSION_COOKIE]: 'tok' }), makeParams());
    expect(res.status).toBe(400);
    expect(deleteObject).toHaveBeenCalledWith(finalKeyFromCopyMock());
    expect(deleteObject).not.toHaveBeenCalledWith(pendingKey);
  });

  it('succeeds: copies, deletes pending, updates draft, deletes previous thumbnail, returns preview URL', async () => {
    const previousKey = buildDraftThumbnailFinalKey(USER_ID, DRAFT_ID, 'old-1', 'jpg');

    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce({ ...baseDraft, thumbnailR2Key: previousKey });
    vi.mocked(headObjectMetadata).mockResolvedValueOnce({
      contentLength: 2048,
      contentType: 'image/jpeg',
    });
    vi.mocked(copyObjectInBucket).mockResolvedValueOnce(undefined);
    vi.mocked(deleteObject).mockResolvedValue(undefined);
    vi.mocked(updateDraft).mockImplementationOnce(async (_id, input) => ({
      ...baseDraft,
      thumbnailR2Key: input.thumbnailR2Key as string,
      thumbnailContentType: input.thumbnailContentType as string,
    }));
    vi.mocked(getObjectUrl).mockResolvedValueOnce('https://r2.example/presigned');

    const res = await POST(makeRequest({ pendingKey }, { [SESSION_COOKIE]: 'tok' }), makeParams());

    const finalKey = finalKeyFromCopyMock();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toBe('Thumbnail saved');
    expect(json.data.thumbnailR2Key).toBe(finalKey);
    expect(json.data.thumbnailPreviewUrl).toBe('https://r2.example/presigned');

    expect(copyObjectInBucket).toHaveBeenCalledWith(pendingKey, finalKey);
    expect(updateDraft).toHaveBeenCalledWith(DRAFT_ID, {
      thumbnailR2Key: finalKey,
      thumbnailContentType: 'image/jpeg',
    });

    expect(deleteObject).toHaveBeenCalledWith(pendingKey);
    expect(deleteObject).toHaveBeenCalledWith(previousKey);

    // updateDraft must complete before pendingKey is deleted so a transient
    // Appwrite failure leaves the pending object available for a retry.
    const updateOrder = vi.mocked(updateDraft).mock.invocationCallOrder[0];
    const pendingDeleteOrder = vi.mocked(deleteObject).mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(pendingDeleteOrder);
  });

  it('succeeds without preview URL when getObjectUrl fails', async () => {
    const pngPending = buildDraftThumbnailPendingKey(USER_ID, DRAFT_ID, 'p2', 'png');

    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce(baseDraft);
    vi.mocked(headObjectMetadata).mockResolvedValueOnce({
      contentLength: 100,
      contentType: 'image/png',
    });
    vi.mocked(copyObjectInBucket).mockResolvedValueOnce(undefined);
    vi.mocked(deleteObject).mockResolvedValue(undefined);
    vi.mocked(updateDraft).mockImplementationOnce(async (_id, input) => ({
      ...baseDraft,
      thumbnailR2Key: input.thumbnailR2Key as string,
      thumbnailContentType: input.thumbnailContentType as string,
    }));
    vi.mocked(getObjectUrl).mockRejectedValueOnce(new Error('presign failed'));

    const res = await POST(
      makeRequest({ pendingKey: pngPending }, { [SESSION_COOKIE]: 'tok' }),
      makeParams()
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.thumbnailPreviewUrl).toBeUndefined();
    expect(json.data.thumbnailR2Key).toBe(finalKeyFromCopyMock());
  });
});
