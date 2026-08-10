// =============================================================================
// PUT /api/translation/credentials
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedSessionUserId } from '@/lib/api/auth';
import { getUserById } from '@/lib/repositories/users';
import {
  getChannelByUserId,
  getChannelOwnerViewForUser,
  getOrCreateChannelForUser,
  getRuntimeSecretsForUser,
  setGcpServiceAccountJson,
  setGroqApiKey,
  setOpenRouterApiKey,
  updateChannelForUser,
  type LiveTranslationChannelPatch,
} from '@/lib/repositories/live-translation-channels';
import { normalizeSttProvider } from '@/lib/translation/capabilities';
import { parseGcpServiceAccountJson } from '@/lib/translation/gcp-sa';
import { validateTranslationAiConfig } from '@/lib/translation/validate-credentials';
import type { ApiError, LiveTranslationChannelOwnerView } from '@/types';

/**
 * Stores per-user OpenRouter / Groq / GCP credentials (encrypted) and model fields.
 * Creates the channel on first AI credential save after live provider validation.
 * Never returns secret plaintext.
 * @param req - Incoming request.
 * @returns Updated owner channel view.
 */
export async function PUT(req: NextRequest) {
  try {
    const userId = await getAuthenticatedSessionUserId(req);
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Not authenticated', statusCode: 401 } satisfies ApiError,
        { status: 401 }
      );
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
    const existing = await getChannelByUserId(userId);

    const isAiConfig =
      raw.openRouterApiKey !== undefined ||
      raw.groqApiKey !== undefined ||
      raw.sttProvider !== undefined ||
      raw.sttModel !== undefined ||
      raw.openRouterSttModel !== undefined ||
      raw.openRouterTranslateModel !== undefined;

    if (!existing && !isAiConfig) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'Configure speech-to-text and translation first to create a channel',
          statusCode: 400,
        } satisfies ApiError,
        { status: 400 }
      );
    }

    // Shape-check credential strings before any network validation or writes.
    if (raw.openRouterApiKey !== undefined) {
      if (typeof raw.openRouterApiKey !== 'string' || !raw.openRouterApiKey.trim()) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: 'openRouterApiKey must be a non-empty string',
            fields: ['openRouterKey'],
            statusCode: 400,
          } satisfies ApiError & { fields: string[] },
          { status: 400 }
        );
      }
    }
    if (raw.groqApiKey !== undefined) {
      if (typeof raw.groqApiKey !== 'string' || !raw.groqApiKey.trim()) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: 'groqApiKey must be a non-empty string',
            fields: ['groqKey'],
            statusCode: 400,
          } satisfies ApiError & { fields: string[] },
          { status: 400 }
        );
      }
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
    }

    if (isAiConfig) {
      const secrets = existing ? await getRuntimeSecretsForUser(userId) : null;
      const openRouterApiKey =
        typeof raw.openRouterApiKey === 'string' && raw.openRouterApiKey.trim()
          ? raw.openRouterApiKey.trim()
          : (secrets?.openRouterApiKey ?? '');
      const groqApiKey =
        typeof raw.groqApiKey === 'string' && raw.groqApiKey.trim()
          ? raw.groqApiKey.trim()
          : (secrets?.groqApiKey ?? '');

      const sttProvider = normalizeSttProvider(
        typeof raw.sttProvider === 'string'
          ? raw.sttProvider
          : (secrets?.sttProvider ?? 'openrouter')
      );

      const sttFromBody =
        typeof raw.sttModel === 'string'
          ? raw.sttModel
          : typeof raw.openRouterSttModel === 'string'
            ? raw.openRouterSttModel
            : null;
      const sttModel =
        (sttFromBody !== null ? sttFromBody.trim() : '') || secrets?.sttModel?.trim() || '';

      const translateFromBody =
        typeof raw.openRouterTranslateModel === 'string' ? raw.openRouterTranslateModel : null;
      const translateModel =
        (translateFromBody !== null ? translateFromBody.trim() : '') ||
        secrets?.openRouterTranslateModel?.trim() ||
        '';

      if (!existing && !openRouterApiKey) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: 'OpenRouter API key is required to create a translation channel',
            fields: ['openRouterKey'],
            statusCode: 400,
          } satisfies ApiError & { fields: string[] },
          { status: 400 }
        );
      }

      const validated = await validateTranslationAiConfig({
        openRouterApiKey,
        groqApiKey,
        sttProvider,
        sttModel,
        translateModel,
      });
      if (validated.ok === false) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: validated.message,
            fields: validated.fields,
            statusCode: 400,
          } satisfies ApiError & { fields: typeof validated.fields },
          { status: 400 }
        );
      }
    }

    if (!existing) {
      const user = await getUserById(userId);
      await getOrCreateChannelForUser(userId, user?.name || user?.email);
    }

    let view: LiveTranslationChannelOwnerView | null = null;

    if (raw.openRouterApiKey !== undefined) {
      view = await setOpenRouterApiKey(userId, String(raw.openRouterApiKey));
    }

    if (raw.groqApiKey !== undefined) {
      view = await setGroqApiKey(userId, String(raw.groqApiKey));
    }

    if (raw.gcpServiceAccountJson !== undefined) {
      if (typeof raw.gcpServiceAccountJson !== 'string') {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: 'gcpServiceAccountJson must be a string',
            fields: ['gcpJson'],
            statusCode: 400,
          } satisfies ApiError & { fields: string[] },
          { status: 400 }
        );
      }
      const parsed = parseGcpServiceAccountJson(raw.gcpServiceAccountJson);
      if (parsed.ok === false) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: parsed.error,
            fields: ['gcpJson'],
            statusCode: 400,
          } satisfies ApiError & { fields: string[] },
          { status: 400 }
        );
      }
      view = await setGcpServiceAccountJson(userId, raw.gcpServiceAccountJson.trim());
    }

    const modelPatch: LiveTranslationChannelPatch = {};

    if (raw.sttProvider !== undefined) {
      modelPatch.sttProvider = normalizeSttProvider(String(raw.sttProvider));
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
          modelPatch.sttModel = value;
        } else if (key === 'openRouterTranslateModel') {
          modelPatch.openRouterTranslateModel = value;
        } else {
          modelPatch.gcpTtsVoice = value;
        }
      }
    }

    if (Object.keys(modelPatch).length > 0) {
      view = await updateChannelForUser(userId, modelPatch);
    }

    view = view ?? (await getChannelOwnerViewForUser(userId));
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
    console.error('[PUT /api/translation/credentials]', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to save credentials',
        statusCode: 500,
      } satisfies ApiError,
      { status: 500 }
    );
  }
}
