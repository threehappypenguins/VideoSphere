// =============================================================================
// Validate live-translation AI keys + model ids against provider APIs
// =============================================================================

import {
  isStreamingSttProvider,
  sttProvidesBuiltInTranslation,
  type LiveTranslationSttProvider,
  type LiveTranslationTextTranslateProvider,
} from '@/lib/translation/capabilities';

const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';
const DEEPGRAM_PROJECTS_URL = 'https://api.deepgram.com/v1/projects';
const ASSEMBLYAI_URL = 'https://api.assemblyai.com/v2/transcript';
const GLADIA_URL = 'https://api.gladia.io/v2/transcription';
const VALIDATE_TIMEOUT_MS = 15_000;

/**
 * Inputs used to validate AI credentials before they are persisted.
 */
export interface ValidateTranslationAiConfigInput {
  /** OpenRouter API key when translate uses OpenRouter. */
  openRouterApiKey: string;
  /** Groq API key when STT or translate uses Groq. */
  groqApiKey?: string | null;
  /** Deepgram API key when STT uses Deepgram. */
  deepgramApiKey?: string | null;
  /** AssemblyAI API key when STT uses AssemblyAI. */
  assemblyaiApiKey?: string | null;
  /** Gladia API key when STT uses Gladia. */
  gladiaApiKey?: string | null;
  /** Speechmatics API key when STT uses Speechmatics. */
  speechmaticsApiKey?: string | null;
  /** Soniox API key when STT uses Soniox. */
  sonioxApiKey?: string | null;
  /** Modulate API key when STT uses Modulate. */
  modulateApiKey?: string | null;
  /** Whether a GCP service account is already stored or included in this save. */
  hasGcpServiceAccount: boolean;
  /** Active STT provider. */
  sttProvider: LiveTranslationSttProvider;
  /**
   * Active caption translation provider.
   * Ignored (and may be null) when STT is Soniox.
   */
  textTranslateProvider: LiveTranslationTextTranslateProvider | null;
  /** STT model id for Groq Whisper (unused for streaming ASR). */
  sttModel: string;
  /** Chat model id for OpenRouter or Groq translate (unused for GCP / Soniox). */
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
      fields: Array<
        | 'openRouterKey'
        | 'groqKey'
        | 'deepgramKey'
        | 'assemblyaiKey'
        | 'gladiaKey'
        | 'speechmaticsKey'
        | 'sonioxKey'
        | 'modulateKey'
        | 'sttModel'
        | 'translateModel'
        | 'gcpJson'
      >;
    };

type OpenRouterModel = {
  id?: unknown;
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
 * Confirms an OpenRouter API key via GET /api/v1/key.
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
 * Loads OpenRouter model catalog entries.
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
 * Validates a Deepgram API key via projects list.
 * @param apiKey - Deepgram API key.
 * @returns Error message when invalid; otherwise null.
 */
async function validateDeepgramApiKey(apiKey: string): Promise<string | null> {
  let response: Response;
  try {
    response = await fetchWithTimeout(DEEPGRAM_PROJECTS_URL, {
      method: 'GET',
      headers: { Authorization: `Token ${apiKey}` },
    });
  } catch {
    return 'Could not reach Deepgram to validate your API key. Try again.';
  }
  if (response.status === 401 || response.status === 403) {
    return 'Deepgram API key is invalid.';
  }
  if (!response.ok) {
    return `Deepgram key check failed (${response.status}). Try again.`;
  }
  return null;
}

/**
 * Validates an AssemblyAI API key with a lightweight authenticated GET.
 * @param apiKey - AssemblyAI API key.
 * @returns Error message when invalid; otherwise null.
 */
async function validateAssemblyaiApiKey(apiKey: string): Promise<string | null> {
  let response: Response;
  try {
    // Listing with an impossible id returns 404 when auth is valid, 401 when not.
    response = await fetchWithTimeout(`${ASSEMBLYAI_URL}/00000000-0000-0000-0000-000000000000`, {
      method: 'GET',
      headers: { Authorization: apiKey },
    });
  } catch {
    return 'Could not reach AssemblyAI to validate your API key. Try again.';
  }
  if (response.status === 401 || response.status === 403) {
    return 'AssemblyAI API key is invalid.';
  }
  // 404 / 400 means the key was accepted.
  return null;
}

/**
 * Validates a Gladia API key with a lightweight authenticated request.
 * @param apiKey - Gladia API key.
 * @returns Error message when invalid; otherwise null.
 */
async function validateGladiaApiKey(apiKey: string): Promise<string | null> {
  let response: Response;
  try {
    response = await fetchWithTimeout(GLADIA_URL, {
      method: 'GET',
      headers: { 'x-gladia-key': apiKey },
    });
  } catch {
    return 'Could not reach Gladia to validate your API key. Try again.';
  }
  if (response.status === 401 || response.status === 403) {
    return 'Gladia API key is invalid.';
  }
  return null;
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
  const deepgramApiKey = input.deepgramApiKey?.trim() || '';
  const assemblyaiApiKey = input.assemblyaiApiKey?.trim() || '';
  const gladiaApiKey = input.gladiaApiKey?.trim() || '';
  const speechmaticsApiKey = input.speechmaticsApiKey?.trim() || '';
  const sonioxApiKey = input.sonioxApiKey?.trim() || '';
  const modulateApiKey = input.modulateApiKey?.trim() || '';

  const sonioxStt = sttProvidesBuiltInTranslation(input.sttProvider);
  const streaming = isStreamingSttProvider(input.sttProvider);
  const needsOpenRouterTranslate = !sonioxStt && input.textTranslateProvider === 'openrouter';
  const needsGroqStt = input.sttProvider === 'groq';
  const needsGroqTranslate = !sonioxStt && input.textTranslateProvider === 'groq';
  const needsGcpTranslate = !sonioxStt && input.textTranslateProvider === 'gcp';

  if (!sonioxStt && !input.textTranslateProvider) {
    return {
      ok: false,
      message: 'Select a caption translation provider.',
      fields: ['translateModel'],
    };
  }

  if (needsGcpTranslate && !input.hasGcpServiceAccount) {
    return {
      ok: false,
      message:
        'A Google Cloud service account is required when translation uses Google Cloud. ' +
        'Paste the JSON here or save it under Google Cloud TTS first.',
      fields: ['gcpJson'],
    };
  }

  if (needsGroqStt && !sttModel) {
    return { ok: false, message: 'STT model id is required for Groq.', fields: ['sttModel'] };
  }

  if ((needsOpenRouterTranslate || needsGroqTranslate) && !translateModel) {
    return {
      ok: false,
      message: 'Translation model id is required for OpenRouter or Groq caption translation.',
      fields: ['translateModel'],
    };
  }

  if (needsOpenRouterTranslate && !openRouterApiKey) {
    return {
      ok: false,
      message: 'OpenRouter API key is required for OpenRouter translation.',
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

  if (input.sttProvider === 'deepgram') {
    if (!deepgramApiKey) {
      return { ok: false, message: 'Deepgram API key is required.', fields: ['deepgramKey'] };
    }
    const err = await validateDeepgramApiKey(deepgramApiKey);
    if (err) return { ok: false, message: err, fields: ['deepgramKey'] };
  }

  if (input.sttProvider === 'assemblyai') {
    if (!assemblyaiApiKey) {
      return { ok: false, message: 'AssemblyAI API key is required.', fields: ['assemblyaiKey'] };
    }
    const err = await validateAssemblyaiApiKey(assemblyaiApiKey);
    if (err) return { ok: false, message: err, fields: ['assemblyaiKey'] };
  }

  if (input.sttProvider === 'gladia') {
    if (!gladiaApiKey) {
      return { ok: false, message: 'Gladia API key is required.', fields: ['gladiaKey'] };
    }
    const err = await validateGladiaApiKey(gladiaApiKey);
    if (err) return { ok: false, message: err, fields: ['gladiaKey'] };
  }

  if (input.sttProvider === 'speechmatics') {
    if (!speechmaticsApiKey) {
      return {
        ok: false,
        message: 'Speechmatics API key is required.',
        fields: ['speechmaticsKey'],
      };
    }
    // Speechmatics has no trivial public ping; accept non-empty key shape.
    if (speechmaticsApiKey.length < 8) {
      return {
        ok: false,
        message: 'Speechmatics API key looks too short.',
        fields: ['speechmaticsKey'],
      };
    }
  }

  if (input.sttProvider === 'soniox') {
    if (!sonioxApiKey) {
      return { ok: false, message: 'Soniox API key is required.', fields: ['sonioxKey'] };
    }
    if (sonioxApiKey.length < 8) {
      return { ok: false, message: 'Soniox API key looks too short.', fields: ['sonioxKey'] };
    }
  }

  if (input.sttProvider === 'modulate') {
    if (!modulateApiKey) {
      return { ok: false, message: 'Modulate API key is required.', fields: ['modulateKey'] };
    }
    // Modulate has no trivial public HTTP ping; accept non-empty key shape.
    if (modulateApiKey.length < 8) {
      return {
        ok: false,
        message: 'Modulate API key looks too short.',
        fields: ['modulateKey'],
      };
    }
  }

  if (needsOpenRouterTranslate) {
    const keyError = await validateOpenRouterApiKey(openRouterApiKey);
    if (keyError) {
      return { ok: false, message: keyError, fields: ['openRouterKey'] };
    }

    const catalog = await listOpenRouterModels(openRouterApiKey);
    if (catalog.ok === false) {
      return { ok: false, message: catalog.message, fields: ['openRouterKey'] };
    }

    const translate = catalog.models.find(
      (m) => typeof m.id === 'string' && m.id === translateModel
    );
    if (!translate) {
      return {
        ok: false,
        message: `OpenRouter translation model "${translateModel}" was not found.`,
        fields: ['translateModel'],
      };
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

  // streaming is used for capability documentation; silence unused when only shape-checked above
  void streaming;

  return { ok: true };
}
