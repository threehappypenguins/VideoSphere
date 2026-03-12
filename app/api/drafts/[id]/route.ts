// =============================================================================
// GET    /api/drafts/[id]  — fetch a specific draft
// PATCH  /api/drafts/[id]  — partial update of a draft (only supplied fields changed)
// DELETE /api/drafts/[id]  — delete a specific draft
// =============================================================================
// Auth: reads the httpOnly session cookie, creates a scoped Appwrite Client
// with setSession(), and calls Account.get() to verify identity.
// Returns 401 if no valid session exists, 404 if the draft doesn't exist or
// is not owned by the authenticated user.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { Client, Account } from 'node-appwrite';
import { getSessionCookieName } from '@/lib/auth-session-cookie';
import { getDraftById, updateDraft, deleteDraft } from '@/lib/repositories/drafts';
import type { ApiResponse, Draft } from '@/types';

// ---------------------------------------------------------------------------
// Shared auth helper
// ---------------------------------------------------------------------------

async function getAuthenticatedUserId(req: NextRequest): Promise<string | null> {
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  const cookieName = projectId ? getSessionCookieName(projectId) : null;
  const sessionSecret = cookieName ? req.cookies.get(cookieName)?.value : null;

  if (!endpoint || !projectId || !sessionSecret) return null;

  try {
    const client = new Client()
      .setEndpoint(endpoint)
      .setProject(projectId)
      .setSession(sessionSecret);

    const account = new Account(client);
    const user = await account.get();
    return user.$id;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/drafts/[id]
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const draft = await getDraftById(id);
    if (!draft || draft.userId !== userId) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    const response: ApiResponse<Draft> = { data: draft };
    return NextResponse.json(response);
  } catch (err) {
    console.error('[GET /api/drafts/[id]]', err);
    return NextResponse.json({ error: 'Failed to fetch draft' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/drafts/[id]  — partial update (only supplied fields are changed)
// ---------------------------------------------------------------------------

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership before updating
  let existing: Draft | null;
  try {
    existing = await getDraftById(id);
  } catch (err) {
    console.error('[PATCH /api/drafts/[id]] getDraftById', err);
    return NextResponse.json({ error: 'Failed to fetch draft' }, { status: 500 });
  }

  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const { title, description, tags } = body as Record<string, unknown>;

  // At least one field must be provided
  if (title === undefined && description === undefined && tags === undefined) {
    return NextResponse.json(
      { error: 'At least one field (title, description, tags) must be provided' },
      { status: 400 }
    );
  }

  if (title !== undefined && (typeof title !== 'string' || title.trim() === '')) {
    return NextResponse.json({ error: 'title must be a non-empty string' }, { status: 400 });
  }

  if (description !== undefined && typeof description !== 'string') {
    return NextResponse.json({ error: 'description must be a string' }, { status: 400 });
  }

  if (tags !== undefined && !Array.isArray(tags)) {
    return NextResponse.json({ error: 'tags must be an array of strings' }, { status: 400 });
  }

  if (Array.isArray(tags) && !tags.every((t) => typeof t === 'string')) {
    return NextResponse.json({ error: 'tags must be an array of strings' }, { status: 400 });
  }

  try {
    const updated = await updateDraft(id, {
      ...(title !== undefined && { title: (title as string).trim() }),
      ...(description !== undefined && { description: description as string }),
      ...(tags !== undefined && { tags: tags as string[] }),
    });

    if (!updated) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    const response: ApiResponse<Draft> = { data: updated, message: 'Draft updated' };
    return NextResponse.json(response);
  } catch (err) {
    console.error('[PATCH /api/drafts/[id]]', err);
    return NextResponse.json({ error: 'Failed to update draft' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/drafts/[id]
// ---------------------------------------------------------------------------

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership before deleting
  let existing: Draft | null;
  try {
    existing = await getDraftById(id);
  } catch (err) {
    console.error('[DELETE /api/drafts/[id]] getDraftById', err);
    return NextResponse.json({ error: 'Failed to fetch draft' }, { status: 500 });
  }

  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }

  try {
    await deleteDraft(id);
    return NextResponse.json({ data: null, message: 'Draft deleted' }, { status: 200 });
  } catch (err) {
    console.error('[DELETE /api/drafts/[id]]', err);
    return NextResponse.json({ error: 'Failed to delete draft' }, { status: 500 });
  }
}
