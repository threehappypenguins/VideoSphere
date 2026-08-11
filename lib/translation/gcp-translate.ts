// =============================================================================
// Google Cloud Translation (NMT via Translation API v3)
// =============================================================================

import { TranslationServiceClient } from '@google-cloud/translate';
import { parseGcpServiceAccountJson } from '@/lib/translation/gcp-sa';
import { normalizeTranslationLanguageCode } from '@/lib/translation/languages';
import { clarifySermonSourceForMt } from '@/lib/translation/sermon-source-clarify';

/**
 * Maps a VideoSphere listen/source language code to a Cloud Translation BCP-47 tag.
 * @param code - Channel language code (e.g. `zh`, `yue`, `tl`).
 * @returns Cloud Translation language code.
 */
export function gcpTranslateLanguageCode(code: string): string {
  const normalized =
    normalizeTranslationLanguageCode(code)?.toLowerCase() || code.trim().toLowerCase();
  if (!normalized) return 'en';

  const aliases: Record<string, string> = {
    // Mandarin Simplified — Cloud Translation uses zh-CN (not bare zh for NMT).
    zh: 'zh-CN',
    // Cantonese is a first-class Translation API tag.
    yue: 'yue',
    // Tagalog / Filipino.
    tl: 'tl',
    // Norwegian Bokmål is the usual Translation target for `no`.
    no: 'no',
    he: 'iw',
  };

  return aliases[normalized] ?? normalized;
}

/**
 * Translates text with Cloud Translation Advanced (NMT) using the owner's service account.
 * Prefer this for live sermons: monthly free NMT quota is far more suitable than OpenRouter `:free` (50 RPD).
 * @param params - Service account JSON, text, language codes, and optional clarify skip.
 * @returns Translated text.
 * @see https://docs.cloud.google.com/translate/docs/advanced/translating-text-v3
 */
export async function translateTextWithGcp(params: {
  serviceAccountJson: string;
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  /**
   * When true, skip local sermon clarify (caller already clarified).
   * @default false
   */
  skipSermonClarify?: boolean;
}): Promise<string> {
  const { serviceAccountJson, text, sourceLanguage, targetLanguage, skipSermonClarify } = params;
  const trimmed = text.trim();
  if (!trimmed) return '';
  // NMT has no system prompt; clarify biblical collocations unless the dispatcher did.
  const contents = skipSermonClarify ? trimmed : clarifySermonSourceForMt(trimmed);

  const parsed = parseGcpServiceAccountJson(serviceAccountJson);
  if (parsed.ok === false) {
    throw new Error(parsed.error);
  }

  const client = new TranslationServiceClient({
    credentials: {
      client_email: parsed.value.client_email,
      private_key: parsed.value.private_key,
    },
    projectId: parsed.value.project_id,
  });

  const source = gcpTranslateLanguageCode(sourceLanguage);
  const target = gcpTranslateLanguageCode(targetLanguage);
  const parent = `projects/${parsed.value.project_id}/locations/global`;

  try {
    const [response] = await client.translateText({
      parent,
      contents: [contents],
      mimeType: 'text/plain',
      sourceLanguageCode: source,
      targetLanguageCode: target,
    });
    const out = response.translations?.[0]?.translatedText;
    return typeof out === 'string' ? out.trim() : '';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Advanced (v3) requires the Cloud Translation API *and* IAM on the service account.
    // Do not collapse every PERMISSION_DENIED into “API not enabled” — IAM is a common cause
    // when console metrics show Translation requests with 100% errors.
    if (/SERVICE_DISABLED|has not been used|it is disabled/i.test(message)) {
      throw new Error(
        'Google Cloud Translation API is not enabled on this service account’s project. ' +
          'In GCP Console → APIs & Services, enable “Cloud Translation API” for the same ' +
          `project_id as in your JSON key, then wait a minute and try again.`
      );
    }
    if (/PERMISSION_DENIED|ACCESS_TOKEN_SCOPE|IAM_PERMISSION/i.test(message)) {
      throw new Error(
        'Google Cloud Translation denied this service account (Cloud Translation Advanced / v3). ' +
          'Grant the account the “Cloud Translation API User” role (roles/cloudtranslate.user) ' +
          'on the same project as project_id in your JSON key. Enabling the API alone is not enough.'
      );
    }
    throw new Error(`GCP translate error: ${message.slice(0, 400)}`);
  } finally {
    try {
      await client.close();
    } catch {
      // ignore
    }
  }
}
