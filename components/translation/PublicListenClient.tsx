'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { LiveTranslationPublicMeta } from '@/types';
import { TranslationLanguageSearchList } from '@/components/translation/TranslationLanguageSearchList';
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
  wantAudio: boolean;
  audioAvailable: boolean;
  onLiveChange: (live: boolean) => void;
};

/**
 * SSE caption + optional TTS queue for one listen language.
 * Remount (via parent `key`) when the language changes so caption state resets cleanly.
 * @param props - Stream connection options.
 * @returns Caption list and hidden audio element.
 */
function CaptionStream(props: CaptionStreamProps) {
  const { slug, language, wantAudio, audioAvailable, onLiveChange } = props;
  const [lines, setLines] = useState<CaptionLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());
  const wantAudioRef = useRef(wantAudio && audioAvailable);
  const pumpAudioRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    wantAudioRef.current = wantAudio && audioAvailable;
  }, [wantAudio, audioAvailable]);

  /**
   * Stops TTS playback and drops queued clips (used when the listener mutes).
   */
  function stopSpokenAudio() {
    queueRef.current = [];
    playingRef.current = false;
    const audio = audioRef.current;
    if (!audio) return;
    try {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch {
      // ignore
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
      const audio = audioRef.current;
      if (!audio) {
        playingRef.current = false;
        return;
      }
      try {
        audio.src = next;
        await audio.play();
      } catch {
        playingRef.current = false;
        if (!wantAudioRef.current) return;
        setError('Spoken audio failed to play. Check volume, then tap Listen again.');
        void pumpAudioRef.current();
      }
    };
  });

  useEffect(() => {
    if (!wantAudio) {
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
  }, [wantAudio]);

  useEffect(() => {
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
            // Same segment may arrive again later with a TTS audio URL.
            if (wantAudioRef.current && event.audioUrl) {
              queueRef.current.push(event.audioUrl);
              void pumpAudioRef.current();
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
            queueRef.current.push(event.audioUrl);
            void pumpAudioRef.current();
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
  }, [audioAvailable, language, onLiveChange, slug, wantAudio]);

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
          <li className="text-muted-foreground text-sm">Captions will appear here in real time.</li>
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
        <p className="text-muted-foreground text-sm">{live ? 'Live now' : 'Waiting for audio…'}</p>
      </header>

      <div className="mb-4 space-y-2">
        <Label htmlFor="listen-language-search">Language</Label>
        <TranslationLanguageSearchList
          mode="single"
          id="listen-language-search"
          listLabel="Available languages"
          labelStyle="public"
          options={languageOptions}
          value={language ?? ''}
          onValueChange={setLanguage}
        />
        {!language ? (
          <p className="text-muted-foreground text-xs">Select a language to follow captions.</p>
        ) : null}
      </div>

      {language && audioAvailableForLanguage ? (
        <div className="mb-6">
          <Button
            type="button"
            variant={wantAudio ? 'default' : 'outline'}
            className="w-full"
            onClick={() => setWantAudioRequested((v) => !v)}
          >
            {wantAudio ? 'Listening — tap to mute' : 'Listen to translation'}
          </Button>
          <p className="text-muted-foreground mt-2 text-xs">
            Audio may continue when your screen locks or you switch apps, depending on your browser.
          </p>
        </div>
      ) : language ? (
        <p className="text-muted-foreground mb-6 text-sm">Captions only for this language.</p>
      ) : null}

      {!language ? (
        <ol className="flex flex-1 flex-col gap-3 overflow-y-auto pb-8">
          <li className="text-muted-foreground text-sm">Choose a language above to start.</li>
        </ol>
      ) : (
        <CaptionStream
          key={language}
          slug={meta.slug}
          language={language}
          wantAudio={wantAudio}
          audioAvailable={audioAvailableForLanguage}
          onLiveChange={setLive}
        />
      )}
    </div>
  );
}
