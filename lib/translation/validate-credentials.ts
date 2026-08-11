// =============================================================================
// Validate live-translation AI keys + model ids against provider APIs
// =============================================================================

import type {
  LiveTranslationSttProvider,
  LiveTranslationTextTranslateProvider,
} from '@/lib/translation/capabilities';

const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';
const VALIDATE_TIMEOUT_MS = 15_000;

/** Common Cloud Speech-to-Text V1 recognition model ids. */
const GCP_STT_MODELS = new Set([
  'default',
  'latest_long',
  'latest_short',
  'command_and_search',
  'phone_call',
  'video',
  'medical_conversation',
  'medical_dictation',
]);

/**
 * Inputs used to validate AI credentials before they are persisted.
 */
export interface ValidateTranslationAiConfigInput {
  /** OpenRouter API key when STT or translate uses OpenRouter. */
  openRouterApiKey: string;
  /** Groq API key when STT or translate uses Groq. */
  groqApiKey?: string | null;
  /** Whether a GCP service account is already stored or included in this save. */
  hasGcpServiceAccount: boolean;
  /** Active STT provider. */
  sttProvider: LiveTranslationSttProvider;
  /** Active caption translation provider (explicit; no auto-fallback). */
  textTranslateProvider: LiveTranslationTextTranslateProvider;
  /** STT model id for the active provider. */
  sttModel: string;
  /** Chat model id for OpenRouter or Groq translate (unused for GCP). */
  translateModel: string;
}

/**
 * Result of pre-save AI credential validation.
 */
export type ValidateTranslationAiConfigResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
      /** Form fields that should be highlighted for this error. */
      fields: Array<'openRouterKey' | 'groqKey' | 'sttModel' | 'translateModel' | 'gcpJson'>;
    };

type OpenRouterModel = {
  id?: unknown;
  architecture?: {
    input_modalities?: unknown;
  };
};

type GroqModel = {
  id?: unknown;
};

/**
 * Builds OpenRouter app attribution headers used by other OpenRouter calls.
 * @returns Referer and title headers.
 */
function openRouterAppHeaders(): Record<string, string> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:9624';
  const appName = process.env.NEXT_PUBLIC_APP_NAME?.trim() || 'VideoSphere';
  return {
    'HTTP-Referer': appUrl,
    'X-Title': appName,
  };
}

/**
 * Fetches with a timeout abort.
 * @param url - Request URL.
 * @param init - Fetch init.
 * @returns Fetch response.
 */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Confirms an OpenRouter API key via GET /api/v1/key (models list alone is public).
 * @param apiKey - Bearer token.
 * @returns Error message when invalid; otherwise null.
 */
async function validateOpenRouterApiKey(apiKey: string): Promise<string | null> {
  let response: Response;
  try {
    response = await fetchWithTimeout(OPENROUTER_KEY_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...openRouterAppHeaders(),
      },
    });
  } catch {
    return 'Could not reach OpenRouter to validate your API key. Try again.';
  }
  if (response.status === 401 || response.status === 403) {
    return 'OpenRouter API key is invalid.';
  }
  if (!response.ok) {
    return `OpenRouter key check failed (${response.status}). Try again.`;
  }
  return null;
}

/**
 * Loads OpenRouter model catalog entries (full list when unpaginated).
 * @param apiKey - Bearer token.
 * @returns Model rows, or an error message.
 */
async function listOpenRouterModels(
  apiKey: string
): Promise<{ ok: true; models: OpenRouterModel[] } | { ok: false; message: string }> {
  let response: Response;
  try {
    response = await fetchWithTimeout(OPENROUTER_MODELS_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...openRouterAppHeaders(),
      },
    });
  } catch {
    return { ok: false, message: 'Could not reach OpenRouter to validate models. Try again.' };
  }
  if (!response.ok) {
    return {
      ok: false,
      message: `OpenRouter models check failed (${response.status}). Try again.`,
    };
  }
  const json = (await response.json()) as { data?: unknown };
  const models = Array.isArray(json.data) ? (json.data as OpenRouterModel[]) : [];
  return { ok: true, models };
}

/**
 * Finds a model by exact id in an OpenRouter catalog list.
 * @param models - Catalog rows.
 * @param modelId - Requested model id.
 * @returns Matching row, or undefined.
 */
function findOpenRouterModel(
  models: OpenRouterModel[],
  modelId: string
): OpenRouterModel | undefined {
  return models.find((m) => typeof m.id === 'string' && m.id === modelId);
}

/**
 * Returns whether a model advertises audio input (STT-capable).
 * @param model - OpenRouter model row.
 * @returns True when audio is listed, or when modality metadata is absent (unknown).
 */
function openRouterModelAcceptsAudio(model: OpenRouterModel): boolean {
  const modalities = model.architecture?.input_modalities;
  if (!Array.isArray(modalities) || modalities.length === 0) {
    return true;
  }
  return modalities.some((m) => typeof m === 'string' && m.toLowerCase() === 'audio');
}

/**
 * Lists Groq models available to an API key.
 * @param apiKey - Groq API key.
 * @returns Model rows, or an error message.
 */
async function listGroqModels(
  apiKey: string
): Promise<{ ok: true; models: GroqModel[] } | { ok: false; message: string }> {
  let response: Response;
  try {
    response = await fetchWithTimeout(GROQ_MODELS_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  } catch {
    return { ok: false, message: 'Could not reach Groq to validate your API key. Try again.' };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: 'Groq API key is invalid.' };
  }
  if (!response.ok) {
    return { ok: false, message: `Groq key check failed (${response.status}). Try again.` };
  }
  const json = (await response.json()) as { data?: unknown };
  const models = Array.isArray(json.data) ? (json.data as GroqModel[]) : [];
  return { ok: true, models };
}

/**
 * Validates STT + translate credentials against live provider APIs.
 * Call before persisting AI settings so misconfiguration fails in the settings UI.
 * @param input - Effective keys, providers, and model ids to validate.
 * @returns Success, or a user-facing error message.
 */
export async function validateTranslationAiConfig(
  input: ValidateTranslationAiConfigInput
): Promise<ValidateTranslationAiConfigResult> {
  const openRouterApiKey = input.openRouterApiKey.trim();
  const sttModel = input.sttModel.trim();
  const translateModel = input.translateModel.trim();
  const groqApiKey = input.groqApiKey?.trim() || '';
  const needsOpenRouterStt = input.sttProvider === 'openrouter';
  const needsOpenRouterTranslate = input.textTranslateProvider === 'openrouter';
  const needsGroqStt = input.sttProvider === 'groq';
  const needsGroqTranslate = input.textTranslateProvider === 'groq';
  const needsGcp = input.sttProvider === 'gcp' || input.textTranslateProvider === 'gcp';

  if (!sttModel) {
    return { ok: false, message: 'STT model id is required.', fields: ['sttModel'] };
  }

  if (needsGcp && !input.hasGcpServiceAccount) {
    return {
      ok: false,
      message:
        'A Google Cloud service account is required when STT or translation uses Google Cloud. ' +
        'Paste the JSON here or save it under Google Cloud TTS first.',
      fields: ['gcpJson'],
    };
  }

  if (input.sttProvider === 'gcp' && !GCP_STT_MODELS.has(sttModel)) {
    return {
      ok: false,
      message: `Unknown GCP Speech-to-Text model "${sttModel}". Try latest_long or latest_short.`,
      fields: ['sttModel'],
    };
  }

  if ((needsOpenRouterTranslate || needsGroqTranslate) && !translateModel) {
    return {
      ok: false,
      message: 'Translation model id is required for OpenRouter or Groq caption translation.',
      fields: ['translateModel'],
    };
  }

  if ((needsOpenRouterStt || needsOpenRouterTranslate) && !openRouterApiKey) {
    return {
      ok: false,
      message: needsOpenRouterStt
        ? 'OpenRouter API key is required for OpenRouter STT.'
        : 'OpenRouter API key is required for OpenRouter translation.',
      fields: ['openRouterKey'],
    };
  }

  if ((needsGroqStt || needsGroqTranslate) && !groqApiKey) {
    return {
      ok: false,
      message: needsGroqStt
        ? 'Groq API key is required when STT provider is Groq.'
        : 'Groq API key is required when translation provider is Groq.',
      fields: ['groqKey'],
    };
  }

  if (needsOpenRouterStt || needsOpenRouterTranslate) {
    const keyError = await validateOpenRouterApiKey(openRouterApiKey);
    if (keyError) {
      return { ok: false, message: keyError, fields: ['openRouterKey'] };
    }

    const catalog = await listOpenRouterModels(openRouterApiKey);
    if (catalog.ok === false) {
      return { ok: false, message: catalog.message, fields: ['openRouterKey'] };
    }

    if (needsOpenRouterTranslate) {
      const translate = findOpenRouterModel(catalog.models, translateModel);
      if (!translate) {
        return {
          ok: false,
          message: `OpenRouter translation model "${translateModel}" was not found.`,
          fields: ['translateModel'],
        };
      }
    }

    if (needsOpenRouterStt) {
      const stt = findOpenRouterModel(catalog.models, sttModel);
      if (!stt) {
        return {
          ok: false,
          message: `OpenRouter STT model "${sttModel}" was not found.`,
          fields: ['sttModel'],
        };
      }
      if (!openRouterModelAcceptsAudio(stt)) {
        return {
          ok: false,
          message: `OpenRouter model "${sttModel}" does not accept audio input (not usable for STT).`,
          fields: ['sttModel'],
        };
      }
    }
  }

  if (needsGroqStt || needsGroqTranslate) {
    const catalog = await listGroqModels(groqApiKey);
    if (catalog.ok === false) {
      return { ok: false, message: catalog.message, fields: ['groqKey'] };
    }

    if (needsGroqStt) {
      const found = catalog.models.some((m) => typeof m.id === 'string' && m.id === sttModel);
      if (!found) {
        return {
          ok: false,
          message: `Groq STT model "${sttModel}" was not found for this API key.`,
          fields: ['sttModel'],
        };
      }
    }

    if (needsGroqTranslate) {
      const found = catalog.models.some((m) => typeof m.id === 'string' && m.id === translateModel);
      if (!found) {
        return {
          ok: false,
          message: `Groq translation model "${translateModel}" was not found for this API key.`,
          fields: ['translateModel'],
        };
      }
      if (/whisper/i.test(translateModel)) {
        return {
          ok: false,
          message: 'Pick a Groq chat model for translation (not a Whisper STT model).',
          fields: ['translateModel'],
        };
      }
    }
  }

  return { ok: true };
}
