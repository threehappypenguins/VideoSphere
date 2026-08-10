import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetTranslationSessionsForTests,
  enqueueOwnerPcm,
  getSubscriberStats,
  subscribePublicListener,
} from '@/lib/translation/session-hub';
import { translateTextWithOpenRouter } from '@/lib/translation/openrouter-translate';
import { transcribeAudio } from '@/lib/translation/transcribe';

vi.mock('@/lib/repositories/live-translation-channels', () => ({
  getRuntimeSecretsForUser: vi.fn(async () => ({
    sttProvider: 'openrouter',
    openRouterApiKey: 'key',
    groqApiKey: null,
    gcpServiceAccountJson: null,
    sttModel: 'stt',
    openRouterTranslateModel: 'tr',
    gcpTtsVoice: null,
    sourceLanguage: 'en',
    enabledLanguages: ['es', 'fr'],
    translationReady: true,
    listenReady: false,
  })),
}));

vi.mock('@/lib/translation/openrouter-translate', () => ({
  translateTextWithOpenRouter: vi.fn(async () => 'hola'),
}));

vi.mock('@/lib/translation/transcribe', () => ({
  transcribeAudio: vi.fn(async () => 'hello'),
}));

vi.mock('@/lib/translation/gcp-tts', () => ({
  synthesizeSpeechWithGcp: vi.fn(async () => Buffer.alloc(0)),
}));

describe('translation session hub', () => {
  afterEach(() => {
    __resetTranslationSessionsForTests();
    vi.clearAllMocks();
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

    enqueueOwnerPcm('ch-en', 'user-1', Buffer.alloc(3200), 16000);

    await vi.waitFor(() => {
      expect(captions).toContain('hello');
    });

    expect(transcribeAudio).toHaveBeenCalled();
    expect(translateTextWithOpenRouter).not.toHaveBeenCalled();
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

    enqueueOwnerPcm('ch-switch', 'user-1', Buffer.alloc(3200), 16000);
    await vi.waitFor(() => {
      expect(esCaptions).toContain('hola');
    });
    expect(translateTextWithOpenRouter).toHaveBeenCalledTimes(1);

    unsubEs();

    const frCaptions: string[] = [];
    vi.mocked(translateTextWithOpenRouter).mockResolvedValueOnce('bonjour');
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

    enqueueOwnerPcm('ch-switch', 'user-1', Buffer.alloc(3200), 16000);
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

    enqueueOwnerPcm('ch-purge', 'user-1', Buffer.alloc(3200), 16000);
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
});
