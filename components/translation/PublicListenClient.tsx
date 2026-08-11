'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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

type CaptionLine = {
  id: string;
  text: string;
  ts: number;
};

/**
 * No-op subscribe for a one-shot localStorage read via `useSyncExternalStore`.
 * Same-tab preference updates go through React state instead of storage events.
 * @param _onStoreChange - Unused listener (API required by React).
 * @returns Unsubscribe function.
 */
function subscribeListenLanguagePreference(_onStoreChange: () => void): () => void {
  return () => {};
}

/**
 * Reads the saved listen language for a slug on the client.
 * @param slug - Public channel slug.
 * @returns Saved language code, or null.
 */
function getListenLanguageSnapshot(slug: string): string | null {
  return readListenLanguagePreference(slug);
}

/**
 * Server/hydration snapshot — never read localStorage during SSR.
 * @returns Always null.
 */
function getListenLanguageServerSnapshot(): string | null {
  return null;
}

type CaptionStreamProps = {
  slug: string;
  language: string;
  /** Owner is currently sending audio — open the caption SSE only while true. */
  live: boolean;
  wantAudio: boolean;
  audioAvailable: boolean;
  onLiveChange: (live: boolean) => void;
};

/**
 * SSE caption + optional TTS queue for one listen language.
 * Remount (via parent `key`) when the language changes so caption state resets cleanly.
 * When the owner stops ingest, the SSE disconnects but the latest captions stay on screen.
 * @param props - Stream connection options.
 * @returns Caption list and hidden audio element.
 */
function CaptionStream(props: CaptionStreamProps) {
  const { slug, language, live, wantAudio, audioAvailable, onLiveChange } = props;
  const [lines, setLines] = useState<CaptionLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const objectUrlRef = useRef<string | null>(null);
  /** Prefetched clip object URLs (and in-flight fetches) keyed by audio API path. */
  const prefetchRef = useRef<Map<string, Promise<string>>>(new Map());
  /** Ignore media errors raised while we intentionally swap `audio.src`. */
  const ignoreAudioErrorRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());
  const queuedAudioRef = useRef<Set<string>>(new Set());
  const wantAudioRef = useRef(live && wantAudio && audioAvailable);
  const pumpAudioRef = useRef<() => Promise<void>>(async () => {});
  const enqueueSpokenUrlRef = useRef<(url: string) => void>(() => undefined);

  useEffect(() => {
    wantAudioRef.current = live && wantAudio && audioAvailable;
  }, [audioAvailable, live, wantAudio]);

  /**
   * Starts fetching a clip into an object URL so playback can start without a gap.
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
    enqueueSpokenUrlRef.current = (url: string) => {
      if (queuedAudioRef.current.has(url)) return;
      queuedAudioRef.current.add(url);
      queueRef.current.push(url);
      prefetchAudioUrl(url);
      const upcoming = queueRef.current[1];
      if (upcoming) prefetchAudioUrl(upcoming);
      void pumpAudioRef.current();
    };
  });

  /**
   * Stops TTS playback and drops queued clips (used when the listener mutes).
   */
  function stopSpokenAudio() {
    queueRef.current = [];
    queuedAudioRef.current.clear();
    playingRef.current = false;
    for (const pending of prefetchRef.current.values()) {
      void pending.then((objectUrl) => URL.revokeObjectURL(objectUrl)).catch(() => undefined);
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
    pumpAudioRef.current = async () => {
      if (!wantAudioRef.current) {
        stopSpokenAudio();
        return;
      }
      if (playingRef.current) return;
      const next = queueRef.current.shift();
      if (!next) return;
      playingRef.current = true;
      const upcoming = queueRef.current[0];
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
        if (!objectUrl) {
          throw new Error('Missing audio prefetch');
        }
        if (!wantAudioRef.current) {
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
        if (!wantAudioRef.current) return;
        setError('Spoken audio failed to play. Check volume, then tap Listen again.');
        void pumpAudioRef.current();
      }
    };
  });

  useEffect(() => {
    if (!live || !wantAudio) {
      stopSpokenAudio();
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'paused';
        } catch {
          // Media Session unsupported quirks
        }
      }
      return;
    }
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Live audio translation',
          artist: 'VideoSphere',
        });
        navigator.mediaSession.playbackState = 'playing';
      } catch {
        // Media Session unsupported quirks
      }
    }
  }, [live, wantAudio]);

  useEffect(() => {
    // Keep the latest captions on screen after ingest stops — only disconnect the SSE.
    if (!live) {
      stopSpokenAudio();
      setError(null);
      return;
    }

    const params = new URLSearchParams({
      language,
      wantAudio: wantAudio && audioAvailable ? '1' : '0',
    });
    const source = new EventSource(
      `/api/translation/public/${encodeURIComponent(slug)}/events?${params}`
    );

    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as {
          type: string;
          segmentId?: string;
          text?: string;
          audioUrl?: string;
          live?: boolean;
          message?: string;
          ts?: number;
        };

        if (event.type === 'status' && typeof event.live === 'boolean') {
          onLiveChange(event.live);
        }
        if (event.type === 'error' && event.message) {
          setError(event.message);
        }
        if (event.type === 'caption' && event.segmentId && event.text) {
          if (seenRef.current.has(event.segmentId)) {
            // Same segment: update text in place (streaming partials → final).
            setLines((prev) =>
              prev.map((line) =>
                line.id === event.segmentId
                  ? { ...line, text: event.text!, ts: event.ts ?? line.ts }
                  : line
              )
            );
            // Same segment may arrive again later with a TTS audio URL.
            if (wantAudioRef.current && event.audioUrl) {
              enqueueSpokenUrlRef.current(event.audioUrl);
            }
            return;
          }
          seenRef.current.add(event.segmentId);
          setLines((prev) =>
            [
              ...prev,
              { id: event.segmentId!, text: event.text!, ts: event.ts ?? Date.now() },
            ].slice(-80)
          );
          if (wantAudioRef.current && event.audioUrl) {
            enqueueSpokenUrlRef.current(event.audioUrl);
          }
        }
      } catch {
        // ignore malformed events
      }
    };

    source.onerror = () => {
      setError('Connection interrupted. Reconnecting…');
    };

    return () => {
      source.close();
      // Closing the SSE also mutes locally so a reconnect with wantAudio=0 cannot
      // keep draining a stale clip queue from the previous connection.
      if (!(wantAudio && audioAvailable)) {
        stopSpokenAudio();
      }
    };
  }, [audioAvailable, language, live, onLiveChange, slug, wantAudio]);

  return (
    <>
      {error ? <p className="text-destructive mb-3 text-sm">{error}</p> : null}

      {/* Captions are the live text list below; TTS clips have no VTT track. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- captions rendered as page text */}
      <audio
        ref={audioRef}
        className="hidden"
        playsInline
        onEnded={() => {
          playingRef.current = false;
          if (!wantAudioRef.current) {
            stopSpokenAudio();
            return;
          }
          void pumpAudioRef.current();
        }}
        onError={() => {
          // Swapping `src` often emits a spurious error for the previous resource.
          if (ignoreAudioErrorRef.current) return;
          playingRef.current = false;
          if (!wantAudioRef.current) {
            stopSpokenAudio();
            return;
          }
          setError('Spoken audio clip was missing or expired. Keep listening for the next line.');
          void pumpAudioRef.current();
        }}
      />

      <ol className="flex flex-1 flex-col gap-3 overflow-y-auto pb-8">
        {lines.length === 0 ? (
          <li className="text-muted-foreground text-sm">
            {live
              ? 'Captions will appear here in real time.'
              : 'There is currently no audio input. Captions will appear here once the speaker is live.'}
          </li>
        ) : (
          lines.map((line) => (
            <li
              key={line.id}
              className="rounded-lg bg-black/[0.03] px-3 py-2 text-base leading-relaxed dark:bg-white/[0.06]"
            >
              {line.text}
            </li>
          ))
        )}
      </ol>
    </>
  );
}

/** How often to re-check public meta while the owner is not sending audio. */
const LIVE_STATUS_POLL_MS = 2500;

/**
 * Mobile-first public captions + optional TTS listen client (no login).
 * @param props - Public channel metadata from the server.
 * @returns Listen page UI.
 */
export function PublicListenClient(props: { meta: LiveTranslationPublicMeta }) {
  const { meta } = props;
  const languages = useMemo(() => {
    const set = new Set(
      [meta.sourceLanguage, ...meta.enabledLanguages]
        .map(normalizeTranslationLanguageCode)
        .filter(Boolean)
    );
    return [...set].sort((a, b) =>
      resolveTranslationLanguageOption(a).name.localeCompare(
        resolveTranslationLanguageOption(b).name,
        'en',
        { sensitivity: 'base' }
      )
    );
  }, [meta.enabledLanguages, meta.sourceLanguage]);

  const languageOptions = useMemo(
    () => languages.map((code) => resolveTranslationLanguageOption(code)),
    [languages]
  );

  const savedLanguage = useSyncExternalStore(
    subscribeListenLanguagePreference,
    () => getListenLanguageSnapshot(meta.slug),
    getListenLanguageServerSnapshot
  );

  /** `undefined` = use saved preference; otherwise an explicit user choice (including clear). */
  const [languageOverride, setLanguageOverride] = useState<string | null | undefined>(undefined);
  const [wantAudioRequested, setWantAudioRequested] = useState(false);
  const [live, setLive] = useState(meta.live);

  const languageCandidate = languageOverride !== undefined ? languageOverride : savedLanguage;
  const language =
    languageCandidate && languages.includes(languageCandidate) ? languageCandidate : null;

  const audioAvailableForLanguage = Boolean(
    language && (meta.audioLanguages ?? []).includes(language)
  );
  const wantAudio = wantAudioRequested && audioAvailableForLanguage;
  /** Only open the caption SSE while the owner is actually ingesting. */
  const streamActive = Boolean(language && live);

  // Lightweight poll until CaptionStream is connected (it then owns live via SSE).
  useEffect(() => {
    if (streamActive) return;
    let cancelled = false;

    async function refreshLiveStatus(): Promise<void> {
      try {
        const res = await fetch(`/api/translation/public/${encodeURIComponent(meta.slug)}`, {
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as Partial<LiveTranslationPublicMeta>;
        if (typeof data.live === 'boolean') setLive(data.live);
      } catch {
        // ignore transient network errors; next poll retries
      }
    }

    void refreshLiveStatus();
    const timer = setInterval(() => {
      void refreshLiveStatus();
    }, LIVE_STATUS_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [meta.slug, streamActive]);

  /**
   * Updates the selected language and persists it for this slug in localStorage.
   * @param code - Language code chosen by the listener.
   */
  function setLanguage(code: string) {
    const normalized = normalizeTranslationLanguageCode(code) || code;
    setLanguageOverride(normalized);
    writeListenLanguagePreference(meta.slug, normalized);
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 py-6">
      <header className="mb-6 space-y-1">
        <p className="text-muted-foreground text-xs tracking-[0.2em] uppercase">VideoSphere</p>
        <h1 className="text-2xl font-semibold tracking-tight">Live audio translation</h1>
        {live ? (
          <p className="text-muted-foreground text-sm">Live now</p>
        ) : (
          <p className="text-muted-foreground text-sm">There is currently no audio input.</p>
        )}
      </header>

      <div className="mb-4 space-y-2">
        <Label htmlFor="listen-language">Language</Label>
        <div className="flex items-center gap-2">
          <TranslationLanguageCombobox
            id="listen-language"
            className="min-w-0 flex-1"
            listLabel="Available languages"
            labelStyle="public"
            options={languageOptions}
            value={language ?? ''}
            onValueChange={setLanguage}
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
              onClick={() => setWantAudioRequested((v) => !v)}
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
          <p className="text-muted-foreground text-xs">
            Audio may continue with the screen locked, depending on your browser.
          </p>
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
          onLiveChange={setLive}
        />
      )}
    </div>
  );
}
