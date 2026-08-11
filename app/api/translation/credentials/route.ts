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
  setStreamingAsrApiKey,
  updateChannelForUser,
  type LiveTranslationChannelPatch,
} from '@/lib/repositories/live-translation-channels';
import {
  isStreamingSttProvider,
  normalizeSttProvider,
  normalizeTextTranslateProvider,
  sttProvidesBuiltInTranslation,
} from '@/lib/translation/capabilities';
import { languagesForTtsConfig, normalizeGcpTtsVoices } from '@/lib/translation/gcp-tts-voices';
import { parseGcpServiceAccountJson } from '@/lib/translation/gcp-sa';
import { validateTranslationAiConfig } from '@/lib/translation/validate-credentials';
import { validateGcpTtsConfig } from '@/lib/translation/validate-gcp-tts';
import type { ApiError, LiveTranslationChannelOwnerView } from '@/types';

const STREAMING_KEY_FIELDS = [
  'deepgramApiKey',
  'assemblyaiApiKey',
  'gladiaApiKey',
  'speechmaticsApiKey',
  'sonioxApiKey',
] as const;

/**
 * Stores per-user AI credentials (encrypted) and model fields.
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
      STREAMING_KEY_FIELDS.some((k) => raw[k] !== undefined) ||
      raw.sttProvider !== undefined ||
      raw.textTranslateProvider !== undefined ||
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

    const requireNonEmptyString = (field: string, formField: string): NextResponse | null => {
      if (raw[field] === undefined) return null;
      if (typeof raw[field] !== 'string' || !String(raw[field]).trim()) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: `${field} must be a non-empty string`,
            fields: [formField],
            statusCode: 400,
          } satisfies ApiError & { fields: string[] },
          { status: 400 }
        );
      }
      return null;
    };

    for (const [field, formField] of [
      ['openRouterApiKey', 'openRouterKey'],
      ['groqApiKey', 'groqKey'],
      ['deepgramApiKey', 'deepgramKey'],
      ['assemblyaiApiKey', 'assemblyaiKey'],
      ['gladiaApiKey', 'gladiaKey'],
      ['speechmaticsApiKey', 'speechmaticsKey'],
      ['sonioxApiKey', 'sonioxKey'],
    ] as const) {
      const bad = requireNonEmptyString(field, formField);
      if (bad) return bad;
    }

    if (raw.sttProvider !== undefined) {
      if (!normalizeSttProvider(typeof raw.sttProvider === 'string' ? raw.sttProvider : null)) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message:
              'sttProvider must be deepgram, assemblyai, gladia, speechmatics, soniox, or groq',
            statusCode: 400,
          } satisfies ApiError,
          { status: 400 }
        );
      }
    }
    if (raw.textTranslateProvider !== undefined && raw.textTranslateProvider !== null) {
      if (
        raw.textTranslateProvider !== 'openrouter' &&
        raw.textTranslateProvider !== 'groq' &&
        raw.textTranslateProvider !== 'gcp'
      ) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: 'textTranslateProvider must be openrouter, groq, or gcp',
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
      const deepgramApiKey =
        typeof raw.deepgramApiKey === 'string' && raw.deepgramApiKey.trim()
          ? raw.deepgramApiKey.trim()
          : (secrets?.deepgramApiKey ?? '');
      const assemblyaiApiKey =
        typeof raw.assemblyaiApiKey === 'string' && raw.assemblyaiApiKey.trim()
          ? raw.assemblyaiApiKey.trim()
          : (secrets?.assemblyaiApiKey ?? '');
      const gladiaApiKey =
        typeof raw.gladiaApiKey === 'string' && raw.gladiaApiKey.trim()
          ? raw.gladiaApiKey.trim()
          : (secrets?.gladiaApiKey ?? '');
      const speechmaticsApiKey =
        typeof raw.speechmaticsApiKey === 'string' && raw.speechmaticsApiKey.trim()
          ? raw.speechmaticsApiKey.trim()
          : (secrets?.speechmaticsApiKey ?? '');
      const sonioxApiKey =
        typeof raw.sonioxApiKey === 'string' && raw.sonioxApiKey.trim()
          ? raw.sonioxApiKey.trim()
          : (secrets?.sonioxApiKey ?? '');

      const gcpJsonFromBody =
        typeof raw.gcpServiceAccountJson === 'string' ? raw.gcpServiceAccountJson.trim() : '';
      const hasGcpServiceAccount = Boolean(
        gcpJsonFromBody || secrets?.gcpServiceAccountJson?.trim()
      );

      const sttProvider = normalizeSttProvider(
        typeof raw.sttProvider === 'string' ? raw.sttProvider : (secrets?.sttProvider ?? null)
      );

      if (!sttProvider) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: 'Select an STT provider.',
            fields: ['sttProvider'],
            statusCode: 400,
          } satisfies ApiError & { fields: string[] },
          { status: 400 }
        );
      }

      const textTranslateProvider = sttProvidesBuiltInTranslation(sttProvider)
        ? null
        : normalizeTextTranslateProvider(
            typeof raw.textTranslateProvider === 'string'
              ? raw.textTranslateProvider
              : (secrets?.textTranslateProvider ?? null)
          );

      if (!sttProvidesBuiltInTranslation(sttProvider) && !textTranslateProvider) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: 'Select a caption translation provider.',
            fields: ['textTranslateProvider'],
            statusCode: 400,
          } satisfies ApiError & { fields: string[] },
          { status: 400 }
        );
      }

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

      const hasAnyStreamingKey =
        Boolean(deepgramApiKey) ||
        Boolean(assemblyaiApiKey) ||
        Boolean(gladiaApiKey) ||
        Boolean(speechmaticsApiKey) ||
        Boolean(sonioxApiKey);

      if (
        !existing &&
        !openRouterApiKey &&
        !groqApiKey &&
        !hasAnyStreamingKey &&
        !(textTranslateProvider === 'gcp' && hasGcpServiceAccount)
      ) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message:
              'Add an API key for your selected STT provider to create a translation channel.',
            fields: ['sttProvider'],
            statusCode: 400,
          } satisfies ApiError & { fields: string[] },
          { status: 400 }
        );
      }

      const validated = await validateTranslationAiConfig({
        openRouterApiKey,
        groqApiKey,
        deepgramApiKey,
        assemblyaiApiKey,
        gladiaApiKey,
        speechmaticsApiKey,
        sonioxApiKey,
        hasGcpServiceAccount,
        sttProvider,
        textTranslateProvider,
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

    const updatingGcpJson = raw.gcpServiceAccountJson !== undefined;
    const updatingGcpVoices = raw.gcpTtsVoices !== undefined;

    if (updatingGcpJson || updatingGcpVoices) {
      if (updatingGcpJson && typeof raw.gcpServiceAccountJson !== 'string') {
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

      const secrets = existing ? await getRuntimeSecretsForUser(userId) : null;
      const serviceAccountJson =
        updatingGcpJson && typeof raw.gcpServiceAccountJson === 'string'
          ? raw.gcpServiceAccountJson.trim()
          : (secrets?.gcpServiceAccountJson?.trim() ?? '');

      if (!serviceAccountJson) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: 'Google Cloud service account JSON is required.',
            fields: ['gcpJson'],
            statusCode: 400,
          } satisfies ApiError & { fields: string[] },
          { status: 400 }
        );
      }

      const parsed = parseGcpServiceAccountJson(serviceAccountJson);
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

      const voices = updatingGcpVoices
        ? normalizeGcpTtsVoices(raw.gcpTtsVoices)
        : normalizeGcpTtsVoices(secrets?.gcpTtsVoices);

      const shouldValidateTts = updatingGcpVoices || Object.keys(voices).length > 0;
      if (shouldValidateTts) {
        const channelForLangs = existing ?? (await getChannelByUserId(userId));
        const sourceLanguage = channelForLangs?.sourceLanguage || 'en';
        const enabledLanguages = [...(channelForLangs?.enabledLanguages ?? [])];
        if (enabledLanguages.length === 0) {
          return NextResponse.json(
            {
              error: 'Bad Request',
              message: 'Configure at least one listen language before saving Google Cloud TTS.',
              statusCode: 400,
            } satisfies ApiError,
            { status: 400 }
          );
        }

        if (updatingGcpVoices && Object.keys(voices).length === 0) {
          return NextResponse.json(
            {
              error: 'Bad Request',
              message: 'Choose a TTS voice for at least one language.',
              fields: ['ttsVoice'],
              statusCode: 400,
            } satisfies ApiError & { fields: string[] },
            { status: 400 }
          );
        }

        const allowed = new Set(languagesForTtsConfig(sourceLanguage, enabledLanguages));
        for (const lang of Object.keys(voices)) {
          if (!allowed.has(lang)) {
            return NextResponse.json(
              {
                error: 'Bad Request',
                message: `Language "${lang}" is not in your configured languages.`,
                fields: ['ttsVoice'],
                statusCode: 400,
              } satisfies ApiError & { fields: string[] },
              { status: 400 }
            );
          }
        }

        const validated = await validateGcpTtsConfig({
          serviceAccountJson,
          voices,
        });
        if (validated.ok === false) {
          return NextResponse.json(
            {
              error: 'Bad Request',
              message: validated.message,
              fields: validated.fields,
              language: validated.language,
              statusCode: 400,
            } satisfies ApiError & { fields: typeof validated.fields; language?: string },
            { status: 400 }
          );
        }
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
    if (raw.deepgramApiKey !== undefined) {
      view = await setStreamingAsrApiKey(userId, 'deepgram', String(raw.deepgramApiKey));
    }
    if (raw.assemblyaiApiKey !== undefined) {
      view = await setStreamingAsrApiKey(userId, 'assemblyai', String(raw.assemblyaiApiKey));
    }
    if (raw.gladiaApiKey !== undefined) {
      view = await setStreamingAsrApiKey(userId, 'gladia', String(raw.gladiaApiKey));
    }
    if (raw.speechmaticsApiKey !== undefined) {
      view = await setStreamingAsrApiKey(userId, 'speechmatics', String(raw.speechmaticsApiKey));
    }
    if (raw.sonioxApiKey !== undefined) {
      view = await setStreamingAsrApiKey(userId, 'soniox', String(raw.sonioxApiKey));
    }
    if (raw.gcpServiceAccountJson !== undefined) {
      view = await setGcpServiceAccountJson(userId, String(raw.gcpServiceAccountJson).trim());
    }

    const modelPatch: LiveTranslationChannelPatch = {};

    if (raw.sttProvider !== undefined) {
      const sttProvider = normalizeSttProvider(String(raw.sttProvider));
      if (!sttProvider) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message:
              'sttProvider must be deepgram, assemblyai, gladia, speechmatics, soniox, or groq',
            statusCode: 400,
          } satisfies ApiError,
          { status: 400 }
        );
      }
      modelPatch.sttProvider = sttProvider;
      if (sttProvidesBuiltInTranslation(sttProvider)) {
        // Clear unused MT provider when switching to Soniox.
        modelPatch.textTranslateProvider = undefined;
      }
    }

    if (raw.textTranslateProvider !== undefined && raw.textTranslateProvider !== null) {
      const textTranslateProvider = normalizeTextTranslateProvider(
        String(raw.textTranslateProvider)
      );
      if (!textTranslateProvider) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: 'textTranslateProvider must be openrouter, groq, or gcp',
            statusCode: 400,
          } satisfies ApiError,
          { status: 400 }
        );
      }
      modelPatch.textTranslateProvider = textTranslateProvider;
    }

    for (const key of ['sttModel', 'openRouterSttModel', 'openRouterTranslateModel'] as const) {
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
        } else {
          modelPatch.openRouterTranslateModel = value;
        }
      }
    }

    if (raw.gcpTtsVoices !== undefined) {
      modelPatch.gcpTtsVoices = normalizeGcpTtsVoices(raw.gcpTtsVoices);
    }

    // When selecting a streaming STT provider, Groq model is optional — clear empty.
    if (
      modelPatch.sttProvider &&
      isStreamingSttProvider(modelPatch.sttProvider) &&
      modelPatch.sttModel === undefined
    ) {
      // leave existing model stored; unused at runtime
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
