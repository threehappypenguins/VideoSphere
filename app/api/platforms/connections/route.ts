// =============================================================================
// GET /api/platforms/connections
// =============================================================================
// Returns the authenticated user's connected platform accounts in public shape
// (no tokens). Used by client components (e.g. draft form platform selector)
// that need to know which platforms are connected.
//
// Auth: reads the httpOnly Appwrite session cookie via getAuthenticatedUserId.
// Returns 401 if not authenticated, 200 with the account list otherwise.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getConnectedAccountsByUser } from '@/lib/repositories/connected-accounts';
import type { ApiResponse, ApiError, ConnectedAccountPublic } from '@/types';

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
    const accounts = await getConnectedAccountsByUser(userId);
    const res: ApiResponse<ConnectedAccountPublic[]> = { data: accounts };
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    console.error('[GET /api/platforms/connections] Failed to fetch accounts:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to fetch connected accounts',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
