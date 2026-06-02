import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/admin-auth';
import { OAUTH_PASSWORD_RESET_MESSAGE } from '@/lib/auth/password';
import {
  ADMIN_RESET_PASSWORD_TOKEN_TTL_MS,
  buildPasswordResetUrl,
  issuePasswordResetToken,
} from '@/lib/auth/password-reset';
import { getUserPasswordAuthStateById } from '@/lib/repositories/users';
import type { ApiError } from '@/types';

/**
 * Handles POST requests to generate an admin-initiated password reset link.
 * @param request - The incoming request object.
 * @param context - Route context containing the target user id.
 * @returns A response with the reset URL for the admin UI.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ userId: string }> }) {
  const adminCheck = await requireAdmin(request, '[POST /api/admin/users/[userId]/reset-password]');
  if (adminCheck.ok === false) return adminCheck.response;

  const { userId: targetUserId } = await context.params;
  if (!targetUserId) {
    return NextResponse.json({ error: 'User id is required.' }, { status: 400 });
  }

  try {
    const authState = await getUserPasswordAuthStateById(targetUserId);
    if (!authState) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    if (!authState.supportsPasswordReset) {
      return NextResponse.json({ error: OAUTH_PASSWORD_RESET_MESSAGE }, { status: 409 });
    }

    const { token } = await issuePasswordResetToken(
      targetUserId,
      ADMIN_RESET_PASSWORD_TOKEN_TTL_MS,
      'admin'
    );
    const resetUrl = buildPasswordResetUrl(token, request);

    return NextResponse.json({ resetUrl });
  } catch (error) {
    console.error('[POST /api/admin/users/[userId]/reset-password]', error);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to generate reset link',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
