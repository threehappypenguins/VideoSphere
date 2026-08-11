// =============================================================================
// Google Cloud Text-to-Speech (per-user service account + voice; no defaults)
// =============================================================================

import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { parseGcpServiceAccountJson } from '@/lib/translation/gcp-sa';
import { languageCodeHintFromVoiceName } from '@/lib/translation/gcp-tts-voices';

/**
 * Classic `synthesizeSpeech` rejects oversized `input.text` payloads.
 * Stay under Google's ~5KB limit with headroom for UTF-8.
 */
export const GCP_TTS_MAX_INPUT_CHARS = 4_500;

/**
 * Truncates TTS input at a sentence/word boundary when over the API limit.
 * @param text - Raw caption text.
 * @param maxChars - Maximum characters to keep.
 * @returns Safe synthesize input.
 */
export function clampGcpTtsInput(text: string, maxChars: number = GCP_TTS_MAX_INPUT_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const slice = trimmed.slice(0, maxChars);
  const sentence = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? ')
  );
  if (sentence >= Math.floor(maxChars / 2)) {
    return slice.slice(0, sentence + 1).trim();
  }
  const sp = slice.lastIndexOf(' ');
  return (sp > 0 ? slice.slice(0, sp) : slice).trim();
}

/**
 * Synthesizes speech for translated text using the owner's GCP credentials.
 * @param params - Service account JSON, voice name, language code, and text.
 * @returns MP3 audio bytes.
 */
export async function synthesizeSpeechWithGcp(params: {
  serviceAccountJson: string;
  voiceName: string;
  languageCode: string;
  text: string;
}): Promise<Buffer> {
  const { serviceAccountJson, voiceName, languageCode, text } = params;
  if (!voiceName.trim()) {
    throw new Error('GCP TTS requires a per-user voice name.');
  }
  const trimmed = clampGcpTtsInput(text);
  if (!trimmed) {
    return Buffer.alloc(0);
  }

  const parsed = parseGcpServiceAccountJson(serviceAccountJson);
  if (parsed.ok === false) {
    throw new Error(parsed.error);
  }

  const client = new TextToSpeechClient({
    credentials: {
      client_email: parsed.value.client_email,
      private_key: parsed.value.private_key,
    },
    projectId: parsed.value.project_id,
  });

  // GCP requires languageCode to match the voice (e.g. es-US), not a bare ISO code.
  const resolvedLanguage =
    languageCodeHintFromVoiceName(voiceName) || languageCode.trim() || 'en-US';

  try {
    const [response] = await client.synthesizeSpeech({
      input: { text: trimmed },
      voice: {
        languageCode: resolvedLanguage,
        name: voiceName.trim(),
      },
      audioConfig: { audioEncoding: 'MP3' },
    });

    const audio = response.audioContent;
    if (!audio) {
      throw new Error('GCP TTS returned empty audio.');
    }
    if (Buffer.isBuffer(audio)) {
      return audio;
    }
    if (audio instanceof Uint8Array) {
      return Buffer.from(audio);
    }
    if (typeof audio === 'string') {
      return Buffer.from(audio, 'base64');
    }
    return Buffer.from(audio as ArrayBuffer);
  } finally {
    try {
      await client.close();
    } catch {
      // ignore
    }
  }
}
