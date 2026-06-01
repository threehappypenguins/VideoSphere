import { NextResponse } from 'next/server';
import { ensureSetupTokenForFirstRun, hasAnyUsers } from '@/lib/repositories/invites';

/**
 * Triggers first-run setup token creation and returns setup status.
 * Safe to call on startup (e.g. from Docker healthcheck) when no users exist yet.
 * @returns Setup status when first-run setup is pending or complete.
 */
export async function GET() {
  try {
    if (await hasAnyUsers()) {
      return NextResponse.json({ setupRequired: false });
    }

    const result = await ensureSetupTokenForFirstRun();

    if (!result) {
      return NextResponse.json(
        { setupRequired: true, message: 'Setup token could not be created.' },
        { status: 503 }
      );
    }

    return NextResponse.json({
      setupRequired: true,
      created: result.created,
    });
  } catch (error) {
    console.error('[GET /api/auth/setup/bootstrap]', error);
    return NextResponse.json({ error: 'Failed to initialize first-run setup.' }, { status: 500 });
  }
}
