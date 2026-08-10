// =============================================================================
// Validate live-translation AI keys + model ids against provider APIs
// =============================================================================

import type { LiveTranslationSttProvider } from '@/lib/translation/capabilities';

const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';
const VALIDATE_TIMEOUT_MS = 15_000;

/**
 * Inputs used to validate AI credentials before they are persisted.
 */
export interface ValidateTranslationAiConfigInput {
  /** OpenRouter API key (required for translation). */
  openRouterApiKey: string;
  /** Groq API key when STT provider is Groq. */
  groqApiKey?: string | null;
  /** Active STT provider. */
  sttProvider: LiveTranslationSttProvider;
  /** STT model id for the active provider. */
  sttModel: string;
  /** OpenRouter chat model id used for translation. */
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
      fields: Array<'openRouterKey' | 'groqKey' | 'sttModel' | 'translateModel'>;
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
    // Some rows omit architecture; do not block solely on missing metadata.
    return true;
  }
  return modalities.some((m) => typeof m === 'string' && m.toLowerCase() === 'audio');
}

/**
 * Validates a Groq API key and that the STT model id is available to that key.
 * @param apiKey - Groq API key.
 * @param sttModel - Whisper (or other) model id.
 * @returns Error message when invalid; otherwise null.
 */
async function validateGroqStt(apiKey: string, sttModel: string): Promise<string | null> {
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
    return 'Could not reach Groq to validate your API key. Try again.';
  }
  if (response.status === 401 || response.status === 403) {
    return 'Groq API key is invalid.';
  }
  if (!response.ok) {
    return `Groq key check failed (${response.status}). Try again.`;
  }
  const json = (await response.json()) as { data?: unknown };
  const models = Array.isArray(json.data) ? (json.data as GroqModel[]) : [];
  const found = models.some((m) => typeof m.id === 'string' && m.id === sttModel);
  if (!found) {
    return `Groq STT model "${sttModel}" was not found for this API key.`;
  }
  return null;
}

/**
 * Validates OpenRouter + optional Groq credentials and model ids against live provider APIs.
 * Call before persisting AI settings so misconfiguration fails in the settings UI.
 * @param input - Effective keys, provider, and model ids to validate.
 * @returns Success, or a user-facing error message.
 */
export async function validateTranslationAiConfig(
  input: ValidateTranslationAiConfigInput
): Promise<ValidateTranslationAiConfigResult> {
  const openRouterApiKey = input.openRouterApiKey.trim();
  const sttModel = input.sttModel.trim();
  const translateModel = input.translateModel.trim();
  const groqApiKey = input.groqApiKey?.trim() || '';

  if (!openRouterApiKey) {
    return {
      ok: false,
      message: 'OpenRouter API key is required.',
      fields: ['openRouterKey'],
    };
  }
  if (!sttModel) {
    return { ok: false, message: 'STT model id is required.', fields: ['sttModel'] };
  }
  if (!translateModel) {
    return {
      ok: false,
      message: 'Translation model id is required.',
      fields: ['translateModel'],
    };
  }
  if (input.sttProvider === 'groq' && !groqApiKey) {
    return {
      ok: false,
      message: 'Groq API key is required when STT provider is Groq.',
      fields: ['groqKey'],
    };
  }

  const keyError = await validateOpenRouterApiKey(openRouterApiKey);
  if (keyError) {
    return { ok: false, message: keyError, fields: ['openRouterKey'] };
  }

  const catalog = await listOpenRouterModels(openRouterApiKey);
  if (catalog.ok === false) {
    return { ok: false, message: catalog.message, fields: ['openRouterKey'] };
  }

  const translate = findOpenRouterModel(catalog.models, translateModel);
  if (!translate) {
    return {
      ok: false,
      message: `OpenRouter translation model "${translateModel}" was not found.`,
      fields: ['translateModel'],
    };
  }

  if (input.sttProvider === 'openrouter') {
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
  } else {
    const groqError = await validateGroqStt(groqApiKey, sttModel);
    if (groqError) {
      const fields: Array<'openRouterKey' | 'groqKey' | 'sttModel' | 'translateModel'> =
        /STT model/i.test(groqError) ? ['sttModel'] : ['groqKey'];
      return { ok: false, message: groqError, fields };
    }
  }

  return { ok: true };
}
