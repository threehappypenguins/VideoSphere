'use client';

import {
  useCallback,
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
  captionFollowPinKey,
  isCaptionScrollTowardOlderContent,
  isNearCaptionLiveEdge,
  pinElementInScrollRoot,
} from '@/lib/translation/caption-follow';
import {
  playbackRateForLag,
  trimTtsQueueForLag,
  type TtsQueueItem,
} from '@/lib/translation/tts-sync';
import {
  appendCaptionFinal,
  appendCaptionMarker,
  applyCaptionInterim,
  captionSegmentCount,
  hasCaptionContent,
  lastCaptionSegmentId,
  updateCaptionSegment,
  type CaptionBlock,
} from '@/lib/translation/caption-flow';

/**
 * Random id for a new caption paragraph.
 * @returns Unique React key.
 */
function newCaptionBlockId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `blk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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
  const [blocks, setBlocks] = useState<CaptionBlock[]>([]);
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

  /** Stable across speaker toggles so SSE need not reconnect (reconnect bounces STT). */
  const listenerIdRef = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `listen-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

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
    const ts = Date.now();
    setBlocks((prev) =>
      appendCaptionMarker(prev, { id: `music-${ts}`, text: musicMarkerText(language), ts })
    );
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
      // Finals include `segmentId` (stable units). Partials omit it so ASR revisions update
      // interim text instead of rewriting committed text (words appearing then vanishing).
      // Both flow inside the same paragraph, so finalizing never re-flows what is on screen.
      if (data.type === 'caption' && typeof data.text === 'string' && data.segmentId) {
        setStreamError(null);
        const segmentId = data.segmentId;
        const text = data.text;
        const ts = data.ts ?? Date.now();
        if (seenSegmentIdsRef.current.has(segmentId)) {
          setBlocks((prev) => updateCaptionSegment(prev, { id: segmentId, text }));
        } else {
          seenSegmentIdsRef.current.add(segmentId);
          setBlocks((prev) =>
            appendCaptionFinal(prev, {
              id: segmentId,
              text,
              ts,
              now: Date.now(),
              blockId: newCaptionBlockId(),
            })
          );
        }
        if (data.audioUrl) enqueueSpokenUrl(data.audioUrl, ts);
        return;
      }
      // Streaming partials without a stable segment id — interim tail of the live paragraph.
      if (data.type === 'caption' && typeof data.text === 'string') {
        setStreamError(null);
        const text = data.text;
        const ts = data.ts ?? Date.now();
        setBlocks((prev) =>
          applyCaptionInterim(prev, {
            text,
            ts,
            now: Date.now(),
            blockId: newCaptionBlockId(),
          })
        );
      }
    } catch {
      /* ignore malformed */
    }
  });

  useEffect(() => {
    let closed = false;
    const params = new URLSearchParams({
      language,
      listenerId: listenerIdRef.current,
    });
    // Initial wantAudio only — later toggles use POST /want-audio so EventSource
    // (and upstream STT) stay up.
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
    // wantAudio intentionally omitted — toggling speaker must not bounce the SSE/STT socket.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
  }, [slug, language, audioAvailable, sourcePassthrough]);

  useEffect(() => {
    if (!audioAvailable) return;
    const controller = new AbortController();
    void fetch(`/api/translation/public/${encodeURIComponent(slug)}/want-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        listenerId: listenerIdRef.current,
        wantAudio,
      }),
    }).catch(() => {
      // Listener may not be subscribed yet on the first paint; EventSource carries initial wantAudio.
    });
    return () => controller.abort();
  }, [slug, language, wantAudio, audioAvailable]);

  /** Live edge to keep pinned: the interim tail when present, else the newest paragraph. */
  const latestRef = useRef<HTMLElement | null>(null);
  const setLatestElement = useCallback((el: HTMLElement | null) => {
    latestRef.current = el;
    // Guarded so detaching the previous live edge cannot clear the one just attached.
    return () => {
      if (latestRef.current === el) latestRef.current = null;
    };
  }, []);
  /** When true, new captions keep the latest line pinned near mid-viewport. */
  const followLatestRef = useRef(true);
  /** Ignores settle logic while we are programmatically pinning the latest line. */
  const programmaticScrollRef = useRef(false);
  /** Debounced settle for programmatic scroll (shared across rapid caption updates). */
  const followScrollSettleTimerRef = useRef<number | null>(null);
  /** Last pin identity — avoids re-scrolling on every partial text tick (mobile). */
  const lastFollowPinKeyRef = useRef<string | null>(null);
  /** Tracks scrollTop so upward gestures pause follow even mid smooth-pin. */
  const lastScrollTopRef = useRef(0);
  const [followPadPx, setFollowPadPx] = useState(0);
  const followPadPxRef = useRef(0);
  followPadPxRef.current = followPadPx;
  const hasCaptions = hasCaptionContent(blocks);
  const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1]! : null;
  const hasPartial = Boolean(lastBlock?.interim);
  const lastLineId = lastCaptionSegmentId(blocks);
  // Follow re-pins per finalized unit (as before), not per paragraph — paragraphs now
  // span many finals, so paragraph count alone would let the live edge drift away.
  const segmentCount = captionSegmentCount(blocks);

  const clearFollowScrollSettle = useEffectEvent(() => {
    if (followScrollSettleTimerRef.current !== null) {
      window.clearTimeout(followScrollSettleTimerRef.current);
      followScrollSettleTimerRef.current = null;
    }
    programmaticScrollRef.current = false;
  });

  /** User scrolled away from the live edge — stop yanking them back. */
  const pauseCaptionFollow = useEffectEvent(() => {
    clearFollowScrollSettle();
    followLatestRef.current = false;
  });

  /**
   * Pins the live caption inside the page scroll root (not via scrollIntoView).
   * @param force - When true, pin even if the pin key is unchanged (follow resumed).
   */
  const pinLiveCaption = useEffectEvent((force = false) => {
    if (!followLatestRef.current) return;
    const root = scrollRootRef.current;
    const el = latestRef.current;
    if (!root || !el) return;

    const pinKey = captionFollowPinKey(segmentCount, lastLineId, hasPartial);
    if (!force && lastFollowPinKeyRef.current === pinKey) return;
    lastFollowPinKeyRef.current = pinKey;

    programmaticScrollRef.current = true;
    pinElementInScrollRoot(root, el, 'smooth');

    if (followScrollSettleTimerRef.current !== null) {
      window.clearTimeout(followScrollSettleTimerRef.current);
    }
    followScrollSettleTimerRef.current = window.setTimeout(() => {
      followScrollSettleTimerRef.current = null;
      programmaticScrollRef.current = false;
      lastScrollTopRef.current = root.scrollTop;
      if (!followLatestRef.current) return;
      followLatestRef.current = isNearCaptionLiveEdge(
        root.scrollHeight - root.scrollTop - root.clientHeight,
        followPadPxRef.current
      );
    }, 320);
  });

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
    lastScrollTopRef.current = root.scrollTop;

    const distanceFromBottom = () => root.scrollHeight - root.scrollTop - root.clientHeight;

    const onScroll = () => {
      const nextTop = root.scrollTop;
      const scrolledTowardOlder = isCaptionScrollTowardOlderContent(
        lastScrollTopRef.current,
        nextTop
      );
      lastScrollTopRef.current = nextTop;

      // Upward scroll always belongs to the user — even during a smooth pin.
      if (scrolledTowardOlder) {
        pauseCaptionFollow();
        return;
      }

      if (programmaticScrollRef.current) return;

      const near = isNearCaptionLiveEdge(distanceFromBottom(), followPadPxRef.current);
      if (near && !followLatestRef.current) {
        followLatestRef.current = true;
        lastFollowPinKeyRef.current = null;
        pinLiveCaption(true);
        return;
      }
      followLatestRef.current = near;
    };

    // Finger-down cancels an in-flight pin so mobile flings are not eaten.
    const onTouchStart = () => {
      if (programmaticScrollRef.current) {
        pauseCaptionFollow();
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        pauseCaptionFollow();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'ArrowUp' ||
        event.key === 'PageUp' ||
        event.key === 'Home' ||
        (event.key === ' ' && event.shiftKey)
      ) {
        pauseCaptionFollow();
      }
    };

    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('wheel', onWheel, { passive: true });
    root.addEventListener('keydown', onKeyDown);
    return () => {
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('keydown', onKeyDown);
    };
  }, [scrollRootRef]);

  useEffect(() => {
    pinLiveCaption(false);
  }, [segmentCount, lastLineId, hasPartial, followPadPx, scrollRootRef]);

  useEffect(() => {
    return () => {
      clearFollowScrollSettle();
    };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {streamError ? <p className="text-muted-foreground text-xs">{streamError}</p> : null}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- captions rendered as page text */}
      <audio ref={audioRef} className="hidden" playsInline preload="auto" />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- silent loop for Android audio focus */}
      <audio ref={keepAliveRef} className="hidden" playsInline loop preload="auto" />
      <ol className="flex flex-col gap-3">
        {!hasCaptions && live ? (
          <li className="text-muted-foreground text-sm">
            Listening… captions appear as speech is detected.
          </li>
        ) : null}
        {!hasCaptions && !live ? (
          <li className="text-muted-foreground text-sm">Waiting for the next live segment.</li>
        ) : null}
        {blocks.map((block) => {
          const isLast = block.id === lastBlock?.id;
          return (
            <li
              key={block.id}
              ref={isLast && !block.interim ? setLatestElement : undefined}
              className={
                block.kind === 'marker'
                  ? 'text-muted-foreground text-base leading-snug tracking-wide'
                  : 'text-lg leading-snug'
              }
            >
              {/* Finalized text and the interim tail share one paragraph: finalizing swaps
                  the styling in place instead of moving the sentence to its own line. */}
              {block.segments.map((segment, index) => (
                <span key={segment.id}>
                  {index > 0 ? ' ' : ''}
                  {segment.text}
                </span>
              ))}
              {block.interim ? (
                <span
                  ref={isLast ? setLatestElement : undefined}
                  className="text-muted-foreground italic"
                >
                  {block.segments.length > 0 ? ' ' : ''}
                  {block.interim}
                </span>
              ) : null}
            </li>
          );
        })}
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
