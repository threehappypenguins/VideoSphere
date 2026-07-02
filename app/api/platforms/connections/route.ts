// =============================================================================
// GET /api/platforms/connections
// =============================================================================
// Returns the authenticated user's connected platform accounts in public shape
// (no tokens). Used by client components (e.g. draft form platform selector)
// that need to know which platforms are connected.
//
// Auth: reads the httpOnly authenticated session cookie via getAuthenticatedUserId.
// Returns 401 if not authenticated, 200 with the account list otherwise.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getConnectedAccountsWithHealth } from '@/lib/platforms/connected-accounts-health';
import type { ApiResponse, ApiError, ConnectedAccountPublic } from '@/types';

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns A response describing the request result.
 */
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
    const accounts = await getConnectedAccountsWithHealth(userId);
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
