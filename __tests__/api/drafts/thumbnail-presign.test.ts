/**
 * Tests for POST /api/drafts/[id]/thumbnail/presign
 *
 * Covers auth, contentType/fileSize validation, ownership (404), and successful presign.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/repositories/drafts', () => ({
  getDraftById: vi.fn(),
}));

vi.mock('@/lib/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/r2')>();
  return {
    ...actual,
    getPresignedUploadUrl: vi.fn(),
  };
});

import { POST } from '@/app/api/drafts/[id]/thumbnail/presign/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getDraftById } from '@/lib/repositories/drafts';
import { getPresignedUploadUrl } from '@/lib/r2';
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

function makeRequest(
  body: Record<string, unknown> | null,
  cookies: Record<string, string> = {}
): NextRequest {
  const url = new URL(`http://localhost:3000/api/drafts/${DRAFT_ID}/thumbnail/presign`);
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

describe('POST /api/drafts/[id]/thumbnail/presign', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getPresignedUploadUrl).mockResolvedValue('https://r2.example/presigned-put');
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);
    const res = await POST(
      makeRequest({ contentType: 'image/jpeg', fileSize: 1024 }, { [SESSION_COOKIE]: 'tok' }),
      makeParams()
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 when JSON body is invalid', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    const url = new URL(`http://localhost:3000/api/drafts/${DRAFT_ID}/thumbnail/presign`);
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

  it('returns 400 when contentType is missing or not JPEG/PNG', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(USER_ID);
    vi.mocked(getDraftById).mockResolvedValue(baseDraft);

    const r1 = await POST(makeRequest({}, { [SESSION_COOKIE]: 'tok' }), makeParams());
    expect(r1.status).toBe(400);

    const r2 = await POST(
      makeRequest({ contentType: 'image/webp', fileSize: 1024 }, { [SESSION_COOKIE]: 'tok' }),
      makeParams()
    );
    expect(r2.status).toBe(400);
    const j2 = await r2.json();
    expect(j2.message).toMatch(/contentType must be one of/i);

    expect(getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('returns 400 when fileSize is invalid', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(USER_ID);
    vi.mocked(getDraftById).mockResolvedValue(baseDraft);

    const badSizes = [0, -1, MAX_DRAFT_THUMBNAIL_BYTES + 1, NaN];
    for (const fileSize of badSizes) {
      const res = await POST(
        makeRequest({ contentType: 'image/jpeg', fileSize }, { [SESSION_COOKIE]: 'tok' }),
        makeParams()
      );
      expect(res.status).toBe(400);
      const j = await res.json();
      expect(j.message).toMatch(/fileSize must be between/i);
    }

    const resString = await POST(
      makeRequest({ contentType: 'image/jpeg', fileSize: '1024' }, { [SESSION_COOKIE]: 'tok' }),
      makeParams()
    );
    expect(resString.status).toBe(400);

    expect(getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('returns 404 when draft does not exist', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce(null);
    const res = await POST(
      makeRequest({ contentType: 'image/jpeg', fileSize: 1024 }, { [SESSION_COOKIE]: 'tok' }),
      makeParams()
    );
    expect(res.status).toBe(404);
    expect(getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('returns 404 when draft belongs to another user', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce({ ...baseDraft, userId: 'other' });
    const res = await POST(
      makeRequest({ contentType: 'image/jpeg', fileSize: 1024 }, { [SESSION_COOKIE]: 'tok' }),
      makeParams()
    );
    expect(res.status).toBe(404);
    expect(getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('returns 200 with uploadUrl, pendingKey, expiresIn and calls getPresignedUploadUrl', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce(baseDraft);

    const fileSize = 50_000;
    const res = await POST(
      makeRequest({ contentType: 'image/png', fileSize }, { [SESSION_COOKIE]: 'tok' }),
      makeParams()
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      uploadUrl: string;
      pendingKey: string;
      expiresIn: number;
    };
    expect(json.uploadUrl).toBe('https://r2.example/presigned-put');
    expect(json.expiresIn).toBe(900);
    expect(json.pendingKey).toMatch(
      new RegExp(`^temp/draft-thumbnail-pending/${USER_ID}/${DRAFT_ID}/[0-9a-f-]+\\.png$`, 'i')
    );

    expect(getPresignedUploadUrl).toHaveBeenCalledTimes(1);
    const [key, ct, size] = vi.mocked(getPresignedUploadUrl).mock.calls[0];
    expect(key).toBe(json.pendingKey);
    expect(ct).toBe('image/png');
    expect(size).toBe(fileSize);
  });

  it('returns 500 when getPresignedUploadUrl throws', async () => {
    const errLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(USER_ID);
    vi.mocked(getDraftById).mockResolvedValueOnce(baseDraft);
    vi.mocked(getPresignedUploadUrl).mockRejectedValueOnce(new Error('R2 unavailable'));

    const res = await POST(
      makeRequest({ contentType: 'image/jpeg', fileSize: 1024 }, { [SESSION_COOKIE]: 'tok' }),
      makeParams()
    );
    errLog.mockRestore();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toMatch(/presign thumbnail upload/i);
  });
});
