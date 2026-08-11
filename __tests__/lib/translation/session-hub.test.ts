import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/repositories/live-translation-channels', () => ({
  getRuntimeSecretsForUser: vi.fn(async () => ({
    sttProvider: 'groq',
    textTranslateProvider: 'openrouter',
    openRouterApiKey: 'key',
    groqApiKey: 'gsk',
    deepgramApiKey: null,
    assemblyaiApiKey: null,
    gladiaApiKey: null,
    speechmaticsApiKey: null,
    sonioxApiKey: null,
    gcpServiceAccountJson: null,
    sttModel: 'whisper-large-v3-turbo',
    openRouterTranslateModel: 'tr',
    gcpTtsVoices: {},
    sourceLanguage: 'en',
    enabledLanguages: ['es', 'fr'],
    translationReady: true,
    listenReady: false,
  })),
}));

vi.mock('@/lib/translation/translate-text', () => ({
  translateLiveCaptionText: vi.fn(async () => 'hola'),
  OpenRouterTranslateRateLimitError: class OpenRouterTranslateRateLimitError extends Error {
    retryAfterSeconds: number | null = null;
    constructor(message: string, retryAfterSeconds: number | null = null) {
      super(message);
      this.name = 'OpenRouterTranslateRateLimitError';
      this.retryAfterSeconds = retryAfterSeconds;
    }
  },
  GroqTranslateRateLimitError: class GroqTranslateRateLimitError extends Error {
    retryAfterSeconds: number | null = null;
    constructor(message: string, retryAfterSeconds: number | null = null) {
      super(message);
      this.name = 'GroqTranslateRateLimitError';
      this.retryAfterSeconds = retryAfterSeconds;
    }
  },
}));

vi.mock('@/lib/translation/transcribe', () => ({
  transcribeAudio: vi.fn(async () => 'hello'),
}));

vi.mock('@/lib/translation/gcp-tts', () => ({
  synthesizeSpeechWithGcp: vi.fn(async () => Buffer.alloc(0)),
}));

const createStreamingAsrSession = vi.fn();

vi.mock('@/lib/translation/streaming-asr', () => ({
  createStreamingAsrSession: (...args: unknown[]) => createStreamingAsrSession(...args),
}));

import {
  __resetTranslationSessionsForTests,
  enqueueOwnerPcm,
  getSubscriberStats,
  markIngestStopped,
  subscribePublicListener,
} from '@/lib/translation/session-hub';
import { getRuntimeSecretsForUser } from '@/lib/repositories/live-translation-channels';
import { translateLiveCaptionText } from '@/lib/translation/translate-text';
import { transcribeAudio } from '@/lib/translation/transcribe';

/**
 * Non-silent PCM16 mono so the session hub silence gate does not skip the chunk.
 * @param byteLength - Buffer size in bytes (even).
 * @returns PCM filled with a mid-level sample.
 */
function loudPcm(byteLength: number): Buffer {
  const buf = Buffer.alloc(byteLength);
  for (let i = 0; i + 1 < buf.length; i += 2) {
    buf.writeInt16LE(8_000, i);
  }
  return buf;
}

describe('translation session hub', () => {
  afterEach(() => {
    __resetTranslationSessionsForTests();
    vi.clearAllMocks();
    createStreamingAsrSession.mockReset();
    vi.useRealTimers();
  });

  it('tracks subscribers and clears after unsubscribe + grace teardown path', async () => {
    const events: unknown[] = [];
    const unsub = subscribePublicListener({
      channelId: 'ch-1',
      userId: 'user-1',
      language: 'es',
      wantAudio: false,
      send: (event) => {
        events.push(event);
      },
    });

    await vi.waitFor(() => {
      expect(getSubscriberStats('ch-1').totalSubscribers).toBe(1);
    });

    unsub();
    expect(getSubscriberStats('ch-1').byLanguage.es ?? 0).toBe(0);
    expect(events.some((e) => (e as { type: string }).type === 'status')).toBe(true);
  });

  it('uses transcription only when listen language matches source (no translate call)', async () => {
    const captions: string[] = [];
    const unsub = subscribePublicListener({
      channelId: 'ch-en',
      userId: 'user-1',
      language: 'en',
      wantAudio: false,
      send: (event) => {
        if (event.type === 'caption' && event.text) captions.push(event.text);
      },
    });

    await vi.waitFor(() => {
      expect(getSubscriberStats('ch-en').totalSubscribers).toBe(1);
    });

    enqueueOwnerPcm('ch-en', 'user-1', loudPcm(3200), 16000);

    await vi.waitFor(() => {
      expect(captions).toContain('hello');
    });

    expect(transcribeAudio).toHaveBeenCalled();
    expect(translateLiveCaptionText).not.toHaveBeenCalled();
    unsub();
  });

  it('translates only while a target language has active listeners', async () => {
    const esCaptions: string[] = [];
    const unsubEs = subscribePublicListener({
      channelId: 'ch-switch',
      userId: 'user-1',
      language: 'es',
      wantAudio: false,
      send: (event) => {
        if (event.type === 'caption' && event.text) esCaptions.push(event.text);
      },
    });

    await vi.waitFor(() => {
      expect(getSubscriberStats('ch-switch').byLanguage.es).toBe(1);
    });

    enqueueOwnerPcm('ch-switch', 'user-1', loudPcm(3200), 16000);
    await vi.waitFor(() => {
      expect(esCaptions).toContain('hola');
    });
    expect(translateLiveCaptionText).toHaveBeenCalledTimes(1);

    unsubEs();

    const frCaptions: string[] = [];
    vi.mocked(translateLiveCaptionText).mockResolvedValueOnce('bonjour');
    const unsubFr = subscribePublicListener({
      channelId: 'ch-switch',
      userId: 'user-1',
      language: 'fr',
      wantAudio: false,
      send: (event) => {
        if (event.type === 'caption' && event.text) frCaptions.push(event.text);
      },
    });

    await vi.waitFor(() => {
      expect(getSubscriberStats('ch-switch').byLanguage.fr).toBe(1);
    });

    // No historical Spanish replay after switching — French only sees new live work.
    expect(frCaptions).toEqual([]);

    enqueueOwnerPcm('ch-switch', 'user-1', loudPcm(3200), 16000);
    await vi.waitFor(() => {
      expect(frCaptions).toContain('bonjour');
    });

    unsubFr();
  });

  it('purges cached language captions after idle grace when nobody is listening', async () => {
    vi.useFakeTimers();
    const esCaptions: string[] = [];
    const unsub = subscribePublicListener({
      channelId: 'ch-purge',
      userId: 'user-1',
      language: 'es',
      wantAudio: false,
      send: (event) => {
        if (event.type === 'caption' && event.text) esCaptions.push(event.text);
      },
    });

    await vi.waitFor(() => {
      expect(getSubscriberStats('ch-purge').totalSubscribers).toBe(1);
    });

    enqueueOwnerPcm('ch-purge', 'user-1', loudPcm(3200), 16000);
    await vi.waitFor(() => {
      expect(esCaptions).toContain('hola');
    });

    unsub();
    expect(getSubscriberStats('ch-purge').byLanguage.es ?? 0).toBe(0);

    // After grace, language bucket is gone (no idle cache of work).
    await vi.advanceTimersByTimeAsync(3_500);
    expect(getSubscriberStats('ch-purge').byLanguage.es).toBeUndefined();

    const replay: string[] = [];
    const unsub2 = subscribePublicListener({
      channelId: 'ch-purge',
      userId: 'user-1',
      language: 'es',
      wantAudio: false,
      send: (event) => {
        if (event.type === 'caption' && event.text) replay.push(event.text);
      },
    });

    await vi.waitFor(() => {
      expect(getSubscriberStats('ch-purge').totalSubscribers).toBe(1);
    });

    // Live-only: rejoining does not dump previously cached captions.
    expect(replay).toEqual([]);
    unsub2();
  });

  it('does not call STT until a public listener has chosen a language', async () => {
    enqueueOwnerPcm('ch-idle', 'user-1', loudPcm(3200), 16000);
    await Promise.resolve();
    await Promise.resolve();
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(getSubscriberStats('ch-idle').live).toBe(true);

    const captions: string[] = [];
    const unsub = subscribePublicListener({
      channelId: 'ch-idle',
      userId: 'user-1',
      language: 'en',
      wantAudio: false,
      send: (event) => {
        if (event.type === 'caption' && event.text) captions.push(event.text);
      },
    });

    enqueueOwnerPcm('ch-idle', 'user-1', loudPcm(3200), 16000);
    await vi.waitFor(() => {
      expect(captions).toContain('hello');
    });
    expect(transcribeAudio).toHaveBeenCalled();
    unsub();
  });

  it('drops queued PCM when ingest is stopped so STT does not keep running', async () => {
    let releaseStt: (() => void) | undefined;
    const sttGate = new Promise<void>((resolve) => {
      releaseStt = resolve;
    });
    vi.mocked(transcribeAudio).mockImplementationOnce(async () => {
      await sttGate;
      return 'still-going';
    });

    const unsub = subscribePublicListener({
      channelId: 'ch-stop',
      userId: 'user-1',
      language: 'en',
      wantAudio: false,
      send: () => undefined,
    });

    await vi.waitFor(() => {
      expect(getSubscriberStats('ch-stop').totalSubscribers).toBe(1);
    });

    enqueueOwnerPcm('ch-stop', 'user-1', loudPcm(3200), 16000);
    enqueueOwnerPcm('ch-stop', 'user-1', loudPcm(3200), 16000);
    enqueueOwnerPcm('ch-stop', 'user-1', loudPcm(3200), 16000);

    await vi.waitFor(() => {
      expect(transcribeAudio).toHaveBeenCalledTimes(1);
    });

    markIngestStopped('ch-stop');
    releaseStt?.();

    await Promise.resolve();
    await Promise.resolve();

    // In-flight call may finish, but queued chunks must not start new STT work.
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    expect(getSubscriberStats('ch-stop').live).toBe(false);
    unsub();
  });

  it('backs off STT after a 429 instead of draining the queue immediately', async () => {
    vi.useFakeTimers();
    vi.mocked(transcribeAudio)
      .mockRejectedValueOnce(new Error('Groq STT error (429): rate_limit_exceeded'))
      .mockResolvedValue('hello');

    const unsub = subscribePublicListener({
      channelId: 'ch-429',
      userId: 'user-1',
      language: 'en',
      wantAudio: false,
      send: () => undefined,
    });

    await vi.waitFor(() => {
      expect(getSubscriberStats('ch-429').totalSubscribers).toBe(1);
    });

    enqueueOwnerPcm('ch-429', 'user-1', loudPcm(3200), 16000);

    await vi.waitFor(() => {
      expect(transcribeAudio).toHaveBeenCalledTimes(1);
    });

    // Still within backoff — should not immediately retry.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(transcribeAudio).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    await vi.waitFor(() => {
      expect(transcribeAudio).toHaveBeenCalledTimes(2);
    });
    unsub();
  });

  it('drops older PCM while STT is rate-limited so recovery does not burn quota', async () => {
    vi.useFakeTimers();
    let releaseStt: (() => void) | undefined;
    const sttGate = new Promise<void>((resolve) => {
      releaseStt = resolve;
    });
    vi.mocked(transcribeAudio)
      .mockRejectedValueOnce(new Error('Groq STT error (429): rate_limit_exceeded'))
      .mockImplementationOnce(async () => {
        await sttGate;
        return 'latest-only';
      });

    const captions: string[] = [];
    const unsub = subscribePublicListener({
      channelId: 'ch-stt-coalesce',
      userId: 'user-1',
      language: 'en',
      wantAudio: false,
      send: (event) => {
        if (event.type === 'caption' && event.text) captions.push(event.text);
      },
    });

    await vi.waitFor(() => {
      expect(getSubscriberStats('ch-stt-coalesce').byLanguage.en).toBe(1);
    });

    enqueueOwnerPcm('ch-stt-coalesce', 'user-1', loudPcm(100), 16000);
    await vi.waitFor(() => {
      expect(transcribeAudio).toHaveBeenCalledTimes(1);
    });

    // These would previously pile up and get drained after backoff.
    enqueueOwnerPcm('ch-stt-coalesce', 'user-1', loudPcm(200), 16000);
    enqueueOwnerPcm('ch-stt-coalesce', 'user-1', loudPcm(300), 16000);

    await vi.advanceTimersByTimeAsync(15_000);
    await vi.waitFor(() => {
      expect(transcribeAudio).toHaveBeenCalledTimes(2);
    });
    releaseStt?.();

    await vi.waitFor(() => {
      expect(captions).toContain('latest-only');
    });
    expect(transcribeAudio).toHaveBeenCalledTimes(2);
    unsub();
  });

  it('coalesces translate backlog after a 429 and retries the latest segment', async () => {
    vi.useFakeTimers();
    const captions: string[] = [];
    const errors: string[] = [];
    vi.mocked(translateLiveCaptionText)
      .mockRejectedValueOnce(new Error('OpenRouter translate error (429): rate limited'))
      .mockResolvedValue('hola-latest');
    vi.mocked(transcribeAudio).mockResolvedValueOnce('one').mockResolvedValue('three');

    const unsub = subscribePublicListener({
      channelId: 'ch-tr-429',
      userId: 'user-1',
      language: 'es',
      wantAudio: false,
      send: (event) => {
        if (event.type === 'caption' && event.text) captions.push(event.text);
        if (event.type === 'error' && event.message) errors.push(event.message);
      },
    });

    await vi.waitFor(() => {
      expect(getSubscriberStats('ch-tr-429').byLanguage.es).toBe(1);
    });

    enqueueOwnerPcm('ch-tr-429', 'user-1', loudPcm(3200), 16000);
    await vi.waitFor(() => {
      expect(translateLiveCaptionText).toHaveBeenCalledTimes(1);
    });
    expect(errors.some((m) => /rate-limited/i.test(m))).toBe(true);

    // Another live chunk while translate is paused.
    enqueueOwnerPcm('ch-tr-429', 'user-1', loudPcm(3200), 16000);
    await vi.waitFor(() => {
      expect(transcribeAudio).toHaveBeenCalledTimes(2);
    });

    await vi.advanceTimersByTimeAsync(20_000);
    await vi.waitFor(() => {
      expect(captions).toContain('hola-latest');
    });

    expect(translateLiveCaptionText).toHaveBeenCalledTimes(2);
    expect(vi.mocked(translateLiveCaptionText).mock.calls[1]?.[0]?.text).toBe('three');
    unsub();
  });

  it('opens and closes Soniox streams per active listen language only while ingest is live', async () => {
    const closed: string[] = [];
    createStreamingAsrSession.mockImplementation(
      async (_provider: string, options: { targetLanguage?: string }) => {
        const label = options.targetLanguage ?? 'source';
        return {
          writePcm: vi.fn(),
          close: vi.fn(async () => {
            closed.push(label);
          }),
        };
      }
    );

    vi.mocked(getRuntimeSecretsForUser).mockResolvedValue({
      sttProvider: 'soniox',
      textTranslateProvider: null,
      openRouterApiKey: null,
      groqApiKey: null,
      deepgramApiKey: null,
      assemblyaiApiKey: null,
      gladiaApiKey: null,
      speechmaticsApiKey: null,
      sonioxApiKey: 'sx-test',
      gcpServiceAccountJson: null,
      sttModel: null,
      openRouterTranslateModel: null,
      gcpTtsVoices: {},
      sourceLanguage: 'en',
      enabledLanguages: ['es', 'fr'],
      translationReady: true,
      listenReady: false,
    } as Awaited<ReturnType<typeof getRuntimeSecretsForUser>>);

    const unsubEs = subscribePublicListener({
      channelId: 'ch-soniox',
      userId: 'user-1',
      language: 'es',
      wantAudio: false,
      send: () => undefined,
    });
    const unsubFr = subscribePublicListener({
      channelId: 'ch-soniox',
      userId: 'user-1',
      language: 'fr',
      wantAudio: false,
      send: () => undefined,
    });

    await Promise.resolve();
    await Promise.resolve();
    // Listeners alone must not open billable Soniox sockets.
    expect(createStreamingAsrSession).not.toHaveBeenCalled();

    enqueueOwnerPcm('ch-soniox', 'user-1', loudPcm(3200), 16000);

    await vi.waitFor(() => {
      expect(createStreamingAsrSession).toHaveBeenCalledTimes(2);
    });

    expect(createStreamingAsrSession).toHaveBeenCalledWith(
      'soniox',
      expect.objectContaining({ targetLanguage: 'es' })
    );
    expect(createStreamingAsrSession).toHaveBeenCalledWith(
      'soniox',
      expect.objectContaining({ targetLanguage: 'fr' })
    );

    unsubEs();
    await vi.waitFor(() => {
      expect(closed).toContain('es');
    });
    expect(closed).not.toContain('fr');

    unsubFr();
    await vi.waitFor(() => {
      expect(closed).toContain('fr');
    });
  });

  it('opens Deepgram only while listeners are present and closes when the last leaves', async () => {
    const writePcm = vi.fn();
    const close = vi.fn(async () => undefined);
    createStreamingAsrSession.mockResolvedValue({ writePcm, close });

    vi.mocked(getRuntimeSecretsForUser).mockResolvedValue({
      sttProvider: 'deepgram',
      textTranslateProvider: 'openrouter',
      openRouterApiKey: 'key',
      groqApiKey: null,
      deepgramApiKey: 'dg-test',
      assemblyaiApiKey: null,
      gladiaApiKey: null,
      speechmaticsApiKey: null,
      sonioxApiKey: null,
      gcpServiceAccountJson: null,
      sttModel: null,
      openRouterTranslateModel: 'tr',
      gcpTtsVoices: {},
      sourceLanguage: 'en',
      enabledLanguages: ['es'],
      translationReady: true,
      listenReady: false,
    } as Awaited<ReturnType<typeof getRuntimeSecretsForUser>>);

    enqueueOwnerPcm('ch-dg', 'user-1', loudPcm(3200), 16000);
    await Promise.resolve();
    await Promise.resolve();
    expect(createStreamingAsrSession).not.toHaveBeenCalled();

    const unsub = subscribePublicListener({
      channelId: 'ch-dg',
      userId: 'user-1',
      language: 'en',
      wantAudio: false,
      send: () => undefined,
    });

    enqueueOwnerPcm('ch-dg', 'user-1', loudPcm(3200), 16000);
    await vi.waitFor(() => {
      expect(createStreamingAsrSession).toHaveBeenCalledWith(
        'deepgram',
        expect.objectContaining({ apiKey: 'dg-test' })
      );
    });
    await vi.waitFor(() => {
      expect(writePcm).toHaveBeenCalled();
    });

    unsub();
    await vi.waitFor(() => {
      expect(close).toHaveBeenCalled();
    });
  });
});
