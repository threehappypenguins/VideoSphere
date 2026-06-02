import { NextRequest, NextResponse } from 'next/server';
import { isInviteTokenValid } from '@/lib/repositories/invites';

/**
 * Handles GET requests for this route.
 * @param _request - The incoming request object.
 * @param context - Route context containing dynamic params.
 * @returns A response describing the request result.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!token?.trim()) {
    return NextResponse.json({ error: 'Invite token is required.' }, { status: 400 });
  }

  const valid = await isInviteTokenValid(token.trim());
  if (!valid) {
    return NextResponse.json({ error: 'Invite not found.' }, { status: 404 });
  }

  return NextResponse.json({ valid: true });
}
