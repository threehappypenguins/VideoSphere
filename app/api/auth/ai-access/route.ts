import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getOpenRouterModelConfig } from '@/lib/ai/openrouter-config';
import type { ApiError } from '@/types';

interface AiAccessResponse {
  canUseAiMetadata: boolean;
}

/**
 * Returns whether the authenticated user can access AI metadata generation.
 * @param req - Incoming request used to validate authenticated session.
 * @returns JSON response with `canUseAiMetadata` flag or an unauthorized error.
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

  const openRouterConfig = getOpenRouterModelConfig();

  const response: AiAccessResponse = {
    canUseAiMetadata: openRouterConfig !== null,
  };
  return NextResponse.json(response, { status: 200 });
}
