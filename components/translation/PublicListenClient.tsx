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
import { useRegisterListenNavControls } from '@/components/translation/ListenNavControlsProvider';
import { Button } from '@/components/ui/button';
import {
  normalizeTranslationLanguageCode,
  resolveTranslationLanguageOption,
} from '@/lib/translation/languages';
import { musicMarkerText } from '@/lib/translation/activity-marker';
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
import {
  playbackRateForLag,
  trimTtsQueueForLag,
  type TtsQueueItem,
} from '@/lib/translation/tts-sync';

type CaptionLine = {
  id: string;
  text: string;
  ts: number;
  /** Marker lines stand in for captions during singing/music. */
  kind?: 'caption' | 'marker';
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
  scrollRootRef,
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
  /** Page scroll container used for mid-viewport follow and “near bottom” detection. */
  scrollRootRef: MutableRefObject<HTMLElement | null>;
}) {
  const [lines, setLines] = useState<CaptionLine[]>([]);
  const [partial, setPartial] = useState('');
  const [streamError, setStreamError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const keepAliveRef = useRef<HTMLAudioElement | null>(null);
  const keepAliveSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioQueueRef = useRef<TtsQueueItem[]>([]);
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
      audio.playbackRate = 1;
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

  /**
   * Drops a queued clip's prefetch so skipped audio does not keep a blob URL alive.
   * @param url - Public audio API path.
   */
  function dropPrefetch(url: string): void {
    const pending = prefetchRef.current.get(url);
    prefetchRef.current.delete(url);
    queuedAudioUrlsRef.current.delete(url);
    if (!pending) return;
    void pending.then((objectUrl) => URL.revokeObjectURL(objectUrl)).catch(() => undefined);
  }

  /**
   * Applies lag-based trim: drops hopelessly stale queued clips, keeps captions.
   * @param nowMs - Wall-clock time used for lag.
   */
  function trimSpokenQueue(nowMs: number): void {
    const before = audioQueueRef.current;
    const after = trimTtsQueueForLag(before, nowMs);
    if (after.length === before.length) return;
    const kept = new Set(after.map((item) => item.url));
    for (const item of before) {
      if (!kept.has(item.url)) dropPrefetch(item.url);
    }
    audioQueueRef.current = after;
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

    trimSpokenQueue(Date.now());
    const next = audioQueueRef.current.shift();
    if (!next) return;
    playingRef.current = true;
    const upcoming = audioQueueRef.current[0];
    if (upcoming) prefetchAudioUrl(upcoming.url);

    const audio = audioRef.current;
    if (!audio) {
      playingRef.current = false;
      return;
    }

    try {
      prefetchAudioUrl(next.url);
      const prefetch = prefetchRef.current.get(next.url);
      const objectUrl = prefetch ? await prefetch : null;
      prefetchRef.current.delete(next.url);
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
        // Recover backlog without chipmunking: browsers default preservesPitch to true.
        audio.playbackRate = playbackRateForLag(Date.now() - next.sourceTs);
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

  /** Queues a TTS clip once (hub may re-send the same caption with audio later). */
  const enqueueSpokenUrl = useEffectEvent((url: string, sourceTs: number): void => {
    if (!wantAudio || sourcePassthrough) return;
    if (queuedAudioUrlsRef.current.has(url)) return;
    queuedAudioUrlsRef.current.add(url);
    audioQueueRef.current.push({
      url,
      sourceTs: Number.isFinite(sourceTs) ? sourceTs : Date.now(),
    });
    trimSpokenQueue(Date.now());
    prefetchAudioUrl(url);
    const upcoming = audioQueueRef.current[1];
    if (upcoming) prefetchAudioUrl(upcoming.url);
    void playNextTts();
  });

  /**
   * Records a speech/music transition.
   *
   * Entering music appends a marker line in the listener's own language so the pause
   * in captions reads as intentional rather than as a broken stream.
   * @param next - Activity reported by the hub.
   */
  function applyActivity(next: 'speech' | 'music'): void {
    if (next !== 'music') return;
    setPartial('');
    setLines((prev) => {
      if (prev[prev.length - 1]?.kind === 'marker') return prev;
      const ts = Date.now();
      return [
        ...prev,
        { id: `music-${ts}`, kind: 'marker' as const, text: musicMarkerText(language), ts },
      ].slice(-80);
    });
  }

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
        activity?: string;
      };
      if (data.activity === 'music' || data.activity === 'speech') {
        applyActivity(data.activity);
      }
      if (data.type === 'activity') return;
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
        if (data.audioUrl) enqueueSpokenUrl(data.audioUrl, data.ts ?? Date.now());
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

  const latestRef = useRef<HTMLLIElement>(null);
  /** When true, new captions keep the latest line pinned near mid-viewport. */
  const followLatestRef = useRef(true);
  /** Ignores scroll events while we are programmatically pinning the latest line. */
  const programmaticScrollRef = useRef(false);
  /** Debounced settle for programmatic scroll (shared across rapid caption updates). */
  const followScrollSettleTimerRef = useRef<number | null>(null);
  const [followPadPx, setFollowPadPx] = useState(0);
  const hasCaptions = lines.length > 0 || Boolean(partial);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    const syncPad = () => {
      // Only reserve mid-viewport space once there is a live line to pin.
      setFollowPadPx(hasCaptions ? Math.round(root.clientHeight * 0.5) : 0);
    };
    syncPad();
    const ro = new ResizeObserver(syncPad);
    ro.observe(root);
    return () => ro.disconnect();
  }, [scrollRootRef, hasCaptions]);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;

    const onScroll = () => {
      // Smooth scrollIntoView emits many intermediate scroll events; those must
      // not turn follow off before the pin finishes.
      if (programmaticScrollRef.current) return;
      // Mid-viewport follow leaves the bottom spacer in view — use a large
      // threshold so wrapped lines do not look like the user scrolled away.
      const distanceFromBottom = root.scrollHeight - root.scrollTop - root.clientHeight;
      const threshold = Math.max(120, Math.round(root.clientHeight * 0.55));
      followLatestRef.current = distanceFromBottom <= threshold;
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [scrollRootRef]);

  useEffect(() => {
    if (!followLatestRef.current) return;
    const root = scrollRootRef.current;
    const el = latestRef.current;
    if (!root || !el) return;

    programmaticScrollRef.current = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (followScrollSettleTimerRef.current !== null) {
      window.clearTimeout(followScrollSettleTimerRef.current);
    }
    // Debounce settle across rapid caption/partial updates so in-flight smooth
    // scroll events never clear the guard early and disable follow.
    followScrollSettleTimerRef.current = window.setTimeout(() => {
      followScrollSettleTimerRef.current = null;
      programmaticScrollRef.current = false;
      const distanceFromBottom = root.scrollHeight - root.scrollTop - root.clientHeight;
      const threshold = Math.max(120, Math.round(root.clientHeight * 0.55));
      followLatestRef.current = distanceFromBottom <= threshold;
    }, 450);
  }, [lines, partial, followPadPx, scrollRootRef]);

  useEffect(() => {
    return () => {
      if (followScrollSettleTimerRef.current !== null) {
        window.clearTimeout(followScrollSettleTimerRef.current);
        followScrollSettleTimerRef.current = null;
      }
      programmaticScrollRef.current = false;
    };
  }, []);

  const lastLineId = lines.length > 0 ? lines[lines.length - 1]!.id : null;

  return (
    <div className="flex flex-col gap-3">
      {streamError ? <p className="text-muted-foreground text-xs">{streamError}</p> : null}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- captions rendered as page text */}
      <audio ref={audioRef} className="hidden" playsInline preload="auto" />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- silent loop for Android audio focus */}
      <audio ref={keepAliveRef} className="hidden" playsInline loop preload="auto" />
      <ol className="flex flex-col gap-3">
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
            className={
              line.kind === 'marker'
                ? 'text-muted-foreground text-base leading-snug tracking-wide'
                : 'text-lg leading-snug'
            }
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
 * @param props - Public channel meta and optional SSR language from the preference cookie.
 * @returns Listen page client UI.
 */
export function PublicListenClient({
  meta,
  initialLanguage = null,
}: {
  meta: LiveTranslationPublicMeta;
  /**
   * Language restored from the preference cookie on the server so the first paint
   * matches the listener’s last choice (avoids a “Select a language…” flash).
   */
  initialLanguage?: string | null;
}) {
  const languageOptions = useMemo(() => {
    const codes = [...new Set([meta.sourceLanguage, ...meta.enabledLanguages])];
    return codes
      .map((code) => resolveTranslationLanguageOption(code))
      .filter((o): o is NonNullable<typeof o> => Boolean(o));
  }, [meta.sourceLanguage, meta.enabledLanguages]);

  const allowedLanguageCodes = useMemo(
    () =>
      new Set(
        [meta.sourceLanguage, ...meta.enabledLanguages].map((c) =>
          normalizeTranslationLanguageCode(c)
        )
      ),
    [meta.sourceLanguage, meta.enabledLanguages]
  );

  const [languageSelection, setLanguageSelection] = useState<{
    slug: string;
    code: string;
  } | null>(() => {
    if (!initialLanguage) return null;
    const code = normalizeTranslationLanguageCode(initialLanguage);
    return allowedLanguageCodes.has(code) ? { slug: meta.slug, code } : null;
  });

  // Migrate older localStorage-only prefs without setState-in-effect (cookie SSR is preferred).
  const storedLanguage = useSyncExternalStore(
    () => () => undefined,
    () => {
      const saved = readListenLanguagePreference(meta.slug);
      const code = saved ? normalizeTranslationLanguageCode(saved) : null;
      return code && allowedLanguageCodes.has(code) ? code : null;
    },
    () => null
  );

  const language = languageSelection?.slug === meta.slug ? languageSelection.code : storedLanguage;
  const setLanguage = (code: string) => {
    setLanguageSelection({ slug: meta.slug, code });
  };

  const [live, setLive] = useState(meta.live);
  const [wantAudioRequested, setWantAudioRequested] = useState(false);
  const audioUnlockRef = useRef<(() => void) | null>(null);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);

  // Keep the screen awake while live captions are on screen (HTTPS required).
  const { armFromUserGesture: armScreenWakeLock } = useScreenWakeLock(Boolean(language && live));

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

  useRegisterListenNavControls(
    languageOptions.length === 0
      ? null
      : {
          languageOptions,
          language: language ?? '',
          onLanguageChange: (next: string) => {
            armScreenWakeLock();
            setLanguage(next);
          },
          audioAvailable: audioAvailableForLanguage,
          wantAudio,
          onToggleAudio: () => {
            armScreenWakeLock();
            const enabling = !wantAudioRequested;
            if (enabling) audioUnlockRef.current?.();
            setWantAudioRequested(enabling);
          },
        }
  );

  if (languageOptions.length === 0) {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-lg flex-col justify-center px-4 py-10">
        <p className="text-muted-foreground text-center text-sm text-shadow-bg">
          No languages are configured for this channel.
        </p>
      </div>
    );
  }

  return (
    <div ref={scrollRootRef} className="flex h-full min-h-0 flex-col overflow-y-auto">
      {!live ? (
        <div
          role="status"
          aria-live="polite"
          className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-2.5 text-center text-sm font-medium text-foreground backdrop-blur-sm"
        >
          Not live — disconnected. Waiting for audio input.
        </div>
      ) : null}

      <header className="mx-auto w-full max-w-lg shrink-0 space-y-1 px-4 pt-6 pb-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Live audio translation
        </h1>
        {live ? <p className="text-muted-foreground text-sm text-shadow-bg">Live now</p> : null}
      </header>

      <div className="shrink-0 px-4 py-3">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-2">
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
        </div>
      </div>

      {/* flex-1 fills remaining viewport on first paint; taller caption lists still grow and scroll. */}
      <div className="mx-2 mb-2 mt-3 flex flex-1 flex-col rounded-xl border border-border bg-background/65 p-4 backdrop-blur-sm sm:mx-auto sm:w-full sm:max-w-lg">
        {language ? (
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
            scrollRootRef={scrollRootRef}
          />
        ) : null}
      </div>
    </div>
  );
}
