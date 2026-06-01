import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/admin-auth';
import {
  countUsersWithRole,
  deleteUserById,
  getUserById,
  revokeStoredGoogleAuthForUser,
  updateUser,
} from '@/lib/repositories/users';
import type { ApiError, ApiResponse, UserRole } from '@/types';

/**
 * Defines one user row returned by admin user mutation endpoints.
 */
export interface AdminUserMutationRow {
  userId: string;
  email: string;
  name?: string;
  role: UserRole;
  createdAt: string;
}

function parseUserRole(value: unknown): UserRole | null {
  if (value === 'admin' || value === 'user') return value;
  return null;
}

function isUserNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 404;
}

async function validateAdminDemotion(
  targetUserId: string,
  nextRole: UserRole
): Promise<string | null> {
  const target = await getUserById(targetUserId);
  if (!target) return 'User not found.';

  if (target.role === 'admin' && nextRole === 'user') {
    const adminCount = await countUsersWithRole('admin');
    if (adminCount <= 1) {
      return 'Cannot remove the last admin.';
    }
  }

  return null;
}

/**
 * Handles PATCH requests for this route.
 * @param request - The incoming request object.
 * @param context - Route context containing the target user id.
 * @returns A response describing the request result.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  const adminCheck = await requireAdmin(request, '[PATCH /api/admin/users/[userId]]');
  if (adminCheck.ok === false) return adminCheck.response;

  const { userId: targetUserId } = await context.params;
  if (!targetUserId) {
    return NextResponse.json({ error: 'User id is required.' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (body === null || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body must be a JSON object.' }, { status: 400 });
  }

  const { role: rawRole } = body as Record<string, unknown>;
  const nextRole = parseUserRole(rawRole);
  if (!nextRole) {
    return NextResponse.json({ error: 'role must be "user" or "admin".' }, { status: 400 });
  }

  try {
    const demotionError = await validateAdminDemotion(targetUserId, nextRole);
    if (demotionError) {
      return NextResponse.json({ error: demotionError }, { status: 409 });
    }

    const updated = await updateUser(targetUserId, { role: nextRole });

    const payload: ApiResponse<{ user: AdminUserMutationRow }> = {
      data: {
        user: {
          userId: updated.userId,
          email: updated.email,
          name: updated.name,
          role: updated.role,
          createdAt: updated.$createdAt,
        },
      },
    };

    return NextResponse.json(payload);
  } catch (error) {
    if (isUserNotFoundError(error)) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    console.error('[PATCH /api/admin/users/[userId]]', error);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to update user',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}

/**
 * Handles DELETE requests for this route.
 * @param request - The incoming request object.
 * @param context - Route context containing the target user id.
 * @returns A response describing the request result.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  const adminCheck = await requireAdmin(request, '[DELETE /api/admin/users/[userId]]');
  if (adminCheck.ok === false) return adminCheck.response;

  const { userId: targetUserId } = await context.params;
  if (!targetUserId) {
    return NextResponse.json({ error: 'User id is required.' }, { status: 400 });
  }

  if (targetUserId === adminCheck.userId) {
    return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 409 });
  }

  try {
    const target = await getUserById(targetUserId);
    if (!target) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    if (target.role === 'admin') {
      const adminCount = await countUsersWithRole('admin');
      if (adminCount <= 1) {
        return NextResponse.json({ error: 'Cannot delete the last admin.' }, { status: 409 });
      }
    }

    await revokeStoredGoogleAuthForUser(targetUserId);
    const deleted = await deleteUserById(targetUserId);
    if (!deleted) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('[DELETE /api/admin/users/[userId]]', error);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to delete user',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
