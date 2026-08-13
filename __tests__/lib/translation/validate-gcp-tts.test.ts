import { afterEach, describe, expect, it, vi } from 'vitest';

const listVoices = vi.fn();
const close = vi.fn(async () => undefined);

vi.mock('@google-cloud/text-to-speech', () => ({
  TextToSpeechClient: vi.fn(function MockTextToSpeechClient() {
    return { listVoices, close };
  }),
}));

import {
  languageCodeHintFromVoiceName,
  listGcpTtsVoices,
  validateGcpTtsConfig,
} from '@/lib/translation/validate-gcp-tts';

const validSaJson = JSON.stringify({
  type: 'service_account',
  project_id: 'demo-project',
  private_key: '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n',
  client_email: 'tts@demo-project.iam.gserviceaccount.com',
});

describe('languageCodeHintFromVoiceName', () => {
  it('extracts en-US style prefixes', () => {
    expect(languageCodeHintFromVoiceName('es-US-Neural2-A')).toBe('es-US');
    expect(languageCodeHintFromVoiceName('cmn-CN-Wavenet-A')).toBe('cmn-CN');
  });
});

describe('validateGcpTtsConfig', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid service account JSON shape without calling GCP', async () => {
    const result = await validateGcpTtsConfig({
      serviceAccountJson: '{ "type": "user" }',
      voices: { es: 'es-US-Neural2-A' },
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.fields).toEqual(['gcpJson']);
    }
    expect(listVoices).not.toHaveBeenCalled();
  });

  it('rejects unknown voices after listVoices', async () => {
    listVoices.mockResolvedValueOnce([
      { voices: [{ name: 'en-US-Neural2-A', languageCodes: ['en-US'] }] },
    ]);

    const result = await validateGcpTtsConfig({
      serviceAccountJson: validSaJson,
      voices: { es: 'es-US-Neural2-A' },
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.message).toMatch(/not found/i);
      expect(result.fields).toEqual(['ttsVoice']);
      expect(result.language).toBe('es');
    }
  });

  it('rejects voices that do not match the language', async () => {
    listVoices.mockResolvedValueOnce([
      { voices: [{ name: 'es-US-Neural2-A', languageCodes: ['es-US'] }] },
    ]);

    const result = await validateGcpTtsConfig({
      serviceAccountJson: validSaJson,
      voices: { en: 'es-US-Neural2-A' },
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.message).toMatch(/does not match language/i);
      expect(result.language).toBe('en');
    }
  });

  it('accepts credentials when requested voices are listed and match languages', async () => {
    listVoices.mockResolvedValueOnce([
      {
        voices: [
          { name: 'es-US-Neural2-A', languageCodes: ['es-US'] },
          { name: 'en-US-Neural2-A', languageCodes: ['en-US'] },
        ],
      },
    ]);

    const result = await validateGcpTtsConfig({
      serviceAccountJson: validSaJson,
      voices: { es: 'es-US-Neural2-A', en: 'en-US-Neural2-A' },
    });

    expect(result).toEqual({ ok: true });
  });

  it('maps UNAUTHENTICATED errors to gcpJson', async () => {
    listVoices.mockRejectedValueOnce(Object.assign(new Error('UNAUTHENTICATED'), { code: 16 }));

    const result = await validateGcpTtsConfig({
      serviceAccountJson: validSaJson,
      voices: { es: 'es-US-Neural2-A' },
    });

    expect(result).toEqual({
      ok: false,
      message: 'Google Cloud service account credentials are invalid.',
      fields: ['gcpJson'],
    });
  });

  it('lists voices for dropdowns', async () => {
    listVoices.mockResolvedValueOnce([
      {
        voices: [
          { name: 'en-US-Neural2-B', languageCodes: ['en-US'], ssmlGender: 'MALE' },
          { name: 'en-US-Neural2-A', languageCodes: ['en-US'], ssmlGender: 'FEMALE' },
        ],
      },
    ]);

    const result = await listGcpTtsVoices(validSaJson);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.voices.map((v) => v.name)).toEqual(['en-US-Neural2-A', 'en-US-Neural2-B']);
      expect(result.voices[0]?.ssmlGender).toBe('female');
      expect(result.voices[1]?.ssmlGender).toBe('male');
    }
  });
});
