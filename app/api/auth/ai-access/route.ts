import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
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

  const apiKey = process.env.OPENROUTER_API_KEY?.trim() ?? '';
  const modelList = (process.env.OPENROUTER_MODEL ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  const response: AiAccessResponse = {
    canUseAiMetadata: Boolean(apiKey) && modelList.length > 0,
  };
  return NextResponse.json(response, { status: 200 });
}
