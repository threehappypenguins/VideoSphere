// =============================================================================
// POST /api/drafts  — create a new draft
// GET  /api/drafts  — list all drafts for the authenticated user
// =============================================================================
// Auth: reads the httpOnly session cookie, creates a scoped Appwrite Client
// with setSession(), and calls Account.get() to verify identity.
// Returns 401 if no valid session exists.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { Client, Account } from 'node-appwrite';
import { getSessionCookieName } from '@/lib/auth-session-cookie';
import { createDraft, listDraftsByUser } from '@/lib/repositories/drafts';
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
// POST /api/drafts
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { title, description, tags } = body as Record<string, unknown>;

  if (!title || typeof title !== 'string' || title.trim() === '') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  if (tags !== undefined && !Array.isArray(tags)) {
    return NextResponse.json({ error: 'tags must be an array of strings' }, { status: 400 });
  }

  if (Array.isArray(tags) && !tags.every((t) => typeof t === 'string')) {
    return NextResponse.json({ error: 'tags must be an array of strings' }, { status: 400 });
  }

  try {
    const draft = await createDraft({
      userId,
      title: title.trim(),
      description: typeof description === 'string' ? description : '',
      tags: Array.isArray(tags) ? (tags as string[]) : [],
    });

    const response: ApiResponse<Draft> = { data: draft, message: 'Draft created' };
    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    console.error('[POST /api/drafts]', err);
    return NextResponse.json({ error: 'Failed to create draft' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET /api/drafts
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const drafts = await listDraftsByUser(userId);
    const response: ApiResponse<Draft[]> = { data: drafts };
    return NextResponse.json(response);
  } catch (err) {
    console.error('[GET /api/drafts]', err);
    return NextResponse.json({ error: 'Failed to list drafts' }, { status: 500 });
  }
}
