// =============================================================================
// POST /api/register
// =============================================================================
// Creates an Appwrite Auth user and stores role + isSupporter in the user's
// prefs (no separate database required).
// Returns 201 on success; structured error JSON on failure.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { ID } from 'node-appwrite';
import { appwriteUsers } from '@/lib/appwrite';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, name } = body as {
      email?: string;
      password?: string;
      name?: string;
    };

    // ── Server-side validation ────────────────────────────────────────────────
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters.' },
        { status: 400 }
      );
    }

    // ── 1. Create Appwrite Auth user ──────────────────────────────────────────
    let authUser;
    try {
      authUser = await appwriteUsers.create(
        ID.unique(),
        email,
        undefined, // phone
        password,
        name ?? undefined
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

    // ── 2. Store role + isSupporter in user prefs (no database needed) ────────
    await appwriteUsers.updatePrefs(authUser.$id, {
      role: 'user',
      isSupporter: false,
      createdAt: new Date().toISOString(),
    });

    // ── 3. Add "user" label for easy querying later ───────────────────────────
    await appwriteUsers.updateLabels(authUser.$id, ['user']);

    return NextResponse.json(
      { message: 'Account created successfully.', userId: authUser.$id },
      { status: 201 }
    );
  } catch (err: unknown) {
    console.error('[POST /api/register]', err);
    const publicMessage = 'An unexpected error occurred. Please try again later.';
    return NextResponse.json({ error: publicMessage }, { status: 500 });
  }
}
