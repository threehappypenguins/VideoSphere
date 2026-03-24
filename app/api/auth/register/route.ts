// =============================================================================
// POST /api/auth/register
// =============================================================================
// Creates user + user_profiles, then creates session via admin client and sets
// cookie server-side. Per Appwrite Next.js SSR tutorial; API key needs sessions.write.
// https://appwrite.io/docs/tutorials/nextjs-ssr-auth/step-5
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { ID } from 'node-appwrite';
import { appwriteUsers, appwriteAuth } from '@/lib/appwrite';
import { getSessionCookieName, getSessionCookieOptions } from '@/lib/auth-session-cookie';
import { createUser } from '@/lib/repositories/users';

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    if (body === null || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body must be a JSON object.' }, { status: 400 });
    }

    const {
      email: rawEmail,
      password: rawPassword,
      name: rawName,
    } = body as Record<string, unknown>;

    // ── Server-side validation (types + presence + format) ────────────────────
    if (typeof rawEmail !== 'string' || typeof rawPassword !== 'string') {
      return NextResponse.json(
        { error: 'Email and password are required and must be strings.' },
        { status: 400 }
      );
    }

    const email = rawEmail.trim().toLowerCase();
    const password = rawPassword;

    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters.' },
        { status: 400 }
      );
    }

    const name =
      rawName === undefined || rawName === null
        ? undefined
        : typeof rawName === 'string'
          ? rawName.trim() || undefined
          : undefined;

    // ── 1. Create Appwrite Auth user ──────────────────────────────────────────
    let authUser;
    try {
      authUser = await appwriteUsers.create(
        ID.unique(),
        email,
        undefined, // phone
        password,
        name
      );
    } catch (err: unknown) {
      const appwriteErr = err as { type?: string; message?: string };
      if (
        appwriteErr?.type === 'user_already_exists' ||
        appwriteErr?.message?.toLowerCase().includes('already exists')
      ) {
        return NextResponse.json(
          { error: 'Email already registered. Please sign in instead.' },
          { status: 409 }
        );
      }
      throw err;
    }

    // ── 2. user_profiles row — source of truth for role, isSupporter (same as Google OAuth createUser)
    try {
      await createUser({
        userId: authUser.$id,
        email,
        isSupporter: false,
        role: 'user',
      });
    } catch (profileErr: unknown) {
      const err = profileErr as { code?: number };
      if (err.code === 409) {
        // Row already exists (e.g. race); keep auth user
      } else {
        try {
          await appwriteUsers.delete(authUser.$id);
        } catch (rollbackErr) {
          console.error('[POST /api/auth/register] Failed to rollback user creation', rollbackErr);
        }
        throw profileErr;
      }
    }

    const response = NextResponse.json(
      { message: 'Account created successfully.', userId: authUser.$id },
      { status: 201 }
    );

    // Create session with admin client (API key with sessions.write); SDK returns session.secret
    const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
    if (projectId) {
      try {
        const session = await appwriteAuth.createEmailPasswordSession({
          email,
          password,
        });
        const secret =
          session && typeof session === 'object' && 'secret' in session
            ? (session as { secret?: string }).secret
            : undefined;
        if (typeof secret === 'string' && secret.length > 0) {
          response.cookies.set(getSessionCookieName(projectId), secret, getSessionCookieOptions());
        }
      } catch (sessionErr) {
        console.error('[POST /api/auth/register] createEmailPasswordSession', sessionErr);
        // User is created; cookie not set — client can log in on login page
      }
    }

    return response;
  } catch (err: unknown) {
    console.error('[POST /api/auth/register]', err);
    const publicMessage = 'An unexpected error occurred. Please try again later.';
    return NextResponse.json({ error: publicMessage }, { status: 500 });
  }
}
