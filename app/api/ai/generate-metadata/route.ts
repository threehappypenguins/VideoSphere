// =============================================================================
// POST /api/ai/generate-metadata
// =============================================================================
// Accepts a video fileName, optional userPrompt, and platforms array.
// Verifies the session, selects the configured OpenRouter model, and returns
// AI-generated title, description, and tags for the video.
//
// Auth: requires a valid authenticated session cookie (401 if missing/invalid).
//
// Request body:
//   {
//     fileName:   string           (required, max MAX_GENERATE_METADATA_FILE_NAME_CHARS)
//     userPrompt: string           (optional, max MAX_GENERATE_METADATA_USER_PROMPT_CHARS)
//     platforms:  ConnectedAccountPlatform[]  (required, non-empty; see CONNECTED_ACCOUNT_PLATFORMS)
//   }
//
// Response (200):
//   ApiResponse<GeneratedMetadata> = { data: { title, description, tags } }
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { generateMetadata, OpenRouterTimeoutError, RateLimitError } from '@/lib/ai/openrouter';
import { getOpenRouterModelConfig } from '@/lib/ai/openrouter-config';
import {
  MAX_GENERATE_METADATA_FILE_NAME_CHARS,
  MAX_GENERATE_METADATA_USER_PROMPT_CHARS,
  getLimits,
  buildSystemPrompt,
  buildUserMessage,
} from '@/lib/ai/generate-metadata-helpers';
import { isConnectedAccountPlatform } from '@/lib/draft-upload-metadata';
import type { ApiResponse, ApiError, GeneratedMetadata, ConnectedAccountPlatform } from '@/types';
import { CONNECTED_ACCOUNT_PLATFORMS } from '@/types';

export { MAX_GENERATE_METADATA_FILE_NAME_CHARS, MAX_GENERATE_METADATA_USER_PROMPT_CHARS };

// ---------------------------------------------------------------------------
// POST /api/ai/generate-metadata
// ---------------------------------------------------------------------------

/**
 * Handles POST requests for this route.
 * @param req - The incoming request object.
 * @returns A response describing the request result.
 */
export async function POST(req: NextRequest) {
  // 1. Verify authentication
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  // 2. Parse request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'Invalid JSON body',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'Request body must be a JSON object',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  const { fileName, userPrompt, platforms } = body as Record<string, unknown>;

  // 3. Validate fields
  if (!fileName || typeof fileName !== 'string' || fileName.trim() === '') {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'fileName is required',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (fileName.length > MAX_GENERATE_METADATA_FILE_NAME_CHARS) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: `fileName must be at most ${MAX_GENERATE_METADATA_FILE_NAME_CHARS} characters`,
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (userPrompt !== undefined && typeof userPrompt !== 'string') {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'userPrompt must be a string',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (
    typeof userPrompt === 'string' &&
    userPrompt.length > MAX_GENERATE_METADATA_USER_PROMPT_CHARS
  ) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: `userPrompt must be at most ${MAX_GENERATE_METADATA_USER_PROMPT_CHARS} characters`,
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (
    !Array.isArray(platforms) ||
    platforms.length === 0 ||
    !platforms.every(isConnectedAccountPlatform)
  ) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: `platforms must be a non-empty array of: ${CONNECTED_ACCOUNT_PLATFORMS.join(', ')}`,
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  const typedPlatforms = platforms as ConnectedAccountPlatform[];
  const typedUserPrompt = userPrompt as string | undefined;

  // 4. Validate AI configuration and select model
  const openRouterConfig = getOpenRouterModelConfig();
  if (!openRouterConfig) {
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'AI service is not configured',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }

  // 5. Build prompts and call AI
  const { titleMax, descriptionMax } = getLimits(typedPlatforms);
  const systemPrompt = buildSystemPrompt(typedPlatforms, titleMax, descriptionMax);

  const userMessage = buildUserMessage(fileName, typedUserPrompt);

  try {
    const metadata = await generateMetadata(
      systemPrompt,
      userMessage,
      openRouterConfig.model,
      openRouterConfig.fallbackModels.length ? openRouterConfig.fallbackModels : undefined
    );

    // 6. Defense-in-depth: truncate to platform limits (Issue #39)
    const safeMetadata: GeneratedMetadata = {
      title: metadata.title.slice(0, titleMax),
      description: metadata.description.slice(0, descriptionMax),
      tags: metadata.tags,
    };

    const response: ApiResponse<GeneratedMetadata> = {
      data: safeMetadata,
      message: 'Metadata generated successfully',
    };
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    if (err instanceof RateLimitError) {
      const errRes: ApiError = {
        error: 'Too Many Requests',
        message: 'AI rate limit reached. Please wait a moment and try again.',
        statusCode: 429,
      };
      return NextResponse.json(errRes, { status: 429 });
    }

    if (err instanceof OpenRouterTimeoutError) {
      const errRes: ApiError = {
        error: 'Gateway Timeout',
        message: err.message,
        statusCode: 504,
      };
      return NextResponse.json(errRes, { status: 504 });
    }

    console.error('[POST /api/ai/generate-metadata]', err);
    const details = err instanceof Error ? err.message : String(err);
    const isDev = process.env.NODE_ENV === 'development';
    const errRes: ApiError = {
      error: 'Bad Gateway',
      message: isDev
        ? `AI service is temporarily unavailable. Please try again. ${details}`
        : 'AI service is temporarily unavailable. Please try again.',
      statusCode: 502,
    };
    return NextResponse.json(errRes, { status: 502 });
  }
}
