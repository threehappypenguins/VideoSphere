import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/admin-auth';
import { createInviteToken, listInviteTokens } from '@/lib/repositories/invites';
import type { ApiError, ApiResponse } from '@/types';

/**
 * Defines one invite row returned by the admin invite listing endpoint.
 */
export interface AdminInviteRow {
  token: string;
  grantedRole: 'user' | 'admin';
  createdBy?: string;
  createdAt: string;
  expiresAt?: string;
}

/**
 * Defines the admin invite list payload.
 */
export interface AdminInvitesResponse {
  invites: AdminInviteRow[];
}

/**
 * Defines the admin invite creation payload.
 */
export interface CreateAdminInviteResponse {
  token: string;
  inviteUrl: string;
  expiresAt?: string;
}

/**
 * Handles GET requests for this route.
 * @param request - The incoming request object.
 * @returns A response describing the request result.
 */
export async function GET(request: NextRequest) {
  const adminCheck = await requireAdmin(request, '[GET /api/admin/invites]');
  if (adminCheck.ok === false) return adminCheck.response;

  try {
    const invites = await listInviteTokens({ includeSetup: false });
    const body: ApiResponse<AdminInvitesResponse> = {
      data: {
        invites: invites.map((invite) => ({
          token: invite.token,
          grantedRole: invite.grantedRole === 'admin' ? 'admin' : 'user',
          createdBy: invite.createdBy,
          createdAt: invite.createdAt,
          expiresAt: invite.expiresAt,
        })),
      },
    };

    return NextResponse.json(body);
  } catch (error) {
    console.error('[GET /api/admin/invites]', error);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load invites',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}

/**
 * Handles POST requests for this route.
 * @param request - The incoming request object.
 * @returns A response describing the request result.
 */
export async function POST(request: NextRequest) {
  const adminCheck = await requireAdmin(request, '[POST /api/admin/invites]');
  if (adminCheck.ok === false) return adminCheck.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (body === null || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body must be a JSON object.' }, { status: 400 });
  }

  const { expiresInDays: rawExpiresInDays, role: rawRole } = body as Record<string, unknown>;

  const grantedRole = rawRole === 'admin' ? 'admin' : 'user';

  let expiresAt: Date | undefined;
  if (rawExpiresInDays !== undefined) {
    if (typeof rawExpiresInDays !== 'number' || !Number.isFinite(rawExpiresInDays)) {
      return NextResponse.json(
        { error: 'expiresInDays must be a finite number.' },
        { status: 400 }
      );
    }

    if (rawExpiresInDays < 1 || rawExpiresInDays > 365) {
      return NextResponse.json(
        { error: 'expiresInDays must be between 1 and 365.' },
        { status: 400 }
      );
    }

    expiresAt = new Date(Date.now() + rawExpiresInDays * 24 * 60 * 60 * 1000);
  }

  try {
    const invite = await createInviteToken({
      createdBy: adminCheck.userId,
      expiresAt,
      grantedRole,
    });

    const inviteUrl = new URL(`/invite/${invite.token}`, request.nextUrl.origin).toString();
    const payload: ApiResponse<CreateAdminInviteResponse> = {
      data: {
        token: invite.token,
        inviteUrl,
        expiresAt: invite.expiresAt,
      },
    };

    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    console.error('[POST /api/admin/invites]', error);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to create invite',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
