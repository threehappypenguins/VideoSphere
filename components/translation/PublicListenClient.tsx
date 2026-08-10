'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LiveTranslationPublicMeta } from '@/types';
import { TranslationLanguageSearchList } from '@/components/translation/TranslationLanguageSearchList';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  normalizeTranslationLanguageCode,
  resolveTranslationLanguageOption,
} from '@/lib/translation/languages';
import {
  clearListenLanguagePreference,
  readListenLanguagePreference,
  writeListenLanguagePreference,
} from '@/lib/translation/listen-language-preference';

type CaptionLine = {
  id: string;
  text: string;
  ts: number;
};

/**
 * Picks the initial listen language from a saved preference when it is still offered.
 * @param slug - Public channel slug.
 * @param available - Normalized language codes offered on this page.
 * @returns Saved language code, or `null` when none / preference no longer offered.
 */
function resolveInitialLanguage(slug: string, available: string[]): string | null {
  const saved = readListenLanguagePreference(slug);
  if (saved && available.includes(saved)) {
    return saved;
  }
  if (saved) {
    clearListenLanguagePreference(slug);
  }
  return null;
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
    return [...set];
  }, [meta.enabledLanguages, meta.sourceLanguage]);

  const languageOptions = useMemo(
    () => languages.map((code) => resolveTranslationLanguageOption(code)),
    [languages]
  );

  const [language, setLanguageState] = useState<string | null>(null);
  const [wantAudio, setWantAudio] = useState(false);
  const [live, setLive] = useState(meta.live);
  const [lines, setLines] = useState<CaptionLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());

  /**
   * Updates the selected language and persists it for this slug in localStorage.
   * @param code - Language code chosen by the listener.
   */
  function setLanguage(code: string) {
    const normalized = normalizeTranslationLanguageCode(code) || code;
    setLanguageState(normalized);
    writeListenLanguagePreference(meta.slug, normalized);
  }

  /** Plays the next queued clip, skipping failures so the queue does not stall. */
  async function pumpAudio() {
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
      void pumpAudio();
    }
  }

  // Apply saved preference after mount to avoid SSR/client hydration mismatch.
  useEffect(() => {
    setLanguageState(resolveInitialLanguage(meta.slug, languages));
  }, [languages, meta.slug]);

  useEffect(() => {
    if (language && !languages.includes(language)) {
      setLanguageState(null);
      clearListenLanguagePreference(meta.slug);
    }
  }, [language, languages, meta.slug]);

  useEffect(() => {
    if (wantAudio && 'mediaSession' in navigator) {
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
    setLines([]);
    seenRef.current = new Set();
    queueRef.current = [];
    playingRef.current = false;
    setError(null);

    if (!language) {
      return;
    }

    const params = new URLSearchParams({
      language,
      wantAudio: wantAudio && meta.listenAvailable ? '1' : '0',
    });
    const source = new EventSource(
      `/api/translation/public/${encodeURIComponent(meta.slug)}/events?${params}`
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
          setLive(event.live);
        }
        if (event.type === 'error' && event.message) {
          setError(event.message);
        }
        if (event.type === 'caption' && event.segmentId && event.text) {
          if (seenRef.current.has(event.segmentId)) {
            // Same segment may arrive again later with a TTS audio URL.
            if (wantAudio && meta.listenAvailable && event.audioUrl) {
              queueRef.current.push(event.audioUrl);
              void pumpAudio();
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
          if (wantAudio && meta.listenAvailable && event.audioUrl) {
            queueRef.current.push(event.audioUrl);
            void pumpAudio();
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
    };
  }, [language, meta.listenAvailable, meta.slug, wantAudio]);

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

      {language && meta.listenAvailable ? (
        <div className="mb-6">
          <Button
            type="button"
            variant={wantAudio ? 'default' : 'outline'}
            className="w-full"
            onClick={() => setWantAudio((v) => !v)}
          >
            {wantAudio ? 'Listening — tap to mute' : 'Listen to translation'}
          </Button>
          <p className="text-muted-foreground mt-2 text-xs">
            Audio may continue when your screen locks or you switch apps, depending on your browser.
          </p>
        </div>
      ) : language ? (
        <p className="text-muted-foreground mb-6 text-sm">Captions only for this page.</p>
      ) : null}

      {/* Captions are the live text list below; TTS clips have no VTT track. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- captions rendered as page text */}
      <audio
        ref={audioRef}
        className="hidden"
        playsInline
        onEnded={() => {
          playingRef.current = false;
          void pumpAudio();
        }}
      />

      {error ? <p className="text-destructive mb-3 text-sm">{error}</p> : null}

      <ol className="flex flex-1 flex-col gap-3 overflow-y-auto pb-8">
        {!language ? (
          <li className="text-muted-foreground text-sm">Choose a language above to start.</li>
        ) : lines.length === 0 ? (
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
    </div>
  );
}
