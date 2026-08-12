'use client';

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
} from 'react';
import { Volume2 } from 'lucide-react';
import type { LiveTranslationPublicMeta } from '@/types';
import { TranslationLanguageCombobox } from '@/components/translation/TranslationLanguageCombobox';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  normalizeTranslationLanguageCode,
  resolveTranslationLanguageOption,
} from '@/lib/translation/languages';
import {
  readListenLanguagePreference,
  writeListenLanguagePreference,
} from '@/lib/translation/listen-language-preference';
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock';
import {
  ensureKeepAliveMediaElementSource,
  startListenKeepAliveAudio,
  stopListenKeepAliveAudio,
  syncListenMediaSession,
} from '@/lib/translation/listen-background-audio';

type CaptionLine = {
  id: string;
  text: string;
  ts: number;
};

/**
 * Subscribes to public SSE captions (and optional TTS audio) for one language.
 * @param props - Stream props including language and wantAudio.
 * @returns Caption list UI for the selected language.
 */
function CaptionStream({
  slug,
  language,
  live,
  wantAudio,
  audioAvailable,
  sourcePassthrough,
  onLiveChange,
  onMuteSpokenAudio,
  audioUnlockRef,
}: {
  slug: string;
  language: string;
  live: boolean;
  wantAudio: boolean;
  audioAvailable: boolean;
  /** When true, play live `source_pcm` via Web Audio instead of TTS clips. */
  sourcePassthrough: boolean;
  onLiveChange: (live: boolean) => void;
  /** Called when system media controls pause/stop spoken audio. */
  onMuteSpokenAudio: () => void;
  /** Parent speaker control calls this inside the click gesture to unlock playback. */
  audioUnlockRef: MutableRefObject<(() => void) | null>;
}) {
  const [lines, setLines] = useState<CaptionLine[]>([]);
  const [partial, setPartial] = useState('');
  const [streamError, setStreamError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const keepAliveRef = useRef<HTMLAudioElement | null>(null);
  const keepAliveSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);
  const seenSegmentIdsRef = useRef<Set<string>>(new Set());
  const queuedAudioUrlsRef = useRef<Set<string>>(new Set());
  const prefetchRef = useRef<Map<string, Promise<string>>>(new Map());
  const objectUrlRef = useRef<string | null>(null);
  const ignoreAudioErrorRef = useRef(false);

  const muteSpokenAudio = useEffectEvent(() => {
    onMuteSpokenAudio();
  });

  const resumeKeepAlivePlayback = useEffectEvent(() => {
    const keepAlive = keepAliveRef.current;
    if (keepAlive) startListenKeepAliveAudio(keepAlive);
    void audioCtxRef.current?.resume().catch(() => undefined);
    syncListenMediaSession(true, muteSpokenAudio, resumeKeepAlivePlayback);
  });

  /** Tiny silent WAV used only to unlock HTMLAudioElement inside a user gesture. */
  const SILENT_WAV =
    'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAAAA==';

  useEffect(() => {
    const prefetches = prefetchRef.current;
    const keepAlive = keepAliveRef.current;
    return () => {
      stopListenKeepAliveAudio(keepAlive);
      syncListenMediaSession(false, () => undefined);
      void audioCtxRef.current?.close().catch(() => undefined);
      audioCtxRef.current = null;
      keepAliveSourceRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      for (const pending of prefetches.values()) {
        void pending.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
      }
      prefetches.clear();
    };
  }, []);

  /**
   * Stops TTS playback and drops queued / prefetched clips.
   */
  function stopSpokenAudio(): void {
    audioQueueRef.current = [];
    queuedAudioUrlsRef.current = new Set();
    playingRef.current = false;
    for (const pending of prefetchRef.current.values()) {
      void pending.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
    }
    prefetchRef.current.clear();
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    const audio = audioRef.current;
    if (!audio) return;
    try {
      ignoreAudioErrorRef.current = true;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch {
      // ignore
    } finally {
      ignoreAudioErrorRef.current = false;
    }
  }

  useEffect(() => {
    if (!wantAudio || !audioAvailable) {
      stopSpokenAudio();
      stopListenKeepAliveAudio(keepAliveRef.current);
      syncListenMediaSession(false, muteSpokenAudio);
      nextPlayTimeRef.current = 0;
      void audioCtxRef.current?.suspend().catch(() => undefined);
      return;
    }
    resumeKeepAlivePlayback();
  }, [wantAudio, audioAvailable]);

  // Chrome freezes tabs soon after screen-off unless HTML media is actively playing.
  // Resume keepalive + AudioContext when the page becomes visible again.
  useEffect(() => {
    if (!wantAudio || !audioAvailable) return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') resumeKeepAlivePlayback();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', resumeKeepAlivePlayback);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', resumeKeepAlivePlayback);
    };
  }, [wantAudio, audioAvailable]);

  /**
   * Ensures a running AudioContext for source-language PCM passthrough.
   * @returns AudioContext, or null if creation failed.
   */
  function ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AC();
      nextPlayTimeRef.current = 0;
      keepAliveSourceRef.current = null;
    }
    const ctx = audioCtxRef.current;
    const keepAlive = keepAliveRef.current;
    if (keepAlive) {
      keepAliveSourceRef.current = ensureKeepAliveMediaElementSource(
        ctx,
        keepAlive,
        keepAliveSourceRef.current
      );
    }
    return ctx;
  }

  /**
   * Prefetches a TTS clip into a blob object URL.
   * @param url - Public audio API path.
   */
  function prefetchAudioUrl(url: string): void {
    if (prefetchRef.current.has(url)) return;
    const job = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Audio HTTP ${res.status}`);
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    })();
    prefetchRef.current.set(url, job);
    void job.catch(() => {
      prefetchRef.current.delete(url);
    });
  }

  useEffect(() => {
    audioUnlockRef.current = () => {
      // Must start HTML media in this user gesture so Android grants audio focus
      // when the screen locks (Web Audio alone is frozen after a few seconds).
      const keepAlive = keepAliveRef.current;
      if (keepAlive) startListenKeepAliveAudio(keepAlive);
      syncListenMediaSession(true, muteSpokenAudio, resumeKeepAlivePlayback);

      if (sourcePassthrough) {
        const ctx = ensureAudioContext();
        void ctx?.resume().catch(() => undefined);
        return;
      }
      // HTMLAudioElement autoplay unlock requires a successful play() in this gesture.
      // Empty src fails; a silent data-URI succeeds and unlocks later TTS clips.
      const audio = audioRef.current;
      if (!audio) return;
      ignoreAudioErrorRef.current = true;
      audio.src = SILENT_WAV;
      void audio
        .play()
        .then(() => {
          audio.pause();
          audio.removeAttribute('src');
          audio.load();
        })
        .catch(() => undefined)
        .finally(() => {
          ignoreAudioErrorRef.current = false;
        });
    };
    return () => {
      audioUnlockRef.current = null;
    };
  }, [audioUnlockRef, sourcePassthrough]);

  /** Schedules live source PCM using the latest wantAudio / passthrough flags. */
  const schedulePcmBase64 = useEffectEvent((pcmBase64: string, sampleRate: number): void => {
    if (!wantAudio || !sourcePassthrough) return;
    const ctx = ensureAudioContext();
    if (!ctx) return;
    void ctx.resume().catch(() => undefined);

    const binary = atob(pcmBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    const sampleCount = Math.floor(bytes.byteLength / 2);
    if (sampleCount < 1) return;

    const buffer = ctx.createBuffer(1, sampleCount, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      channel[i] = view.getInt16(i * 2, true) / 32768;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.02, nextPlayTimeRef.current);
    source.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;
  });

  /** Plays the next queued TTS clip (blob object URL) using latest mute flags. */
  const playNextTts = useEffectEvent(async (): Promise<void> => {
    if (!wantAudio || sourcePassthrough) {
      stopSpokenAudio();
      return;
    }
    if (playingRef.current) return;
    const next = audioQueueRef.current.shift();
    if (!next) return;
    playingRef.current = true;
    const upcoming = audioQueueRef.current[0];
    if (upcoming) prefetchAudioUrl(upcoming);

    const audio = audioRef.current;
    if (!audio) {
      playingRef.current = false;
      return;
    }

    try {
      prefetchAudioUrl(next);
      const prefetch = prefetchRef.current.get(next);
      const objectUrl = prefetch ? await prefetch : null;
      prefetchRef.current.delete(next);
      if (!objectUrl) throw new Error('Missing audio prefetch');
      if (!wantAudio || sourcePassthrough) {
        URL.revokeObjectURL(objectUrl);
        playingRef.current = false;
        return;
      }

      ignoreAudioErrorRef.current = true;
      try {
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = null;
        }
        audio.pause();
        objectUrlRef.current = objectUrl;
        audio.src = objectUrl;
      } finally {
        await Promise.resolve();
        ignoreAudioErrorRef.current = false;
      }
      await audio.play();
    } catch {
      playingRef.current = false;
      ignoreAudioErrorRef.current = false;
      if (!wantAudio || sourcePassthrough) return;
      setStreamError('Spoken audio failed to play. Tap the speaker again, then keep listening.');
      // Continue with the next queued clip without recursively calling this Effect Event.
      if (audioQueueRef.current.length > 0) {
        queueMicrotask(() => {
          void playNextTts();
        });
      }
    }
  });

  /** Queues a TTS clip URL once (hub may re-send the same caption with audio later). */
  const enqueueSpokenUrl = useEffectEvent((url: string): void => {
    if (!wantAudio || sourcePassthrough) return;
    if (queuedAudioUrlsRef.current.has(url)) return;
    queuedAudioUrlsRef.current.add(url);
    audioQueueRef.current.push(url);
    prefetchAudioUrl(url);
    const upcoming = audioQueueRef.current[1];
    if (upcoming) prefetchAudioUrl(upcoming);
    void playNextTts();
  });

  /** Handles one SSE payload with latest live / audio prefs. */
  const onStreamMessage = useEffectEvent((raw: string): void => {
    try {
      const data = JSON.parse(raw) as {
        type?: string;
        text?: string;
        segmentId?: string;
        ts?: number;
        live?: boolean;
        audioUrl?: string;
        pcmBase64?: string;
        sampleRate?: number;
        message?: string;
      };
      if (data.type === 'status' && typeof data.live === 'boolean') {
        onLiveChange(data.live);
        return;
      }
      if (data.type === 'error' && data.message) {
        setStreamError(data.message);
        return;
      }
      if (data.type === 'source_pcm' && typeof data.pcmBase64 === 'string') {
        const rate =
          typeof data.sampleRate === 'number' && data.sampleRate > 0 ? data.sampleRate : 16000;
        schedulePcmBase64(data.pcmBase64, rate);
        return;
      }
      // Hub delivers spoken TTS as caption events with `audioUrl` (not a separate `tts` type).
      if (data.type === 'caption' && typeof data.text === 'string' && data.segmentId) {
        if (seenSegmentIdsRef.current.has(data.segmentId)) {
          setLines((prev) =>
            prev.map((line) =>
              line.id === data.segmentId
                ? { ...line, text: data.text!, ts: data.ts ?? line.ts }
                : line
            )
          );
          setPartial('');
        } else {
          seenSegmentIdsRef.current.add(data.segmentId);
          setLines((prev) =>
            [...prev, { id: data.segmentId!, text: data.text!, ts: data.ts ?? Date.now() }].slice(
              -80
            )
          );
          setPartial('');
        }
        if (data.audioUrl) enqueueSpokenUrl(data.audioUrl);
        return;
      }
      // Streaming partials without a stable segment id (rare) — show as interim text.
      if (data.type === 'caption' && typeof data.text === 'string') {
        setPartial(data.text);
      }
    } catch {
      /* ignore malformed */
    }
  });

  useEffect(() => {
    let closed = false;
    const params = new URLSearchParams({ language });
    if (wantAudio && audioAvailable) params.set('wantAudio', '1');
    const es = new EventSource(
      `/api/translation/public/${encodeURIComponent(slug)}/events?${params}`
    );
    es.onmessage = (ev) => {
      onStreamMessage(ev.data);
    };
    es.onerror = () => {
      // Ignore teardown / intentional close (language change, unmount).
      if (closed) return;
      if (es.readyState === EventSource.CLOSED) {
        setStreamError('Connection lost. Refresh to try again.');
        return;
      }
      setStreamError('Connection interrupted — reconnecting…');
    };
    es.onopen = () => {
      if (!closed) setStreamError(null);
    };

    if (audioRef.current) {
      audioRef.current.onended = () => {
        playingRef.current = false;
        void playNextTts();
      };
      audioRef.current.onerror = () => {
        if (ignoreAudioErrorRef.current) return;
        playingRef.current = false;
        if (!wantAudio || sourcePassthrough) {
          stopSpokenAudio();
          return;
        }
        setStreamError(
          'Spoken audio clip was missing or expired. Keep listening for the next line.'
        );
        void playNextTts();
      };
    }

    return () => {
      closed = true;
      es.close();
      if (!(wantAudio && audioAvailable)) {
        stopSpokenAudio();
      }
      nextPlayTimeRef.current = 0;
    };
  }, [slug, language, wantAudio, audioAvailable, sourcePassthrough]);

  const listRef = useRef<HTMLOListElement>(null);
  const latestRef = useRef<HTMLLIElement>(null);
  /** When true, new captions keep the latest line pinned near mid-viewport. */
  const followLatestRef = useRef(true);
  const [followPadPx, setFollowPadPx] = useState(0);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const syncPad = () => {
      setFollowPadPx(Math.round(list.clientHeight * 0.5));
    };
    syncPad();
    const ro = new ResizeObserver(syncPad);
    ro.observe(list);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onScroll = () => {
      // Follow zone ≈ mid-screen pin: leave ~half the list height below the live edge.
      const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
      followLatestRef.current = distanceFromBottom < list.clientHeight * 0.55;
    };
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => list.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!followLatestRef.current) return;
    latestRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [lines, partial, followPadPx]);

  const lastLineId = lines.length > 0 ? lines[lines.length - 1]!.id : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {streamError ? <p className="text-muted-foreground text-xs">{streamError}</p> : null}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- captions rendered as page text */}
      <audio ref={audioRef} className="hidden" playsInline preload="auto" />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- silent loop for Android audio focus */}
      <audio ref={keepAliveRef} className="hidden" playsInline loop preload="auto" />
      <ol ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {lines.length === 0 && !partial && live ? (
          <li className="text-muted-foreground text-sm">
            Listening… captions appear as speech is detected.
          </li>
        ) : null}
        {lines.length === 0 && !partial && !live ? (
          <li className="text-muted-foreground text-sm">Waiting for the next live segment.</li>
        ) : null}
        {lines.map((line) => (
          <li
            key={line.id}
            ref={line.id === lastLineId && !partial ? latestRef : undefined}
            className="text-lg leading-snug"
          >
            {line.text}
          </li>
        ))}
        {partial ? (
          <li ref={latestRef} className="text-muted-foreground text-lg leading-snug italic">
            {partial}
          </li>
        ) : null}
        {/* Spacer so the live edge can sit at mid-viewport instead of the bottom edge. */}
        <li
          aria-hidden="true"
          className="pointer-events-none shrink-0 list-none"
          style={{ height: followPadPx }}
        />
      </ol>
    </div>
  );
}

/**
 * Public listen UI: language picker, live captions, optional spoken audio when configured.
 * @param props - Public channel meta from the server.
 * @returns Listen page client UI.
 */
export function PublicListenClient({ meta }: { meta: LiveTranslationPublicMeta }) {
  const languageOptions = useMemo(() => {
    const codes = [...new Set([meta.sourceLanguage, ...meta.enabledLanguages])];
    return codes
      .map((code) => resolveTranslationLanguageOption(code))
      .filter((o): o is NonNullable<typeof o> => Boolean(o));
  }, [meta.sourceLanguage, meta.enabledLanguages]);

  // Client-only: SSR/hydration stay null; localStorage applies after mount without an effect setState.
  const isClient = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false
  );
  const restoredLanguage = useMemo(() => {
    if (!isClient) return null;
    const allowed = new Set(
      [meta.sourceLanguage, ...meta.enabledLanguages].map((c) =>
        normalizeTranslationLanguageCode(c)
      )
    );
    const saved = readListenLanguagePreference(meta.slug);
    const fromStore = saved ? normalizeTranslationLanguageCode(saved) : null;
    return fromStore && allowed.has(fromStore) ? fromStore : null;
  }, [isClient, meta.slug, meta.sourceLanguage, meta.enabledLanguages]);

  const [languageSelection, setLanguageSelection] = useState<{
    slug: string;
    code: string;
  } | null>(null);
  const language =
    languageSelection?.slug === meta.slug ? languageSelection.code : restoredLanguage;
  const setLanguage = (code: string) => {
    setLanguageSelection({ slug: meta.slug, code });
  };

  const [live, setLive] = useState(meta.live);
  const [wantAudioRequested, setWantAudioRequested] = useState(false);
  const audioUnlockRef = useRef<(() => void) | null>(null);

  // Keep the screen awake while live captions are on screen (HTTPS required).
  const { status: wakeLockStatus, armFromUserGesture: armScreenWakeLock } = useScreenWakeLock(
    Boolean(language && live)
  );

  // Re-arm on any tap if the browser needed a gesture or released the lock.
  useEffect(() => {
    if (!language || !live) return;
    const onInteract = () => armScreenWakeLock();
    window.addEventListener('pointerdown', onInteract, { capture: true });
    window.addEventListener('keydown', onInteract, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', onInteract, { capture: true });
      window.removeEventListener('keydown', onInteract, { capture: true });
    };
  }, [language, live, armScreenWakeLock]);

  useEffect(() => {
    writeListenLanguagePreference(meta.slug, language);
  }, [meta.slug, language]);

  const audioLanguages = meta.audioLanguages ?? [];
  const audioAvailableForLanguage = Boolean(
    language && audioLanguages.some((c) => normalizeTranslationLanguageCode(c) === language)
  );
  const wantAudio = wantAudioRequested && audioAvailableForLanguage;
  const sourcePassthrough = Boolean(
    language &&
    normalizeTranslationLanguageCode(language) ===
      normalizeTranslationLanguageCode(meta.sourceLanguage)
  );

  if (languageOptions.length === 0) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-4 py-10">
        <p className="text-muted-foreground text-center text-sm">
          No languages are configured for this channel.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-lg flex-col overflow-hidden px-4 py-6">
      <header className="mb-6 shrink-0 space-y-1">
        <p className="text-muted-foreground text-xs tracking-[0.2em] uppercase">VideoSphere</p>
        <h1 className="text-2xl font-semibold tracking-tight">Live audio translation</h1>
        {live ? (
          <p className="text-muted-foreground text-sm">Live now</p>
        ) : (
          <p className="text-muted-foreground text-sm">There is currently no audio input.</p>
        )}
      </header>

      <div className="mb-4 shrink-0 space-y-2">
        <Label htmlFor="listen-language">Language</Label>
        <div className="flex items-center gap-2">
          <TranslationLanguageCombobox
            id="listen-language"
            className="min-w-0 flex-1"
            listLabel="Available languages"
            labelStyle="public"
            options={languageOptions}
            value={language ?? ''}
            onValueChange={(next) => {
              armScreenWakeLock();
              setLanguage(next);
            }}
          />
          {language && audioAvailableForLanguage ? (
            <Button
              type="button"
              variant={wantAudio ? 'default' : 'outline'}
              size="icon"
              className="size-11 shrink-0"
              aria-pressed={wantAudio}
              aria-label={wantAudio ? 'Mute spoken audio' : 'Play spoken audio'}
              title={wantAudio ? 'Mute spoken audio' : 'Play spoken audio'}
              onClick={() => {
                armScreenWakeLock();
                const enabling = !wantAudioRequested;
                // Unlock must run in this click gesture (before React effects re-run).
                if (enabling) audioUnlockRef.current?.();
                setWantAudioRequested(enabling);
              }}
            >
              <Volume2 className="size-5" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        {!language ? (
          <p className="text-muted-foreground text-xs">Select a language to follow captions.</p>
        ) : !live ? (
          <p className="text-muted-foreground text-xs">
            Latest captions stay on screen. New lines appear when audio starts again.
          </p>
        ) : wantAudio ? (
          <div className="text-muted-foreground space-y-1 text-xs">
            <p>
              {sourcePassthrough
                ? 'Playing live source audio. With screen off, leave this tab open in Chrome.'
                : 'With screen off, leave this tab open in Chrome.'}
            </p>
            <p>
              On Samsung: Chrome → App info → Battery → Unrestricted (otherwise audio may stop after
              a few seconds).
            </p>
          </div>
        ) : null}
        {language && live && wakeLockStatus === 'insecure' ? (
          <div className="bg-muted/60 space-y-2 rounded-md px-3 py-2 text-xs">
            <p>
              This page is not HTTPS, so the screen cannot stay on (common when opening a LAN IP
              like <code className="text-[0.7rem]">http://192.168.…</code>).
            </p>
            <p className="text-muted-foreground">
              On the server, run <code className="text-[0.7rem]">pnpm dev:https</code>, then open
              this listen URL with <code className="text-[0.7rem]">https://</code> (accept the
              certificate warning once).
            </p>
          </div>
        ) : null}
      </div>

      {!language ? (
        <ol className="flex flex-1 flex-col gap-3 overflow-y-auto pb-8">
          <li className="text-muted-foreground text-sm">Choose a language above to start.</li>
        </ol>
      ) : (
        <CaptionStream
          key={language}
          slug={meta.slug}
          language={language}
          live={live}
          wantAudio={wantAudio}
          audioAvailable={audioAvailableForLanguage}
          sourcePassthrough={sourcePassthrough}
          onLiveChange={setLive}
          onMuteSpokenAudio={() => setWantAudioRequested(false)}
          audioUnlockRef={audioUnlockRef}
        />
      )}
    </div>
  );
}
