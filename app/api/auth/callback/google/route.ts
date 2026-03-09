import { NextRequest, NextResponse } from 'next/server';
import { getUserById, createUser } from '@/lib/repositories/users';

/**
 * POST /api/auth/callback/google
 *
 * Creates or updates the user_profiles document for a newly authenticated user.
 * Called by the callback page after successful OAuth.
 *
 * The session is established by Appwrite's OAuth and the browser has cookies.
 * This endpoint uses an API key to create/verify the user_profiles document in Appwrite.
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    if (body === null || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body must be a JSON object.' }, { status: 400 });
    }

    const { userId: rawUserId, email: rawEmail } = body as Record<string, unknown>;
    if (typeof rawUserId !== 'string' || typeof rawEmail !== 'string') {
      return NextResponse.json(
        { error: 'userId and email are required and must be strings.' },
        { status: 400 }
      );
    }

    const userId = rawUserId.trim();
    const email = rawEmail.trim().toLowerCase();
    if (!userId || !email) {
      return NextResponse.json({ error: 'Missing userId or email' }, { status: 400 });
    }

    const existing = await getUserById(userId);
    if (existing) {
      console.log(`[POST /api/auth/callback/google] User profile already exists for ${userId}`);
      return NextResponse.json({ success: true, message: 'Profile already exists' });
    }

    console.log(`[POST /api/auth/callback/google] Creating new user_profiles for user ${userId}`);
    try {
      await createUser({
        userId,
        email,
        isSupporter: false,
        role: 'user',
      });
      return NextResponse.json({ success: true, message: 'Profile created' });
    } catch (createError: unknown) {
      const err = createError as { code?: number };
      if (err.code === 409) {
        console.log(
          `[POST /api/auth/callback/google] User profile already exists (race) for ${userId}`
        );
        return NextResponse.json({ success: true, message: 'Profile already exists' });
      }
      throw createError;
    }
  } catch (error) {
    console.error('[POST /api/auth/callback/google] Error:', error);
    return NextResponse.json({ error: 'Failed to create or verify user profile' }, { status: 500 });
  }
}

/**
 * GET /api/auth/callback/google
 *
 * This endpoint is no longer used (OAuth callback is now a page route).
 * Kept for backwards compatibility.
 */
export async function GET() {
  return NextResponse.json(
    { error: 'OAuth callback is handled by /auth/callback/google page route' },
    { status: 404 }
  );
}
