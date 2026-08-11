// =============================================================================
// Google Cloud Speech-to-Text (sync recognize; per-user service account)
// =============================================================================

import { SpeechClient, protos } from '@google-cloud/speech';
import { parseGcpServiceAccountJson } from '@/lib/translation/gcp-sa';
import { normalizeTranslationLanguageCode } from '@/lib/translation/languages';

const LINEAR16 = protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding.LINEAR16;

/**
 * Maps a VideoSphere source language to a Cloud Speech-to-Text BCP-47 tag.
 * @param code - Channel source language code.
 * @returns Speech API language code.
 */
export function gcpSttLanguageCode(code: string): string {
  const normalized =
    normalizeTranslationLanguageCode(code)?.toLowerCase() || code.trim().toLowerCase();
  if (!normalized) return 'en-US';

  const aliases: Record<string, string> = {
    en: 'en-US',
    zh: 'zh-CN',
    yue: 'yue-HK',
    pt: 'pt-BR',
    es: 'es-US',
    tl: 'fil-PH',
    he: 'he-IL',
    no: 'nb-NO',
  };

  if (aliases[normalized]) return aliases[normalized];
  // Already region-qualified.
  if (normalized.includes('-')) return normalized;
  return normalized;
}

/**
 * Strips a standard 44-byte PCM WAV header when present.
 * @param audio - WAV or raw PCM bytes.
 * @param format - Declared format (`wav`, `pcm`, …).
 * @returns Raw PCM payload for LINEAR16 recognition.
 */
function rawPcmFromAudio(audio: Buffer, format: string): Buffer {
  const ext = format.trim().replace(/^\./, '').toLowerCase() || 'wav';
  if (ext === 'wav' && audio.length > 44 && audio.toString('ascii', 0, 4) === 'RIFF') {
    return audio.subarray(44);
  }
  return audio;
}

/**
 * Transcribes a short audio buffer with Cloud Speech-to-Text (sync `recognize`).
 * Suitable for live mic chunks (~seconds). Uses the owner’s service account.
 * @param params - Service account, recognition model, audio, and language.
 * @returns Transcribed text (may be empty).
 * @see https://cloud.google.com/speech-to-text/docs/sync-recognize
 */
export async function transcribeAudioWithGcp(params: {
  serviceAccountJson: string;
  model: string;
  audio: Buffer;
  format: string;
  sampleRateHertz?: number;
  language?: string;
}): Promise<string> {
  const { serviceAccountJson, model, audio, format, language } = params;
  if (!serviceAccountJson.trim()) {
    throw new Error('GCP Speech-to-Text requires a per-user service account JSON.');
  }
  const recognitionModel = model.trim() || 'latest_long';
  if (audio.length === 0) return '';

  const parsed = parseGcpServiceAccountJson(serviceAccountJson);
  if (parsed.ok === false) {
    throw new Error(parsed.error);
  }

  const pcm = rawPcmFromAudio(audio, format);
  if (pcm.length === 0) return '';

  const sampleRateHertz =
    typeof params.sampleRateHertz === 'number' && params.sampleRateHertz > 0
      ? Math.round(params.sampleRateHertz)
      : 16_000;

  const client = new SpeechClient({
    credentials: {
      client_email: parsed.value.client_email,
      private_key: parsed.value.private_key,
    },
    projectId: parsed.value.project_id,
  });

  try {
    const [response] = await client.recognize({
      audio: { content: pcm.toString('base64') },
      config: {
        encoding: LINEAR16,
        sampleRateHertz,
        languageCode: gcpSttLanguageCode(language || 'en'),
        model: recognitionModel,
        enableAutomaticPunctuation: true,
      },
    });

    const parts =
      response.results
        ?.map((r) => r.alternatives?.[0]?.transcript?.trim())
        .filter((t): t is string => Boolean(t)) ?? [];
    return parts.join(' ').trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /PERMISSION_DENIED|Speech-to-Text API has not been used|SERVICE_DISABLED|ACCESS_TOKEN_SCOPE/i.test(
        message
      )
    ) {
      throw new Error(
        'Google Cloud Speech-to-Text API is not enabled (or this service account cannot use it). ' +
          'Enable “Cloud Speech-to-Text API” in the same GCP project as your service account.'
      );
    }
    throw new Error(`GCP STT error: ${message.slice(0, 400)}`);
  } finally {
    try {
      await client.close();
    } catch {
      // ignore
    }
  }
}
