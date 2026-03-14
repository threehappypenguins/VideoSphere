// =============================================================================
// DELETE /api/platforms/connections/[id]
// =============================================================================
// Disconnects a connected platform account by ID. Only the owning user can
// delete their own connection — ownership is verified before deletion.
//
// Auth: reads the httpOnly Appwrite session cookie via getAuthenticatedUserId.
// Returns 401 if not authenticated, 404 if the account doesn't exist or
// doesn't belong to the user, 204 on success.
//
// Note: token revocation with the provider (Google/Vimeo) is handled by the
// connections page server action, which has access to the decrypted tokens.
// This route only removes the DB record and is intended for API consumers.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  getConnectedAccountForUser,
  deleteConnectedAccount,
} from '@/lib/repositories/connected-accounts';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  const { id } = await params;

  try {
    // Primary-key lookup (O(1)) — returns null when the row doesn't exist or
    // belongs to a different user, keeping IDOR protection without a full list scan.
    const account = await getConnectedAccountForUser(id, userId);

    if (!account) {
      const errRes: ApiError = {
        error: 'Not Found',
        message: 'Connected account not found',
        statusCode: 404,
      };
      return NextResponse.json(errRes, { status: 404 });
    }

    await deleteConnectedAccount(id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error(`[DELETE /api/platforms/connections/${id}] Failed to delete account:`, err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to disconnect account',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
