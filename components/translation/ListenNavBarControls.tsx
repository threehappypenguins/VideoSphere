'use client';

import { Volume2 } from 'lucide-react';
import { TranslationLanguageCombobox } from '@/components/translation/TranslationLanguageCombobox';
import { useListenNavControls } from '@/components/translation/ListenNavControlsProvider';

/**
 * Language and speaker icon controls for the public listen navbar.
 * Renders from the SSR seed / registered controls (nothing when neither is present).
 * @returns Navbar control cluster, or null when inactive.
 */
export function ListenNavBarControls() {
  const controls = useListenNavControls();
  if (!controls) return null;

  const { languageOptions, language, onLanguageChange, audioAvailable, wantAudio, onToggleAudio } =
    controls;

  return (
    <div className="flex items-center gap-0.5">
      <TranslationLanguageCombobox
        id="listen-language-nav"
        triggerMode="icon"
        listLabel="Available languages"
        labelStyle="public"
        options={languageOptions}
        value={language}
        onValueChange={onLanguageChange}
        placeholder="Select a language"
      />
      {language && audioAvailable ? (
        <button
          type="button"
          aria-pressed={wantAudio}
          aria-label={wantAudio ? 'Mute spoken audio' : 'Play spoken audio'}
          title={wantAudio ? 'Mute spoken audio' : 'Play spoken audio'}
          className={
            wantAudio
              ? 'rounded-md bg-primary p-2 text-primary-foreground hover:bg-primary/90'
              : 'rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground'
          }
          onClick={onToggleAudio}
        >
          <Volume2 className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
