/**
 * GET/PATCH /api/drafts/[id] — thumbnail preview is only presigned when thumbnailR2Key
 * matches isDraftThumbnailFinalKeyForUser (same gate as DELETE thumbnail cleanup).
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
    getObjectUrl: vi.fn(),
  };
});

import { GET, PATCH } from '@/app/api/drafts/[id]/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getDraftById, updateDraft } from '@/lib/repositories/drafts';
import { getObjectUrl, buildDraftThumbnailFinalKey } from '@/lib/r2';

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

describe('GET /api/drafts/[id] thumbnail preview gating', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('does not presign or expose thumbnail fields when stored key is not under this user/draft', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    const badKey = 'draft-thumbnails/other-user/draft-abc/u1.jpg';
    vi.mocked(getDraftById).mockResolvedValueOnce({
      ...baseDraft,
      thumbnailR2Key: badKey,
      thumbnailContentType: 'image/jpeg',
    });

    const res = await GET(makeRequest('GET', undefined, { [SESSION_COOKIE]: 'tok' }), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.thumbnailR2Key).toBeUndefined();
    expect(body.data.thumbnailContentType).toBeUndefined();
    expect(body.data.thumbnailPreviewUrl).toBeUndefined();
    expect(getObjectUrl).not.toHaveBeenCalled();
  });

  it('presigns when key is a valid final thumbnail key for this user and draft', async () => {
    const goodKey = buildDraftThumbnailFinalKey(USER_ID, DRAFT_ID, 'u1', 'jpg');
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce({
      ...baseDraft,
      thumbnailR2Key: goodKey,
      thumbnailContentType: 'image/jpeg',
    });
    vi.mocked(getObjectUrl).mockResolvedValueOnce('https://r2.example/presigned');

    const res = await GET(makeRequest('GET', undefined, { [SESSION_COOKIE]: 'tok' }), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.thumbnailR2Key).toBe(goodKey);
    expect(body.data.thumbnailPreviewUrl).toBe('https://r2.example/presigned');
    expect(getObjectUrl).toHaveBeenCalledWith(goodKey);
  });
});

describe('PATCH /api/drafts/[id] thumbnail preview gating', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('strips invalid thumbnail keys from the response without calling getObjectUrl', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    const badKey = 'draft-thumbnails/other-user/draft-abc/u1.jpg';
    vi.mocked(getDraftById).mockResolvedValueOnce({
      ...baseDraft,
      thumbnailR2Key: badKey,
      thumbnailContentType: 'image/jpeg',
    });
    vi.mocked(updateDraft).mockResolvedValueOnce({
      ...baseDraft,
      title: 'Patched',
      thumbnailR2Key: badKey,
      thumbnailContentType: 'image/jpeg',
    });

    const res = await PATCH(
      makeRequest('PATCH', { title: 'Patched' }, { [SESSION_COOKIE]: 'tok' }),
      makeParams()
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.title).toBe('Patched');
    expect(body.data.thumbnailR2Key).toBeUndefined();
    expect(body.data.thumbnailContentType).toBeUndefined();
    expect(body.data.thumbnailPreviewUrl).toBeUndefined();
    expect(getObjectUrl).not.toHaveBeenCalled();
  });
});
