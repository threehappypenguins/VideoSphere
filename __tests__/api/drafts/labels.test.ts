/**
 * Tests for GET/POST/PUT /api/drafts/labels
 *
 * Covers authentication, validation, merge semantics, and cascading draft updates on PUT.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { MAX_DRAFT_LABEL_LENGTH } from '@/lib/draft-labels';
import type { DraftLabelDefinition } from '@/types';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/repositories/users', () => ({
  getDraftLabelLibrary: vi.fn(),
  mergeDraftLabelsInLibrary: vi.fn(),
  setDraftLabelLibrary: vi.fn(),
  upsertDraftLabelsInLibrary: vi.fn(),
}));

vi.mock('@/lib/repositories/drafts', () => ({
  removeLabelsFromAllDraftsForUser: vi.fn(),
}));

import { GET, POST, PUT } from '@/app/api/drafts/labels/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { removeLabelsFromAllDraftsForUser } from '@/lib/repositories/drafts';
import {
  getDraftLabelLibrary,
  mergeDraftLabelsInLibrary,
  setDraftLabelLibrary,
  upsertDraftLabelsInLibrary,
} from '@/lib/repositories/users';

const USER_ID = 'user-123';

const sampleLibrary: DraftLabelDefinition[] = [
  { name: 'Sunday', color: '#6366f1' },
  { name: 'Easter', color: '#22c55e' },
  { name: 'Sunday Morning', color: '#ef4444' },
];

function makeRequest(
  method: 'GET' | 'POST' | 'PUT',
  options: {
    body?: unknown;
    searchParams?: Record<string, string>;
    invalidJson?: boolean;
  } = {}
): NextRequest {
  const url = new URL('http://localhost:3000/api/drafts/labels');
  if (options.searchParams) {
    for (const [key, value] of Object.entries(options.searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  const init: RequestInit = { method };
  if (options.invalidJson) {
    init.body = '{not-json';
    init.headers = { 'Content-Type': 'application/json' };
  } else if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = { 'Content-Type': 'application/json' };
  }

  return new NextRequest(url, init);
}

describe('GET /api/drafts/labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(USER_ID);
    vi.mocked(getDraftLabelLibrary).mockResolvedValue(sampleLibrary);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);

    const res = await GET(makeRequest('GET'));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
    expect(getDraftLabelLibrary).not.toHaveBeenCalled();
  });

  it('returns the full label library when no query is provided', async () => {
    const res = await GET(makeRequest('GET'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(sampleLibrary);
    expect(getDraftLabelLibrary).toHaveBeenCalledWith(USER_ID);
  });

  it('filters suggestions when q is provided', async () => {
    const res = await GET(makeRequest('GET', { searchParams: { q: 'sun' } }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      { name: 'Sunday', color: '#6366f1' },
      { name: 'Sunday Morning', color: '#ef4444' },
    ]);
  });

  it('returns 404 when the user profile is missing', async () => {
    vi.mocked(getDraftLabelLibrary).mockRejectedValueOnce(
      Object.assign(new Error('User profile not found'), { code: 404 })
    );

    const res = await GET(makeRequest('GET'));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not Found');
    expect(body.message).toBe('User profile not found');
    expect(body.statusCode).toBe(404);
  });

  it('returns 500 when loading the library fails', async () => {
    vi.mocked(getDraftLabelLibrary).mockRejectedValueOnce(new Error('db down'));

    const res = await GET(makeRequest('GET'));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toBe('Failed to load draft labels');
  });
});

describe('POST /api/drafts/labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(USER_ID);
    vi.mocked(upsertDraftLabelsInLibrary).mockResolvedValue(sampleLibrary);
    vi.mocked(mergeDraftLabelsInLibrary).mockResolvedValue(sampleLibrary);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);

    const res = await POST(makeRequest('POST', { body: { labels: ['Sunday'] } }));

    expect(res.status).toBe(401);
    expect(upsertDraftLabelsInLibrary).not.toHaveBeenCalled();
    expect(mergeDraftLabelsInLibrary).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await POST(makeRequest('POST', { invalidJson: true }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe('Invalid JSON body');
  });

  it('returns 400 when the body is not a JSON object', async () => {
    const res = await POST(makeRequest('POST', { body: ['Sunday'] }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe('Request body must be a JSON object');
  });

  it('returns 400 when labels is not an array', async () => {
    const res = await POST(makeRequest('POST', { body: { labels: 'Sunday' } }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe('labels must be an array');
  });

  it('returns 400 when string labels exceed the per-label length limit', async () => {
    const res = await POST(
      makeRequest('POST', { body: { labels: ['a'.repeat(MAX_DRAFT_LABEL_LENGTH + 1)] } })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain(String(MAX_DRAFT_LABEL_LENGTH));
    expect(upsertDraftLabelsInLibrary).not.toHaveBeenCalled();
  });

  it('upserts name-only labels when labels is a string array', async () => {
    const updatedLibrary = [...sampleLibrary, { name: 'Christmas', color: '#64748b' }];
    vi.mocked(upsertDraftLabelsInLibrary).mockResolvedValueOnce(updatedLibrary);

    const res = await POST(makeRequest('POST', { body: { labels: ['Christmas'] } }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Draft labels updated');
    expect(body.data).toEqual(updatedLibrary);
    expect(upsertDraftLabelsInLibrary).toHaveBeenCalledWith(USER_ID, ['Christmas']);
    expect(mergeDraftLabelsInLibrary).not.toHaveBeenCalled();
  });

  it('merges label definitions when labels includes objects', async () => {
    const entries = [{ name: 'Sunday', color: '#111111' }];
    const mergedLibrary = [
      { name: 'Sunday', color: '#111111' },
      { name: 'Easter', color: '#22c55e' },
    ];
    vi.mocked(mergeDraftLabelsInLibrary).mockResolvedValueOnce(mergedLibrary);

    const res = await POST(makeRequest('POST', { body: { labels: entries } }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(mergedLibrary);
    expect(mergeDraftLabelsInLibrary).toHaveBeenCalledWith(USER_ID, entries);
    expect(upsertDraftLabelsInLibrary).not.toHaveBeenCalled();
  });

  it('returns 500 when upserting labels fails', async () => {
    vi.mocked(upsertDraftLabelsInLibrary).mockRejectedValueOnce(new Error('db down'));

    const res = await POST(makeRequest('POST', { body: { labels: ['Sunday'] } }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toBe('Failed to update draft labels');
  });

  it('returns 404 when the user profile is missing', async () => {
    vi.mocked(upsertDraftLabelsInLibrary).mockRejectedValueOnce(
      Object.assign(new Error('User profile not found'), { code: 404 })
    );

    const res = await POST(makeRequest('POST', { body: { labels: ['Sunday'] } }));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not Found');
    expect(body.message).toBe('User profile not found');
    expect(body.statusCode).toBe(404);
  });
});

describe('PUT /api/drafts/labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(USER_ID);
    vi.mocked(getDraftLabelLibrary).mockResolvedValue(sampleLibrary);
    vi.mocked(setDraftLabelLibrary).mockImplementation(async (_userId, labels) => [...labels]);
    vi.mocked(removeLabelsFromAllDraftsForUser).mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);

    const res = await PUT(makeRequest('PUT', { body: { labels: [] } }));

    expect(res.status).toBe(401);
    expect(setDraftLabelLibrary).not.toHaveBeenCalled();
  });

  it('returns 400 when labels is missing', async () => {
    const res = await PUT(makeRequest('PUT', { body: {} }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe('labels must be provided');
  });

  it('replaces the library and removes deleted labels from drafts', async () => {
    const nextLibrary = [{ name: 'Sunday', color: '#6366f1' }];

    const res = await PUT(makeRequest('PUT', { body: { labels: nextLibrary } }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Draft labels saved');
    expect(body.data).toEqual(nextLibrary);
    expect(setDraftLabelLibrary).toHaveBeenCalledWith(USER_ID, nextLibrary);
    expect(removeLabelsFromAllDraftsForUser).toHaveBeenCalledTimes(1);
    expect(removeLabelsFromAllDraftsForUser).toHaveBeenCalledWith(USER_ID, [
      'Easter',
      'Sunday Morning',
    ]);
  });

  it('does not cascade draft updates when no labels were removed', async () => {
    const res = await PUT(makeRequest('PUT', { body: { labels: sampleLibrary } }));

    expect(res.status).toBe(200);
    expect(removeLabelsFromAllDraftsForUser).not.toHaveBeenCalled();
  });

  it('returns 500 without persisting the library when draft removal fails', async () => {
    const nextLibrary = [{ name: 'Sunday', color: '#6366f1' }];
    vi.mocked(removeLabelsFromAllDraftsForUser).mockRejectedValueOnce(new Error('db down'));

    const res = await PUT(makeRequest('PUT', { body: { labels: nextLibrary } }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toBe('Failed to save draft labels');
    expect(removeLabelsFromAllDraftsForUser).toHaveBeenCalled();
    expect(setDraftLabelLibrary).not.toHaveBeenCalled();
  });

  it('returns 500 when saving the library fails', async () => {
    vi.mocked(setDraftLabelLibrary).mockRejectedValueOnce(new Error('db down'));

    const res = await PUT(makeRequest('PUT', { body: { labels: sampleLibrary } }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toBe('Failed to save draft labels');
  });

  it('returns 404 when the user profile is missing', async () => {
    vi.mocked(setDraftLabelLibrary).mockRejectedValueOnce(
      Object.assign(new Error('User profile not found'), { code: 404 })
    );

    const res = await PUT(makeRequest('PUT', { body: { labels: sampleLibrary } }));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not Found');
    expect(body.message).toBe('User profile not found');
    expect(body.statusCode).toBe(404);
  });
});
