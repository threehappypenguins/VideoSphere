// =============================================================================
// POST /api/drafts  — create a new draft
// GET  /api/drafts  — list all drafts for the authenticated user
// =============================================================================
// Auth: reads the httpOnly session cookie, creates a scoped Appwrite Client
// with setSession(), and calls Account.get() to verify identity.
// Returns 401 if no valid session exists.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { createDraft, listDraftsByUser } from '@/lib/repositories/drafts';
import type { ApiResponse, ApiError, Draft } from '@/types';

// ---------------------------------------------------------------------------
// POST /api/drafts
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'Invalid JSON body',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'Request body must be a JSON object',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  const { title, description, tags } = body as Record<string, unknown>;

  if (!title || typeof title !== 'string' || title.trim() === '') {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'title is required',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (description !== undefined && typeof description !== 'string') {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'description must be a string',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (tags !== undefined && !Array.isArray(tags)) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'tags must be an array of strings',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (Array.isArray(tags) && !tags.every((t) => typeof t === 'string')) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'tags must be an array of strings',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  try {
    const draft = await createDraft({
      userId,
      title: title.trim(),
      description: (description as string | undefined) ?? '',
      tags: Array.isArray(tags) ? (tags as string[]) : [],
    });

    const response: ApiResponse<Draft> = { data: draft, message: 'Draft created' };
    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    console.error('[POST /api/drafts]', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to create draft',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET /api/drafts
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  try {
    const drafts = await listDraftsByUser(userId);
    const response: ApiResponse<Draft[]> = { data: drafts };
    return NextResponse.json(response);
  } catch (err) {
    console.error('[GET /api/drafts]', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to list drafts',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
