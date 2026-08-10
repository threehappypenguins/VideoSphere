// =============================================================================
// DELETE /api/translation/credentials/:kind
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedSessionUserId } from '@/lib/api/auth';
import { clearCredential } from '@/lib/repositories/live-translation-channels';
import type { ApiError } from '@/types';

/**
 * Clears a stored credential for the authenticated owner.
 * @param req - Incoming request.
 * @param context - Route params with kind `openrouter` | `groq` | `gcp`.
 * @returns Updated owner channel view.
 */
export async function DELETE(req: NextRequest, context: { params: Promise<{ kind: string }> }) {
  try {
    const userId = await getAuthenticatedSessionUserId(req);
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Not authenticated', statusCode: 401 } satisfies ApiError,
        { status: 401 }
      );
    }

    const { kind } = await context.params;
    if (kind !== 'openrouter' && kind !== 'groq' && kind !== 'gcp') {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'kind must be openrouter, groq, or gcp',
          statusCode: 400,
        } satisfies ApiError,
        { status: 400 }
      );
    }

    const view = await clearCredential(userId, kind);
    if (!view) {
      return NextResponse.json(
        {
          error: 'Not Found',
          message: 'Translation channel not found',
          statusCode: 404,
        } satisfies ApiError,
        { status: 404 }
      );
    }
    return NextResponse.json(view);
  } catch (error) {
    console.error('[DELETE /api/translation/credentials/:kind]', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to clear credential',
        statusCode: 500,
      } satisfies ApiError,
      { status: 500 }
    );
  }
}
