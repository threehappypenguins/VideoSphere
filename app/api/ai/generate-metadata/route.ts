// =============================================================================
// POST /api/ai/generate-metadata
// =============================================================================
// Accepts a video fileName, optional userPrompt, and platforms array.
// Verifies the session, checks the user's tier (free vs. supporter), selects
// the appropriate OpenRouter model, and returns AI-generated title, description,
// and tags for the video.
//
// Auth: requires a valid Appwrite session cookie (401 if missing/invalid).
//
// Request body:
//   {
//     fileName:   string           (required, max MAX_GENERATE_METADATA_FILE_NAME_CHARS)
//     userPrompt: string           (optional, max MAX_GENERATE_METADATA_USER_PROMPT_CHARS)
//     platforms:  ('youtube' | 'vimeo')[]  (required, non-empty)
//   }
//
// Response (200):
//   ApiResponse<GeneratedMetadata> = { data: { title, description, tags } }
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUserById } from '@/lib/repositories';
import { generateMetadata, OpenRouterTimeoutError, RateLimitError } from '@/lib/ai/openrouter';
import type { ApiResponse, ApiError, GeneratedMetadata, ConnectedAccountPlatform } from '@/types';
import { CONNECTED_ACCOUNT_PLATFORMS } from '@/types';

/** Max `fileName` length (raw string) before calling the LLM — caps tokens and latency. */
export const MAX_GENERATE_METADATA_FILE_NAME_CHARS = 512;

/** Max optional `userPrompt` length (raw string) before calling the LLM. */
export const MAX_GENERATE_METADATA_USER_PROMPT_CHARS = 4000;

// ---------------------------------------------------------------------------
// Platform character limits (PRD AI-06)
// ---------------------------------------------------------------------------
const PLATFORM_LIMITS: Record<
  ConnectedAccountPlatform,
  { titleMax: number; descriptionMax: number }
> = {
  youtube: { titleMax: 100, descriptionMax: 5000 },
  vimeo: { titleMax: 128, descriptionMax: 5000 },
};

/** Derive the most restrictive limits across the requested platforms. */
function getLimits(platforms: ConnectedAccountPlatform[]): {
  titleMax: number;
  descriptionMax: number;
} {
  return platforms.reduce(
    (acc, platform) => {
      const limits = PLATFORM_LIMITS[platform];
      return {
        titleMax: Math.min(acc.titleMax, limits.titleMax),
        descriptionMax: Math.min(acc.descriptionMax, limits.descriptionMax),
      };
    },
    { titleMax: Infinity, descriptionMax: Infinity }
  );
}

/** Build the system prompt with platform-specific limits and SEO guidance. */
function buildSystemPrompt(
  platforms: ConnectedAccountPlatform[],
  titleMax: number,
  descriptionMax: number
): string {
  const platformList = platforms.join(' and ');
  const platformDetails = platforms
    .map((p) => {
      const l = PLATFORM_LIMITS[p];
      return `- ${p.charAt(0).toUpperCase() + p.slice(1)}: title max ${l.titleMax} chars, description max ${l.descriptionMax} chars`;
    })
    .join('\n');

  return `You are a video SEO expert helping creators write metadata for ${platformList} videos.

Return ONLY a JSON object with exactly these three keys:
  "title"       — string, max ${titleMax} characters
  "description" — string, max ${descriptionMax} characters
  "tags"        — array of 5 to 10 relevant keyword strings

Platform character limits:
${platformDetails}

SEO best practices to follow:
- Place the most important keyword near the start of the title
- Write a description that naturally incorporates relevant keywords in the first 2 sentences (shown before "show more")
- Use specific, searchable tags (mix of broad and niche keywords)
- Keep the tone engaging and informative; avoid keyword stuffing
- Do NOT include hashtags in the description or title
- Respond with ONLY the JSON object — no markdown, no prose, no code fences`;
}

// ---------------------------------------------------------------------------
// POST /api/ai/generate-metadata
// ---------------------------------------------------------------------------

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
    !platforms.every((p) => CONNECTED_ACCOUNT_PLATFORMS.includes(p as ConnectedAccountPlatform))
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

  const freeModel = process.env.OPENROUTER_FREE_MODEL;
  const premiumModel = process.env.OPENROUTER_PREMIUM_MODEL;

  if (!freeModel || !premiumModel) {
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'AI service is not configured',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }

  const model = user.isSupporter ? premiumModel : freeModel;

  // 5. Build prompts and call AI
  const { titleMax, descriptionMax } = getLimits(typedPlatforms);
  const systemPrompt = buildSystemPrompt(typedPlatforms, titleMax, descriptionMax);

  const userMessage = [
    `Video filename: ${fileName.trim()}`,
    typedUserPrompt?.trim() ? `Additional context: ${typedUserPrompt.trim()}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const metadata = await generateMetadata(systemPrompt, userMessage, model);

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
    const errRes: ApiError = {
      error: 'Bad Gateway',
      message: 'AI service is temporarily unavailable. Please try again.',
      statusCode: 502,
    };
    return NextResponse.json(errRes, { status: 502 });
  }
}
