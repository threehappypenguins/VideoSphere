'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type WheelEvent } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SERMON_AUDIO_SPEAKER_SEARCH_MIN_LENGTH } from '@/lib/platforms/sermon-audio-speakers';
import { cn } from '@/lib/utils';
import type { ApiResponse } from '@/types';
import type { SermonAudioSpeakerOption } from '@/lib/platforms/sermon-audio-speakers';

/** Selected speaker values stored on the draft. */
export interface SermonAudioSpeakerValue {
  /** Speaker display name sent to SermonAudio as `speakerName`. */
  speakerName: string;
  /** Optional SermonAudio speaker id when chosen from SA records. */
  speakerID?: number;
}

interface SermonAudioSpeakerComboboxProps {
  /** Trigger button id (label `htmlFor`). */
  id: string;
  /** Current speaker name shown on the trigger. */
  speakerName: string;
  /** SermonAudio speaker id when selected from SA search/recent lists. */
  speakerID?: number;
  /** Called when the speaker name or linked id changes. */
  onSpeakerChange: (value: SermonAudioSpeakerValue) => void;
  /** When true, applies invalid styling for upload validation. */
  invalid?: boolean;
  /** Additional classes for the trigger button. */
  className?: string;
}

/**
 * Routes wheel events to a scroll container inside a modal dialog.
 * Dialog scroll lock can swallow trackpad scrolling on portaled popovers.
 * @param event - Wheel event from the speaker list container.
 */
function handleListWheel(event: WheelEvent<HTMLDivElement>) {
  event.stopPropagation();
  event.preventDefault();
  event.currentTarget.scrollTop += event.deltaY;
}

/**
 * SermonAudio speaker picker with a dropdown trigger and in-panel search.
 * @param props - Picker configuration and callbacks.
 * @returns Speaker picker UI.
 */
export function SermonAudioSpeakerCombobox({
  id,
  speakerName,
  speakerID,
  onSpeakerChange,
  invalid = false,
  className,
}: SermonAudioSpeakerComboboxProps) {
  const listboxId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelQueryRef = useRef('');
  const speakerNameRef = useRef(speakerName);
  const [open, setOpen] = useState(false);
  const [panelQuery, setPanelQuery] = useState('');
  const [recentSpeakers, setRecentSpeakers] = useState<SermonAudioSpeakerOption[]>([]);
  const [searchResults, setSearchResults] = useState<SermonAudioSpeakerOption[]>([]);
  const [recentLoaded, setRecentLoaded] = useState(false);
  const [recentFailed, setRecentFailed] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [hasTypedSinceOpen, setHasTypedSinceOpen] = useState(false);

  panelQueryRef.current = panelQuery;
  speakerNameRef.current = speakerName;

  useEffect(() => {
    let cancelled = false;

    const loadRecentSpeakers = async () => {
      try {
        const response = await fetch('/api/platforms/sermon-audio/speakers/recent', {
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error('Failed to load recent speakers');
        }
        const payload = (await response.json()) as ApiResponse<SermonAudioSpeakerOption[]>;
        if (!cancelled) {
          setRecentSpeakers(Array.isArray(payload.data) ? payload.data : []);
          setRecentFailed(false);
        }
      } catch {
        if (!cancelled) {
          setRecentSpeakers([]);
          setRecentFailed(true);
        }
      } finally {
        if (!cancelled) {
          setRecentLoaded(true);
        }
      }
    };

    void loadRecentSpeakers();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const trimmed = panelQuery.trim();
    if (!hasTypedSinceOpen || trimmed.length < SERMON_AUDIO_SPEAKER_SEARCH_MIN_LENGTH) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/platforms/sermon-audio/speakers/search?q=${encodeURIComponent(trimmed)}`,
          { cache: 'no-store' }
        );
        if (!response.ok) {
          throw new Error('Failed to search speakers');
        }
        const payload = (await response.json()) as ApiResponse<SermonAudioSpeakerOption[]>;
        if (!cancelled) {
          setSearchResults(Array.isArray(payload.data) ? payload.data : []);
        }
      } catch {
        if (!cancelled) {
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [hasTypedSinceOpen, open, panelQuery]);

  const trimmedQuery = panelQuery.trim();
  const isSearching =
    hasTypedSinceOpen && trimmedQuery.length >= SERMON_AUDIO_SPEAKER_SEARCH_MIN_LENGTH;
  const visibleSpeakers = isSearching ? searchResults : recentSpeakers;
  const trimmedSpeakerName = speakerName.trim();
  const showCustomNameOption =
    trimmedQuery !== '' &&
    !visibleSpeakers.some(
      (speaker) => speaker.displayName.toLowerCase() === trimmedQuery.toLowerCase()
    );

  useEffect(() => {
    if (!open) {
      setHighlightedIndex(-1);
      return;
    }
    setHighlightedIndex(visibleSpeakers.length > 0 ? 0 : showCustomNameOption ? 0 : -1);
  }, [open, showCustomNameOption, visibleSpeakers]);

  const commitPanelQuery = () => {
    const nextName = panelQueryRef.current.trim();
    if (nextName === '' || nextName === speakerNameRef.current.trim()) {
      return;
    }
    onSpeakerChange({ speakerName: nextName, speakerID: undefined });
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setPanelQuery('');
      setHasTypedSinceOpen(false);
      setSearchResults([]);
      setSearchLoading(false);
    } else {
      commitPanelQuery();
    }
    setOpen(nextOpen);
  };

  const selectSpeaker = (speaker: SermonAudioSpeakerOption) => {
    onSpeakerChange({ speakerName: speaker.displayName, speakerID: speaker.speakerID });
    setOpen(false);
  };

  const selectCustomName = (name: string) => {
    onSpeakerChange({ speakerName: name, speakerID: undefined });
    setOpen(false);
  };

  const handlePanelQueryChange = (nextValue: string) => {
    setPanelQuery(nextValue);
    setHasTypedSinceOpen(true);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const optionCount = visibleSpeakers.length + (showCustomNameOption ? 1 : 0);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((prev) => (optionCount === 0 ? -1 : (prev + 1) % optionCount));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((prev) =>
        optionCount === 0 ? -1 : (prev - 1 + optionCount) % optionCount
      );
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < visibleSpeakers.length) {
        const speaker = visibleSpeakers[highlightedIndex];
        if (speaker) selectSpeaker(speaker);
        return;
      }
      if (showCustomNameOption && highlightedIndex === visibleSpeakers.length) {
        selectCustomName(trimmedQuery);
        return;
      }
      if (trimmedQuery !== '') {
        selectCustomName(trimmedQuery);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div>
      <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={open ? listboxId : undefined}
            aria-invalid={invalid}
            className={cn(
              className,
              'flex h-10 w-full items-center justify-between text-left',
              !trimmedSpeakerName && 'text-muted-foreground',
              invalid && 'border-destructive'
            )}
          >
            <span className="min-w-0 flex-1 truncate text-left">
              {trimmedSpeakerName || 'Select speaker'}
            </span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 self-center opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          aria-label="SermonAudio speakers"
          align="start"
          side="bottom"
          className="w-[var(--radix-popover-trigger-width)] p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchInputRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div className="border-b border-border p-2">
            <Input
              ref={searchInputRef}
              value={panelQuery}
              onChange={(event) => handlePanelQueryChange(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search speakers"
              autoComplete="off"
              aria-label="Search speakers"
            />
          </div>
          <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
            {isSearching ? 'Search results' : 'Recent speakers'}
          </p>
          <div
            className="scrollbar-visible max-h-52 overflow-y-auto overscroll-y-contain"
            onWheel={handleListWheel}
          >
            <div aria-live="polite" aria-atomic="true">
              {searchLoading ? (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Searching speakers…
                </div>
              ) : null}
              {!searchLoading &&
              isSearching &&
              visibleSpeakers.length === 0 &&
              !showCustomNameOption ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">No speakers found.</p>
              ) : null}
              {!searchLoading && !isSearching && recentLoaded && visibleSpeakers.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">
                  {recentFailed
                    ? 'Recent speakers unavailable. Search or enter a new name below.'
                    : 'No recent speakers yet. Search or enter a new name below.'}
                </p>
              ) : null}
              {!searchLoading && !isSearching && trimmedQuery.length === 1 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Type {SERMON_AUDIO_SPEAKER_SEARCH_MIN_LENGTH} or more characters to search all
                  SermonAudio speakers.
                </p>
              ) : null}
            </div>
            <div id={listboxId} role="listbox" aria-label="Speaker options">
              {visibleSpeakers.map((speaker, index) => (
                <button
                  key={speaker.speakerID}
                  type="button"
                  role="option"
                  aria-selected={
                    speakerID === speaker.speakerID && speakerName === speaker.displayName
                  }
                  className={cn(
                    'flex w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                    index === highlightedIndex && 'bg-accent text-accent-foreground'
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSpeaker(speaker)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                >
                  {speaker.displayName}
                </button>
              ))}
              {showCustomNameOption ? (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className={cn(
                    'flex w-full border-t border-border px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                    highlightedIndex === visibleSpeakers.length &&
                      'bg-accent text-accent-foreground'
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectCustomName(trimmedQuery)}
                  onMouseEnter={() => setHighlightedIndex(visibleSpeakers.length)}
                >
                  Use &ldquo;{trimmedQuery}&rdquo;
                </button>
              ) : null}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <p className="mt-1 text-xs text-muted-foreground">
        Choose a recent speaker, search SermonAudio, or enter a new name.
      </p>
    </div>
  );
}
