'use client';

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { TranslationLanguageOption } from '@/lib/translation/languages';

/**
 * Controls exposed from the public listen page into the public navbar.
 */
export type ListenNavControls = {
  /** Languages available for this channel. */
  languageOptions: readonly TranslationLanguageOption[];
  /** Currently selected language code (empty when none). */
  language: string;
  /** Called when the user picks a language from the nav control. */
  onLanguageChange: (code: string) => void;
  /** Whether spoken audio can be enabled for the current selection. */
  audioAvailable: boolean;
  /** Whether the listener currently wants spoken audio. */
  wantAudio: boolean;
  /** Toggles spoken audio on or off. */
  onToggleAudio: () => void;
};

/**
 * SSR/hydration seed for navbar icons (no live handlers yet).
 * Handlers are attached via registration before paint.
 */
export type ListenNavControlsSeed = {
  /** Languages available for this channel. */
  languageOptions: readonly TranslationLanguageOption[];
  /** Currently selected language code (empty when none). */
  language: string;
  /** Whether spoken audio can be enabled for the current selection. */
  audioAvailable: boolean;
};

type ListenNavVisualSnapshot = {
  languageOptions: readonly TranslationLanguageOption[];
  language: string;
  audioAvailable: boolean;
  wantAudio: boolean;
};

interface ListenNavControlsContextValue {
  /** Active listen-page controls, or null when none are registered/seeded. */
  controls: ListenNavControls | null;
  /** Registers or clears listen-page navbar controls. */
  setControls: (next: ListenNavControls | null) => void;
}

const ListenNavControlsContext = createContext<ListenNavControlsContextValue | null>(null);

/**
 * Returns true when two visual snapshots are equivalent for navbar rendering.
 * @param a - Previous snapshot.
 * @param b - Next snapshot.
 * @returns Whether navbar-visible fields are unchanged.
 */
function listenNavVisualEqual(
  a: ListenNavVisualSnapshot | null,
  b: ListenNavVisualSnapshot | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.language === b.language &&
    a.wantAudio === b.wantAudio &&
    a.audioAvailable === b.audioAvailable &&
    a.languageOptions === b.languageOptions
  );
}

/**
 * Returns listen navbar controls when rendered inside {@link ListenNavControlsProvider}.
 * @returns Active controls, or null outside the provider / when unregistered.
 */
export function useListenNavControls(): ListenNavControls | null {
  return useContext(ListenNavControlsContext)?.controls ?? null;
}

/**
 * Registers listen-page controls for the public navbar for the lifetime of the caller.
 * Uses `useLayoutEffect` so icons update before paint (avoids a missing-icon flash).
 * Handlers are kept in a ref (updated after commit) so visual bailouts still use latest callbacks.
 * @param controls - Control state and handlers, or null to clear.
 */
export function useRegisterListenNavControls(controls: ListenNavControls | null): void {
  const setControls = useContext(ListenNavControlsContext)?.setControls;
  const controlsRef = useRef(controls);

  useLayoutEffect(() => {
    controlsRef.current = controls;
  });

  const language = controls?.language ?? '';
  const wantAudio = controls?.wantAudio ?? false;
  const audioAvailable = controls?.audioAvailable ?? false;
  const languageOptions = controls?.languageOptions ?? null;
  const isActive = controls !== null;

  useLayoutEffect(() => {
    if (!setControls) return;

    if (!isActive || !languageOptions) {
      setControls(null);
      return;
    }

    setControls({
      languageOptions,
      language,
      audioAvailable,
      wantAudio,
      onLanguageChange: (code) => {
        controlsRef.current?.onLanguageChange(code);
      },
      onToggleAudio: () => {
        controlsRef.current?.onToggleAudio();
      },
    });
  }, [setControls, isActive, language, wantAudio, audioAvailable, languageOptions]);

  useLayoutEffect(() => {
    if (!setControls) return;
    return () => {
      setControls(null);
    };
  }, [setControls]);
}

interface ListenNavControlsProviderProps {
  children: ReactNode;
  /**
   * Optional SSR seed so language/speaker icons render on first paint
   * (from the listen-language cookie + channel meta).
   */
  seed?: ListenNavControlsSeed | null;
}

/**
 * Shares public listen language/audio controls with the listen-layout navbar.
 * @param props - Provider children and optional SSR seed.
 * @returns Context provider wrapping listen chrome.
 */
export function ListenNavControlsProvider({
  children,
  seed = null,
}: ListenNavControlsProviderProps) {
  const handlersRef = useRef({
    onLanguageChange: (_code: string) => undefined,
    onToggleAudio: () => undefined,
  });

  const [snapshot, setSnapshot] = useState<ListenNavVisualSnapshot | null>(() =>
    seed
      ? {
          languageOptions: seed.languageOptions,
          language: seed.language,
          audioAvailable: seed.audioAvailable,
          wantAudio: false,
        }
      : null
  );

  const setControls = useCallback((next: ListenNavControls | null) => {
    if (!next) {
      setSnapshot(null);
      return;
    }
    handlersRef.current = {
      onLanguageChange: next.onLanguageChange,
      onToggleAudio: next.onToggleAudio,
    };
    const visual: ListenNavVisualSnapshot = {
      languageOptions: next.languageOptions,
      language: next.language,
      audioAvailable: next.audioAvailable,
      wantAudio: next.wantAudio,
    };
    setSnapshot((prev) => (listenNavVisualEqual(prev, visual) ? prev : visual));
  }, []);

  const controls = useMemo((): ListenNavControls | null => {
    if (!snapshot) return null;
    return {
      languageOptions: snapshot.languageOptions,
      language: snapshot.language,
      audioAvailable: snapshot.audioAvailable,
      wantAudio: snapshot.wantAudio,
      onLanguageChange: (code) => {
        handlersRef.current.onLanguageChange(code);
      },
      onToggleAudio: () => {
        handlersRef.current.onToggleAudio();
      },
    };
  }, [snapshot]);

  const value = useMemo(
    () => ({
      controls,
      setControls,
    }),
    [controls, setControls]
  );

  return (
    <ListenNavControlsContext.Provider value={value}>{children}</ListenNavControlsContext.Provider>
  );
}
