// =============================================================================
// Validate GCP Text-to-Speech credentials + voices before persist
// =============================================================================

import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { parseGcpServiceAccountJson } from '@/lib/translation/gcp-sa';
import {
  languageCodeHintFromVoiceName,
  normalizeGcpTtsSsmlGender,
  normalizeGcpTtsVoices,
  voiceMatchesListenLanguage,
  type GcpTtsSsmlGender,
  type GcpTtsVoicesMap,
} from '@/lib/translation/gcp-tts-voices';

export { languageCodeHintFromVoiceName } from '@/lib/translation/gcp-tts-voices';

const VALIDATE_TIMEOUT_MS = 15_000;

/**
 * A voice row returned from Google Cloud `listVoices`.
 */
export interface GcpTtsVoiceOption {
  /** Voice resource name (e.g. `en-US-Neural2-A`). */
  name: string;
  /** Language codes this voice supports (BCP-47). */
  languageCodes: string[];
  /** Reported SSML gender when Google provides one. */
  ssmlGender: GcpTtsSsmlGender | null;
}

/**
 * Inputs used to validate GCP TTS settings before they are persisted.
 */
export interface ValidateGcpTtsConfigInput {
  /** Full service account JSON text. */
  serviceAccountJson: string;
  /**
   * Per-language voice map. When empty, only credentials / API access are checked.
   */
  voices?: GcpTtsVoicesMap | null;
}

/**
 * Result of pre-save GCP TTS credential validation.
 */
export type ValidateGcpTtsConfigResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
      /** Form fields that should be highlighted for this error. */
      fields: Array<'gcpJson' | 'ttsVoice'>;
      /** Language code when a specific voice row failed. */
      language?: string;
    };

/**
 * Maps a Google API / gRPC failure into a UI field error.
 * @param err - Thrown value from the TTS client.
 * @returns User-facing message and fields to highlight.
 */
function mapGcpTtsClientError(err: unknown): {
  message: string;
  fields: Array<'gcpJson' | 'ttsVoice'>;
} {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? Number((err as { code: unknown }).code)
      : NaN;

  if (
    code === 16 ||
    /UNAUTHENTICATED|invalid_grant|invalid_client|Could not load the default credentials/i.test(
      message
    )
  ) {
    return {
      message: 'Google Cloud service account credentials are invalid.',
      fields: ['gcpJson'],
    };
  }

  if (
    code === 7 ||
    /PERMISSION_DENIED|Cloud Text-to-Speech API has not been used|API has not been enabled|SERVICE_DISABLED/i.test(
      message
    )
  ) {
    return {
      message:
        'Google Cloud TTS permission denied. Enable Cloud Text-to-Speech and grant this service account access.',
      fields: ['gcpJson'],
    };
  }

  if (/DEADLINE_EXCEEDED|ETIMEDOUT|timeout/i.test(message) || code === 4) {
    return {
      message: 'Google Cloud Text-to-Speech validation timed out. Try again.',
      fields: ['gcpJson'],
    };
  }

  return {
    message: 'Could not reach Google Cloud Text-to-Speech to validate credentials. Try again.',
    fields: ['gcpJson'],
  };
}

/**
 * Creates a TTS client from service account JSON.
 * @param serviceAccountJson - SA JSON text.
 * @returns Client, or a validation error.
 */
function createClient(
  serviceAccountJson: string
):
  | { ok: true; client: TextToSpeechClient }
  | { ok: false; message: string; fields: Array<'gcpJson' | 'ttsVoice'> } {
  const parsed = parseGcpServiceAccountJson(serviceAccountJson);
  if (parsed.ok === false) {
    return { ok: false, message: parsed.error, fields: ['gcpJson'] };
  }
  return {
    ok: true,
    client: new TextToSpeechClient({
      credentials: {
        client_email: parsed.value.client_email,
        private_key: parsed.value.private_key,
      },
      projectId: parsed.value.project_id,
    }),
  };
}

/**
 * Lists GCP TTS voices available to the given service account.
 * @param serviceAccountJson - Service account JSON text.
 * @returns Voice options, or a user-facing error.
 */
export async function listGcpTtsVoices(
  serviceAccountJson: string
): Promise<
  | { ok: true; voices: GcpTtsVoiceOption[] }
  | { ok: false; message: string; fields: Array<'gcpJson'> }
> {
  const created = createClient(serviceAccountJson);
  if (created.ok === false) {
    return { ok: false, message: created.message, fields: ['gcpJson'] };
  }
  const { client } = created;
  try {
    const [response] = await client.listVoices({}, { timeout: VALIDATE_TIMEOUT_MS });
    const voices: GcpTtsVoiceOption[] = [];
    for (const v of response.voices ?? []) {
      if (typeof v.name !== 'string' || !v.name.trim()) continue;
      const languageCodes = Array.isArray(v.languageCodes)
        ? v.languageCodes.filter((c): c is string => typeof c === 'string' && Boolean(c.trim()))
        : [];
      voices.push({
        name: v.name.trim(),
        languageCodes,
        ssmlGender: normalizeGcpTtsSsmlGender((v as { ssmlGender?: unknown }).ssmlGender),
      });
    }
    voices.sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, voices };
  } catch (err) {
    const mapped = mapGcpTtsClientError(err);
    return { ok: false, message: mapped.message, fields: ['gcpJson'] };
  } finally {
    try {
      await client.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Validates GCP service account JSON and per-language voices against the live API.
 * @param input - Service account JSON and voices map to validate.
 * @returns Success, or a user-facing error with form fields.
 */
export async function validateGcpTtsConfig(
  input: ValidateGcpTtsConfigInput
): Promise<ValidateGcpTtsConfigResult> {
  const voices = normalizeGcpTtsVoices(input.voices ?? {});
  const listed = await listGcpTtsVoices(input.serviceAccountJson);
  if (listed.ok === false) {
    return { ok: false, message: listed.message, fields: listed.fields };
  }

  const known = new Set(listed.voices.map((v) => v.name));
  for (const [language, voiceName] of Object.entries(voices)) {
    if (!known.has(voiceName)) {
      return {
        ok: false,
        message: `GCP TTS voice "${voiceName}" was not found for this project.`,
        fields: ['ttsVoice'],
        language,
      };
    }
    if (!voiceMatchesListenLanguage(voiceName, language)) {
      return {
        ok: false,
        message: `Voice "${voiceName}" does not match language "${language}". Pick a voice for that language.`,
        fields: ['ttsVoice'],
        language,
      };
    }
  }

  return { ok: true };
}
