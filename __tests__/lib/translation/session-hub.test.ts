import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/repositories/live-translation-channels', () => ({
  getRuntimeSecretsForUser: vi.fn(async () => ({
    sttProvider: 'deepgram',
    textTranslateProvider: 'openrouter',
    openRouterApiKey: 'key',
    groqApiKey: null,
    deepgramApiKey: 'dg-test',
    assemblyaiApiKey: null,
    gladiaApiKey: null,
    speechmaticsApiKey: null,
    sonioxApiKey: null,
    modulateApiKey: null,
    elevenLabsApiKey: null,
    gcpServiceAccountJson: null,
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
import { synthesizeSpeechWithGcp } from '@/lib/translation/gcp-tts';
import { translateLiveCaptionText } from '@/lib/translation/translate-text';
import { splitPcmFrames, synthesizeSinging, synthesizeSpeech } from '@/__tests__/utils/synth-audio';

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

/**
 * Feeds audio as 250 ms ingest frames, letting each chunk's async work settle.
 * @param channelId - Channel to ingest into.
 * @param pcm - Audio to push.
 * @returns Resolves once every frame has been processed.
 */
async function feedIngestFrames(channelId: string, pcm: Buffer): Promise<void> {
  for (const frame of splitPcmFrames(pcm)) {
    enqueueOwnerPcm(channelId, 'user-1', frame, 16000);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

type AsrOnEvent = (event: {
  kind: string;
  text?: string;
  language?: string;
  message?: string;
}) => void;

/**
 * Default Deepgram mock: each writePcm emits one final transcript.
 * @param text - Fixed transcript, or factory for sequential values.
 * @returns The writePcm spy for call-count assertions.
 */
function mockStreamingFinals(text: string | (() => string | Promise<string>) = 'hello') {
  const writePcm = vi.fn();
  createStreamingAsrSession.mockImplementation(
    async (_provider: string, options: { onEvent: AsrOnEvent }) => {
      writePcm.mockImplementation(() => {
        void Promise.resolve(typeof text === 'function' ? text() : text).then((resolved) => {
          if (!resolved) return;
          options.onEvent({ kind: 'final', text: resolved, language: 'en' });
        });
      });
      return {
        writePcm,
        close: vi.fn(async () => undefined),
      };
    }
  );
  return writePcm;
}

/** Default channel configuration: streaming Deepgram STT with OpenRouter translate. */
const STREAMING_SECRETS = {
  sttProvider: 'deepgram',
  textTranslateProvider: 'openrouter',
  openRouterApiKey: 'key',
  groqApiKey: null,
  deepgramApiKey: 'dg-test',
  assemblyaiApiKey: null,
  gladiaApiKey: null,
  speechmaticsApiKey: null,
  sonioxApiKey: null,
  modulateApiKey: null,
  elevenLabsApiKey: null,
  gcpServiceAccountJson: null,
  openRouterTranslateModel: 'tr',
  gcpTtsVoices: {},
  sourceLanguage: 'en',
  enabledLanguages: ['es', 'fr'],
  translationReady: true,
  listenReady: false,
} as Awaited<ReturnType<typeof getRuntimeSecretsForUser>>;

describe('translation session hub', () => {
  beforeEach(() => {
    // `clearAllMocks` keeps implementations, so a provider set by one test would
    // otherwise leak into every test after it.
    vi.mocked(getRuntimeSecretsForUser).mockResolvedValue(STREAMING_SECRETS);
    mockStreamingFinals('hello');
  });

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

    expect(createStreamingAsrSession).toHaveBeenCalled();
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
    expect(createStreamingAsrSession).not.toHaveBeenCalled();
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
    expect(createStreamingAsrSession).toHaveBeenCalled();
    unsub();
  });

  it('fans source_pcm to source listeners with wantAudio and never synthesizes TTS', async () => {
    vi.mocked(getRuntimeSecretsForUser).mockResolvedValue({
      ...STREAMING_SECRETS,
      gcpServiceAccountJson: '{"type":"service_account"}',
      // Legacy source voice must not trigger TTS for source listen.
      gcpTtsVoices: { en: 'en-US-Neural2-A', es: 'es-US-Neural2-A' },
      sourceLanguage: 'en',
      enabledLanguages: ['es'],
      translationReady: true,
      listenReady: true,
    } as Awaited<ReturnType<typeof getRuntimeSecretsForUser>>);

    const pcmEvents: Array<{ pcmBase64?: string; sampleRate?: number }> = [];
    const audioUrls: string[] = [];
    const unsub = subscribePublicListener({
      channelId: 'ch-source-pcm',
      userId: 'user-1',
      language: 'en',
      wantAudio: true,
      send: (event) => {
        if (event.type === 'source_pcm') {
          pcmEvents.push({ pcmBase64: event.pcmBase64, sampleRate: event.sampleRate });
        }
        if (event.type === 'caption' && event.audioUrl) {
          audioUrls.push(event.audioUrl);
        }
      },
    });

    const pcm = loudPcm(3200);
    enqueueOwnerPcm('ch-source-pcm', 'user-1', pcm, 16000);

    await vi.waitFor(() => {
      expect(pcmEvents.length).toBeGreaterThan(0);
    });
    expect(pcmEvents[0]?.pcmBase64).toBe(pcm.toString('base64'));
    expect(pcmEvents[0]?.sampleRate).toBe(16000);

    await vi.waitFor(() => {
      expect(createStreamingAsrSession).toHaveBeenCalled();
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(synthesizeSpeechWithGcp).not.toHaveBeenCalled();
    expect(audioUrls).toEqual([]);
    unsub();
  });

  it('does not fan source_pcm when wantAudio is false', async () => {
    const pcmEvents: unknown[] = [];
    const unsub = subscribePublicListener({
      channelId: 'ch-source-silent',
      userId: 'user-1',
      language: 'en',
      wantAudio: false,
      send: (event) => {
        if (event.type === 'source_pcm') pcmEvents.push(event);
      },
    });

    enqueueOwnerPcm('ch-source-silent', 'user-1', loudPcm(3200), 16000);
    await vi.waitFor(() => {
      expect(createStreamingAsrSession).toHaveBeenCalled();
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(pcmEvents).toEqual([]);
    unsub();
  });

  it('closes upstream ASR when ingest is stopped', async () => {
    const writePcm = mockStreamingFinals('hello');
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
    await vi.waitFor(() => {
      expect(writePcm).toHaveBeenCalled();
    });

    const sessionResult = await createStreamingAsrSession.mock.results[0]!.value;
    markIngestStopped('ch-stop');
    await vi.waitFor(() => {
      expect(sessionResult.close).toHaveBeenCalled();
    });
    expect(getSubscriberStats('ch-stop').live).toBe(false);
    unsub();
  });

  it('coalesces translate backlog after a 429 and retries the latest segment', async () => {
    vi.useFakeTimers();
    const captions: string[] = [];
    const errors: string[] = [];
    vi.mocked(translateLiveCaptionText)
      .mockRejectedValueOnce(new Error('OpenRouter translate error (429): rate limited'))
      .mockResolvedValue('hola-latest');
    let n = 0;
    mockStreamingFinals(() => {
      n += 1;
      return n === 1 ? 'one' : 'three';
    });

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
      expect(n).toBeGreaterThanOrEqual(2);
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
      modulateApiKey: null,
      elevenLabsApiKey: null,
      gcpServiceAccountJson: null,
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
      modulateApiKey: null,
      elevenLabsApiKey: null,
      gcpServiceAccountJson: null,
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
    // Last-listener leave closes ASR after a short grace (speaker-toggle reconnects).
    await vi.waitFor(
      () => {
        expect(close).toHaveBeenCalled();
      },
      { timeout: 3_000 }
    );
  });

  it('soft-reconnects Modulate Invalid input audio without toasting listeners', async () => {
    const errors: string[] = [];
    const captions: string[] = [];
    let firstOnEvent: ((event: { kind: string; message?: string; text?: string }) => void) | null =
      null;
    let openCount = 0;

    createStreamingAsrSession.mockImplementation(
      async (
        _provider: string,
        options: { onEvent: (event: { kind: string; message?: string; text?: string }) => void }
      ) => {
        openCount += 1;
        if (openCount === 1) firstOnEvent = options.onEvent;
        return {
          writePcm: vi.fn(),
          close: vi.fn(async () => undefined),
        };
      }
    );

    vi.mocked(getRuntimeSecretsForUser).mockResolvedValue({
      sttProvider: 'modulate',
      textTranslateProvider: 'openrouter',
      openRouterApiKey: 'key',
      groqApiKey: null,
      deepgramApiKey: null,
      assemblyaiApiKey: null,
      gladiaApiKey: null,
      speechmaticsApiKey: null,
      sonioxApiKey: null,
      modulateApiKey: 'mod-test',
      elevenLabsApiKey: null,
      gcpServiceAccountJson: null,
      openRouterTranslateModel: 'tr',
      gcpTtsVoices: {},
      sourceLanguage: 'en',
      enabledLanguages: ['en'],
      translationReady: true,
      listenReady: false,
    } as Awaited<ReturnType<typeof getRuntimeSecretsForUser>>);

    const unsub = subscribePublicListener({
      channelId: 'ch-mod-soft',
      userId: 'user-1',
      language: 'en',
      wantAudio: false,
      send: (event) => {
        if (event.type === 'error' && event.message) errors.push(event.message);
        if (event.type === 'caption' && event.text) captions.push(event.text);
      },
    });

    enqueueOwnerPcm('ch-mod-soft', 'user-1', loudPcm(3200), 16000);
    await vi.waitFor(() => {
      expect(firstOnEvent).not.toBeNull();
    });

    firstOnEvent!({ kind: 'error', message: 'Invalid input audio' });
    expect(errors).toEqual([]);

    enqueueOwnerPcm('ch-mod-soft', 'user-1', loudPcm(3200), 16000);
    await vi.waitFor(() => {
      expect(openCount).toBe(2);
    });

    const secondOpts = createStreamingAsrSession.mock.calls[1]?.[1] as {
      onEvent: (event: { kind: string; text?: string; language?: string }) => void;
    };
    secondOpts.onEvent({ kind: 'final', text: 'hello again', language: 'en' });
    await vi.waitFor(() => {
      expect(captions).toContain('hello again');
    });
    expect(errors).toEqual([]);

    unsub();
  });

  it('broadcasts streaming partials without segmentId so clients can revise interim text', async () => {
    const captions: Array<{ text?: string; segmentId?: string }> = [];
    let onEvent: ((event: { kind: string; text?: string; language?: string }) => void) | null =
      null;

    createStreamingAsrSession.mockImplementation(
      async (
        _provider: string,
        options: { onEvent: (event: { kind: string; text?: string; language?: string }) => void }
      ) => {
        onEvent = options.onEvent;
        return {
          writePcm: vi.fn(),
          close: vi.fn(async () => undefined),
        };
      }
    );

    vi.mocked(getRuntimeSecretsForUser).mockResolvedValue({
      sttProvider: 'assemblyai',
      textTranslateProvider: 'openrouter',
      openRouterApiKey: 'key',
      groqApiKey: null,
      deepgramApiKey: null,
      assemblyaiApiKey: 'aai-test',
      gladiaApiKey: null,
      speechmaticsApiKey: null,
      sonioxApiKey: null,
      modulateApiKey: null,
      elevenLabsApiKey: null,
      gcpServiceAccountJson: null,
      openRouterTranslateModel: 'tr',
      gcpTtsVoices: {},
      sourceLanguage: 'en',
      enabledLanguages: ['en'],
      translationReady: true,
      listenReady: false,
    } as Awaited<ReturnType<typeof getRuntimeSecretsForUser>>);

    const unsub = subscribePublicListener({
      channelId: 'ch-partial-id',
      userId: 'user-1',
      language: 'en',
      wantAudio: false,
      send: (event) => {
        if (event.type === 'caption' && event.text) {
          captions.push({ text: event.text, segmentId: event.segmentId });
        }
      },
    });

    enqueueOwnerPcm('ch-partial-id', 'user-1', loudPcm(3200), 16000);
    await vi.waitFor(() => {
      expect(onEvent).not.toBeNull();
    });

    onEvent!({ kind: 'partial', text: 'he said he would not because his fellow', language: 'en' });
    onEvent!({
      kind: 'partial',
      text: 'he said he would not because his fellow soldiers',
      language: 'en',
    });
    onEvent!({
      kind: 'final',
      text: 'He said he would not because his fellow soldiers.',
      language: 'en',
    });

    await vi.waitFor(() => {
      expect(captions.some((c) => c.text?.includes('fellow soldiers.'))).toBe(true);
    });

    const partials = captions.filter((c) => c.text && !c.text.endsWith('.'));
    expect(partials.length).toBeGreaterThanOrEqual(2);
    expect(partials.every((c) => c.segmentId === undefined)).toBe(true);

    const finals = captions.filter((c) => c.text?.endsWith('.'));
    expect(finals.some((c) => typeof c.segmentId === 'string' && c.segmentId.length > 0)).toBe(
      true
    );

    unsub();
  });

  it('stops STT and announces music once singing is detected', async () => {
    const activity: string[] = [];
    const unsub = subscribePublicListener({
      channelId: 'ch-music',
      userId: 'user-1',
      language: 'en',
      wantAudio: false,
      send: (event) => {
        if (event.type === 'activity' && event.activity) activity.push(event.activity);
      },
    });

    await vi.waitFor(() => {
      expect(getSubscriberStats('ch-music').totalSubscribers).toBe(1);
    });

    await feedIngestFrames('ch-music', synthesizeSinging(6000));
    expect(activity).toEqual(['music']);

    // ASR opened while the analysis window filled; nothing new once music is committed.
    const opensAtDetection = createStreamingAsrSession.mock.calls.length;
    expect(opensAtDetection).toBeGreaterThan(0);
    await feedIngestFrames('ch-music', synthesizeSinging(6000));
    expect(createStreamingAsrSession.mock.calls.length).toBe(opensAtDetection);

    unsub();
  });

  it('keeps fanning source audio to listeners during music', async () => {
    const pcmEvents: unknown[] = [];
    const unsub = subscribePublicListener({
      channelId: 'ch-music-audio',
      userId: 'user-1',
      language: 'en',
      wantAudio: true,
      send: (event) => {
        if (event.type === 'source_pcm') pcmEvents.push(event);
      },
    });

    await vi.waitFor(() => {
      expect(getSubscriberStats('ch-music-audio').totalSubscribers).toBe(1);
    });

    await feedIngestFrames('ch-music-audio', synthesizeSinging(6000));
    const duringMusic = pcmEvents.length;

    await feedIngestFrames('ch-music-audio', synthesizeSinging(2000));
    // Listeners must still hear the singing even though captions stopped.
    expect(pcmEvents.length).toBeGreaterThan(duringMusic);

    unsub();
  });

  it('resumes captions when speech returns after singing', async () => {
    const writePcm = mockStreamingFinals('hello');
    const activity: string[] = [];
    const unsub = subscribePublicListener({
      channelId: 'ch-music-end',
      userId: 'user-1',
      language: 'en',
      wantAudio: false,
      send: (event) => {
        if (event.type === 'activity' && event.activity) activity.push(event.activity);
      },
    });

    await vi.waitFor(() => {
      expect(getSubscriberStats('ch-music-end').totalSubscribers).toBe(1);
    });

    await feedIngestFrames('ch-music-end', synthesizeSinging(8000));
    expect(activity).toEqual(['music']);

    const callsDuringMusic = writePcm.mock.calls.length;
    await feedIngestFrames('ch-music-end', synthesizeSpeech(12000));

    expect(activity).toEqual(['music', 'speech']);
    expect(writePcm.mock.calls.length).toBeGreaterThan(callsDuringMusic);

    unsub();
  });

  it('tells a listener joining mid-song that music is playing', async () => {
    const first = subscribePublicListener({
      channelId: 'ch-music-join',
      userId: 'user-1',
      language: 'en',
      wantAudio: false,
      send: () => undefined,
    });

    await vi.waitFor(() => {
      expect(getSubscriberStats('ch-music-join').totalSubscribers).toBe(1);
    });
    await feedIngestFrames('ch-music-join', synthesizeSinging(6000));

    const statuses: Array<string | undefined> = [];
    const second = subscribePublicListener({
      channelId: 'ch-music-join',
      userId: 'user-1',
      language: 'es',
      wantAudio: false,
      send: (event) => {
        if (event.type === 'status') statuses.push(event.activity);
      },
    });

    expect(statuses).toEqual(['music']);

    first();
    second();
  });

  it('stops streaming audio upstream during music and replays pre-roll on resume', async () => {
    const writePcm = vi.fn();
    createStreamingAsrSession.mockResolvedValue({
      writePcm,
      close: vi.fn(async () => undefined),
    });
    vi.mocked(getRuntimeSecretsForUser).mockResolvedValue({
      ...STREAMING_SECRETS,
      sttProvider: 'deepgram',
      deepgramApiKey: 'dg-test',
      groqApiKey: null,
    } as Awaited<ReturnType<typeof getRuntimeSecretsForUser>>);

    const unsub = subscribePublicListener({
      channelId: 'ch-music-stream',
      userId: 'user-1',
      language: 'en',
      wantAudio: false,
      send: () => undefined,
    });

    await vi.waitFor(() => {
      expect(getSubscriberStats('ch-music-stream').totalSubscribers).toBe(1);
    });

    await feedIngestFrames('ch-music-stream', synthesizeSpeech(3000));
    expect(writePcm).toHaveBeenCalled();

    await feedIngestFrames('ch-music-stream', synthesizeSinging(6000));
    const writesDuringMusic = writePcm.mock.calls.length;
    await feedIngestFrames('ch-music-stream', synthesizeSinging(4000));
    expect(writePcm.mock.calls.length).toBe(writesDuringMusic);

    // Returning to speech flushes the retained pre-roll, so more than one frame's
    // worth of audio reaches the provider on the first speech chunk.
    await feedIngestFrames('ch-music-stream', synthesizeSpeech(8000));
    expect(writePcm.mock.calls.length).toBeGreaterThan(writesDuringMusic + 1);

    unsub();
  });

  it('clears the music state when ingest stops', async () => {
    const activity: string[] = [];
    const unsub = subscribePublicListener({
      channelId: 'ch-music-stop',
      userId: 'user-1',
      language: 'en',
      wantAudio: false,
      send: (event) => {
        if (event.type === 'activity' && event.activity) activity.push(event.activity);
      },
    });

    await vi.waitFor(() => {
      expect(getSubscriberStats('ch-music-stop').totalSubscribers).toBe(1);
    });

    await feedIngestFrames('ch-music-stop', synthesizeSinging(6000));
    expect(activity).toEqual(['music']);

    markIngestStopped('ch-music-stop');
    expect(activity).toEqual(['music', 'speech']);

    unsub();
  });
});
