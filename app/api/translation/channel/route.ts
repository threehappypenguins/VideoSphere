// =============================================================================
// GET /api/translation/channel
// PATCH /api/translation/channel
// DELETE /api/translation/channel
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedSessionUserId } from '@/lib/api/auth';
import {
  deleteChannelForUser,
  getChannelOwnerViewForUser,
  updateChannelForUser,
  type LiveTranslationChannelPatch,
} from '@/lib/repositories/live-translation-channels';
import { normalizeSttProvider } from '@/lib/translation/capabilities';
import {
  getTranslationSlugValidationError,
  normalizeTranslationSlug,
} from '@/lib/translation/slug';
import { disposeChannelSession } from '@/lib/translation/session-hub';
import type { ApiError } from '@/types';

/**
 * Returns the authenticated user's live translation channel when one exists.
 * Does not create a channel — that happens when AI credentials are saved.
 * @param req - Incoming request.
 * @returns Owner channel view, or 404 when not configured yet.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await getAuthenticatedSessionUserId(req);
    if (!userId) {
      const err: ApiError = {
        error: 'Unauthorized',
        message: 'Not authenticated',
        statusCode: 401,
      };
      return NextResponse.json(err, { status: 401 });
    }

    const view = await getChannelOwnerViewForUser(userId);
    if (!view) {
      return NextResponse.json(
        {
          error: 'Not Found',
          message: 'Translation channel not configured',
          statusCode: 404,
        } satisfies ApiError,
        { status: 404 }
      );
    }
    return NextResponse.json(view);
  } catch (error) {
    console.error('[GET /api/translation/channel]', error);
    const err: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load translation channel',
      statusCode: 500,
    };
    return NextResponse.json(err, { status: 500 });
  }
}

/**
 * Updates slug, languages, models/voice, and public-page flags for the owner.
 * Requires an existing channel (created by saving AI credentials).
 * @param req - Incoming request with JSON body.
 * @returns Updated owner channel view.
 */
export async function PATCH(req: NextRequest) {
  try {
    const userId = await getAuthenticatedSessionUserId(req);
    if (!userId) {
      const err: ApiError = {
        error: 'Unauthorized',
        message: 'Not authenticated',
        statusCode: 401,
      };
      return NextResponse.json(err, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Invalid JSON body', statusCode: 400 } satisfies ApiError,
        { status: 400 }
      );
    }

    if (body === null || typeof body !== 'object') {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'Body must be a JSON object',
          statusCode: 400,
        } satisfies ApiError,
        { status: 400 }
      );
    }

    const raw = body as Record<string, unknown>;
    const patch: LiveTranslationChannelPatch = {};

    if (raw.slug !== undefined) {
      if (typeof raw.slug !== 'string') {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: 'slug must be a string',
            statusCode: 400,
          } satisfies ApiError,
          { status: 400 }
        );
      }
      const slug = normalizeTranslationSlug(raw.slug);
      const slugError = getTranslationSlugValidationError(slug);
      if (slugError) {
        return NextResponse.json(
          { error: 'Bad Request', message: slugError, statusCode: 400 } satisfies ApiError,
          { status: 400 }
        );
      }
      patch.slug = slug;
    }

    if (raw.publicEnabled !== undefined) {
      if (typeof raw.publicEnabled !== 'boolean') {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: 'publicEnabled must be a boolean',
            statusCode: 400,
          } satisfies ApiError,
          { status: 400 }
        );
      }
      patch.publicEnabled = raw.publicEnabled;
    }

    if (raw.sourceLanguage !== undefined) {
      if (typeof raw.sourceLanguage !== 'string' || !raw.sourceLanguage.trim()) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: 'sourceLanguage must be a non-empty string',
            statusCode: 400,
          } satisfies ApiError,
          { status: 400 }
        );
      }
      patch.sourceLanguage = raw.sourceLanguage.trim();
    }

    if (raw.enabledLanguages !== undefined) {
      if (
        !Array.isArray(raw.enabledLanguages) ||
        !raw.enabledLanguages.every((v) => typeof v === 'string' && v.trim())
      ) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: 'enabledLanguages must be an array of non-empty strings',
            statusCode: 400,
          } satisfies ApiError,
          { status: 400 }
        );
      }
      patch.enabledLanguages = [...new Set(raw.enabledLanguages.map((v) => String(v).trim()))];
    }

    if (raw.sttProvider !== undefined) {
      if (raw.sttProvider !== 'openrouter' && raw.sttProvider !== 'groq') {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: 'sttProvider must be openrouter or groq',
            statusCode: 400,
          } satisfies ApiError,
          { status: 400 }
        );
      }
      patch.sttProvider = normalizeSttProvider(raw.sttProvider);
    }

    for (const key of ['sttModel', 'openRouterSttModel', 'openRouterTranslateModel', 'gcpTtsVoice'] as const) {
      if (raw[key] !== undefined) {
        if (raw[key] !== null && typeof raw[key] !== 'string') {
          return NextResponse.json(
            {
              error: 'Bad Request',
              message: `${key} must be a string or null`,
              statusCode: 400,
            } satisfies ApiError,
            { status: 400 }
          );
        }
        const value = raw[key] === null ? null : String(raw[key]).trim() || null;
        if (key === 'sttModel' || key === 'openRouterSttModel') {
          patch.sttModel = value;
        } else if (key === 'openRouterTranslateModel') {
          patch.openRouterTranslateModel = value;
        } else {
          patch.gcpTtsVoice = value;
        }
      }
    }

    try {
      const view = await updateChannelForUser(userId, patch);
      if (!view) {
        return NextResponse.json(
          {
            error: 'Not Found',
            message: 'Translation channel not found. Configure AI first.',
            statusCode: 404,
          } satisfies ApiError,
          { status: 404 }
        );
      }
      return NextResponse.json(view);
    } catch (error) {
      if (error instanceof Error && error.message === 'SLUG_TAKEN') {
        return NextResponse.json(
          {
            error: 'Conflict',
            message: 'That public slug is already taken',
            statusCode: 409,
          } satisfies ApiError,
          { status: 409 }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error('[PATCH /api/translation/channel]', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to update translation channel',
        statusCode: 500,
      } satisfies ApiError,
      { status: 500 }
    );
  }
}

/**
 * Deletes the owner's translation channel, credentials, and public slug.
 * @param req - Incoming request.
 * @returns Confirmation payload when deleted.
 */
export async function DELETE(req: NextRequest) {
  try {
    const userId = await getAuthenticatedSessionUserId(req);
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Not authenticated', statusCode: 401 } satisfies ApiError,
        { status: 401 }
      );
    }

    const channelId = await deleteChannelForUser(userId);
    if (!channelId) {
      return NextResponse.json(
        {
          error: 'Not Found',
          message: 'Translation channel not found',
          statusCode: 404,
        } satisfies ApiError,
        { status: 404 }
      );
    }

    disposeChannelSession(channelId);
    return NextResponse.json({ deleted: true, channelId });
  } catch (error) {
    console.error('[DELETE /api/translation/channel]', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to delete translation channel',
        statusCode: 500,
      } satisfies ApiError,
      { status: 500 }
    );
  }
}
