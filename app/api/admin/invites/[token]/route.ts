import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/admin-auth';
import { revokeInviteToken } from '@/lib/repositories/invites';
import type { ApiError } from '@/types';

/**
 * Handles DELETE requests for this route.
 * @param request - The incoming request object.
 * @param context - Route context containing dynamic params.
 * @returns A response describing the request result.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const adminCheck = await requireAdmin(request, '[DELETE /api/admin/invites/[token]]');
  if (adminCheck.ok === false) return adminCheck.response;

  const { token } = await context.params;
  if (!token?.trim()) {
    return NextResponse.json({ error: 'Token is required.' }, { status: 400 });
  }

  try {
    const revoked = await revokeInviteToken(token.trim());
    if (!revoked) {
      return NextResponse.json({ error: 'Invite not found.' }, { status: 404 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('[DELETE /api/admin/invites/[token]]', error);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to revoke invite',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
