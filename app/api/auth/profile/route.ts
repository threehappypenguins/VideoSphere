// =============================================================================
// GET /api/auth/profile
// PATCH /api/auth/profile
// =============================================================================
// Returns or updates the authenticated user's profile from user_profiles.
// Requires a valid session cookie.
//
// GET response: full User object
// PATCH body: { name?: string, email?: string }
// PATCH response: updated User object
// Errors:   400 (invalid body/validation), 401, 403 (Google email change),
//           404, 409 (email in use), 500
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedSessionUserId } from '@/lib/api/auth';
import { isValidEmail, normalizeEmail } from '@/lib/auth/email';
import { getUserByEmail, getUserById, updateUser } from '@/lib/repositories/users';

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns A response describing the request result.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await getAuthenticatedSessionUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (err) {
    console.error('[GET /api/auth/profile]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Updates the authenticated user's display name and/or email address.
 * @param req - The incoming request object.
 * @returns The updated user profile or a validation error.
 */
export async function PATCH(req: NextRequest) {
  try {
    const userId = await getAuthenticatedSessionUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const profile = await getUserById(userId);
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    if (body === null || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body must be a JSON object.' }, { status: 400 });
    }

    const { name: rawName, email: rawEmail } = body as Record<string, unknown>;

    const hasName = rawName !== undefined;
    const hasEmail = rawEmail !== undefined;

    if (!hasName && !hasEmail) {
      return NextResponse.json(
        { error: 'At least one of name or email must be provided.' },
        { status: 400 }
      );
    }

    const updateData: { name?: string; email?: string } = {};

    if (hasName) {
      if (typeof rawName !== 'string') {
        return NextResponse.json({ error: 'name must be a string.' }, { status: 400 });
      }
      const trimmedName = rawName.trim();
      if (!trimmedName) {
        return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 });
      }
      updateData.name = trimmedName;
    }

    if (hasEmail) {
      if (typeof rawEmail !== 'string') {
        return NextResponse.json({ error: 'email must be a string.' }, { status: 400 });
      }

      if (profile.authProvider !== 'password') {
        return NextResponse.json(
          { error: 'Email change is not available for Google sign-in accounts.' },
          { status: 403 }
        );
      }

      const normalizedEmail = normalizeEmail(rawEmail);
      if (!normalizedEmail) {
        return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
      }
      if (!isValidEmail(normalizedEmail)) {
        return NextResponse.json(
          { error: 'Email must be a valid email address.' },
          { status: 400 }
        );
      }

      if (normalizedEmail !== profile.email) {
        const existing = await getUserByEmail(normalizedEmail);
        if (existing && existing.userId !== userId) {
          return NextResponse.json(
            { error: 'That email address is already in use by another account.' },
            { status: 409 }
          );
        }
      }

      updateData.email = normalizedEmail;
    }

    const updatedUser = await updateUser(userId, updateData);
    return NextResponse.json(updatedUser);
  } catch (err) {
    const mongoErr = err as { code?: number; message?: string };
    if (mongoErr.code === 11000 || mongoErr.message?.toLowerCase().includes('duplicate')) {
      return NextResponse.json(
        { error: 'That email address is already in use by another account.' },
        { status: 409 }
      );
    }

    const repoErr = err as { code?: number };
    if (repoErr?.code === 404) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    console.error('[PATCH /api/auth/profile]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
