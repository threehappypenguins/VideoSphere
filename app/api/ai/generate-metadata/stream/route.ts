// =============================================================================
// POST /api/ai/generate-metadata/stream
// =============================================================================
// Streaming variant of the AI metadata endpoint.  Returns an SSE
// (text/event-stream) response by forwarding OpenRouter's native streaming
// chunks directly to the client.
//
// The client accumulates token deltas until it receives `data: [DONE]`, then
// parses the assembled JSON string to obtain { title, description, tags }.
//
// Auth: requires a valid Appwrite session cookie (401 if missing/invalid).
//
// Request body: identical to POST /api/ai/generate-metadata
//   {
//     fileName:   string
//     userPrompt: string (optional)
//     platforms:  ConnectedAccountPlatform[]
//   }
//
// Response (200): text/event-stream — OpenRouter SSE chunks piped through
// Response (4xx/5xx): standard ApiError JSON for pre-stream failures
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUserById } from '@/lib/repositories';
import { streamMetadata, RateLimitError } from '@/lib/ai/openrouter';
import {
  MAX_GENERATE_METADATA_FILE_NAME_CHARS,
  MAX_GENERATE_METADATA_USER_PROMPT_CHARS,
  getLimits,
  buildSystemPrompt,
  buildUserMessage,
} from '@/lib/ai/generate-metadata-helpers';
import { isConnectedAccountPlatform } from '@/lib/draft-upload-metadata';
import type { ApiError, ConnectedAccountPlatform } from '@/types';
import { CONNECTED_ACCOUNT_PLATFORMS } from '@/types';

// Allow the stream to stay open long enough for a slow model's first token.
export const maxDuration = 60;

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

  // 4. Determine user tier and select model
  const user = await getUserById(userId);
  if (!user) {
    const errRes: ApiError = {
      error: 'Not Found',
      message: 'User not found',
      statusCode: 404,
    };
    return NextResponse.json(errRes, { status: 404 });
  }

  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  const freeModel = process.env.OPENROUTER_FREE_MODEL;
  const premiumModel = process.env.OPENROUTER_PREMIUM_MODEL;

  if (!openRouterApiKey?.trim() || !freeModel || !premiumModel) {
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'AI service is not configured',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }

  const isAdmin = user.role === 'admin';
  const model = user.isSupporter || isAdmin ? premiumModel : freeModel;

  // 5. Build prompts
  const { titleMax, descriptionMax } = getLimits(typedPlatforms);
  const systemPrompt = buildSystemPrompt(typedPlatforms, titleMax, descriptionMax);
  const userMessage = buildUserMessage(fileName, typedUserPrompt);

  // 6. Open a streaming request to OpenRouter and pipe it to the client.
  //    Pass req.signal so the upstream fetch is aborted if the client disconnects.
  try {
    const openrouterResponse = await streamMetadata(systemPrompt, userMessage, model, req.signal);

    if (!openrouterResponse.body) {
      const errRes: ApiError = {
        error: 'Bad Gateway',
        message: 'AI service returned an empty response. Please try again.',
        statusCode: 502,
      };
      return NextResponse.json(errRes, { status: 502 });
    }

    return new Response(openrouterResponse.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    // Client disconnect — nothing to send
    if ((err instanceof DOMException || err instanceof Error) && err.name === 'AbortError') {
      return new Response(null, { status: 499 });
    }

    if (err instanceof RateLimitError) {
      const errRes: ApiError = {
        error: 'Too Many Requests',
        message: 'AI rate limit reached. Please wait a moment and try again.',
        statusCode: 429,
      };
      return NextResponse.json(errRes, { status: 429 });
    }

    console.error('[POST /api/ai/generate-metadata/stream]', err);
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
