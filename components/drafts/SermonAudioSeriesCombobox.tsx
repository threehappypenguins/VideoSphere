'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type WheelEvent } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SERMON_AUDIO_SERIES_SEARCH_MIN_LENGTH } from '@/lib/platforms/sermon-audio-series';
import { cn } from '@/lib/utils';
import type { ApiResponse } from '@/types';
import type { SermonAudioSeriesOption } from '@/lib/platforms/sermon-audio-series';

/** Selected series values stored on the draft. */
export interface SermonAudioSeriesValue {
  /** Series title stored as SA `subtitle` when not linked by id. */
  subtitle: string;
  /** Optional SermonAudio series id when chosen from SA records. */
  seriesID?: number;
}

interface SermonAudioSeriesComboboxProps {
  /** Trigger button id (label `htmlFor`). */
  id: string;
  /** Current series title shown on the trigger. */
  seriesTitle: string;
  /** SermonAudio series id when selected from SA search/recent lists. */
  seriesID?: number;
  /** Called when the series title or linked id changes. */
  onSeriesChange: (value: SermonAudioSeriesValue) => void;
  /** When true, applies invalid styling for upload validation. */
  invalid?: boolean;
  /** Additional classes for the trigger button. */
  className?: string;
}

/**
 * Routes wheel events to a scroll container inside a modal dialog.
 * @param event - Wheel event from the series list container.
 */
function handleListWheel(event: WheelEvent<HTMLDivElement>) {
  event.stopPropagation();
  event.preventDefault();
  event.currentTarget.scrollTop += event.deltaY;
}

/**
 * SermonAudio optional series picker with a dropdown trigger and in-panel search.
 * @param props - Picker configuration and callbacks.
 * @returns Series picker UI.
 */
export function SermonAudioSeriesCombobox({
  id,
  seriesTitle,
  seriesID,
  onSeriesChange,
  invalid = false,
  className,
}: SermonAudioSeriesComboboxProps) {
  const listboxId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelQueryRef = useRef('');
  const seriesTitleRef = useRef(seriesTitle);
  const [open, setOpen] = useState(false);
  const [panelQuery, setPanelQuery] = useState('');
  const [recentSeries, setRecentSeries] = useState<SermonAudioSeriesOption[]>([]);
  const [searchResults, setSearchResults] = useState<SermonAudioSeriesOption[]>([]);
  const [recentLoaded, setRecentLoaded] = useState(false);
  const [recentFailed, setRecentFailed] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [hasTypedSinceOpen, setHasTypedSinceOpen] = useState(false);

  panelQueryRef.current = panelQuery;
  seriesTitleRef.current = seriesTitle;

  useEffect(() => {
    let cancelled = false;

    const loadRecentSeries = async () => {
      try {
        const response = await fetch('/api/platforms/sermon-audio/series/recent', {
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error('Failed to load recent series');
        }
        const payload = (await response.json()) as ApiResponse<SermonAudioSeriesOption[]>;
        if (!cancelled) {
          setRecentSeries(Array.isArray(payload.data) ? payload.data : []);
          setRecentFailed(false);
        }
      } catch {
        if (!cancelled) {
          setRecentSeries([]);
          setRecentFailed(true);
        }
      } finally {
        if (!cancelled) {
          setRecentLoaded(true);
        }
      }
    };

    void loadRecentSeries();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const trimmed = panelQuery.trim();
    if (!hasTypedSinceOpen || trimmed.length < SERMON_AUDIO_SERIES_SEARCH_MIN_LENGTH) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/platforms/sermon-audio/series/search?q=${encodeURIComponent(trimmed)}`,
          { cache: 'no-store' }
        );
        if (!response.ok) {
          throw new Error('Failed to search series');
        }
        const payload = (await response.json()) as ApiResponse<SermonAudioSeriesOption[]>;
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
    hasTypedSinceOpen && trimmedQuery.length >= SERMON_AUDIO_SERIES_SEARCH_MIN_LENGTH;
  const visibleSeries = isSearching ? searchResults : recentSeries;
  const trimmedSeriesTitle = seriesTitle.trim();
  const showCustomTitleOption =
    trimmedQuery !== '' &&
    !visibleSeries.some((series) => series.title.toLowerCase() === trimmedQuery.toLowerCase());
  const clearOptionOffset = 1;
  const optionCount = clearOptionOffset + visibleSeries.length + (showCustomTitleOption ? 1 : 0);

  useEffect(() => {
    if (!open) {
      setHighlightedIndex(-1);
      return;
    }
    setHighlightedIndex(optionCount > 0 ? 0 : -1);
  }, [open, optionCount]);

  const commitPanelQuery = () => {
    const nextTitle = panelQueryRef.current.trim();
    if (nextTitle === '' || nextTitle === seriesTitleRef.current.trim()) {
      return;
    }
    onSeriesChange({ subtitle: nextTitle, seriesID: undefined });
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

  const selectSeries = (series: SermonAudioSeriesOption) => {
    onSeriesChange({ subtitle: series.title, seriesID: series.seriesID });
    setOpen(false);
  };

  const clearSeries = () => {
    onSeriesChange({ subtitle: '', seriesID: undefined });
    setOpen(false);
  };

  const selectCustomTitle = (title: string) => {
    onSeriesChange({ subtitle: title, seriesID: undefined });
    setOpen(false);
  };

  const handlePanelQueryChange = (nextValue: string) => {
    setPanelQuery(nextValue);
    setHasTypedSinceOpen(true);
  };

  const handleHighlightedSelection = () => {
    if (highlightedIndex === 0) {
      clearSeries();
      return;
    }
    const seriesIndex = highlightedIndex - clearOptionOffset;
    if (seriesIndex >= 0 && seriesIndex < visibleSeries.length) {
      const series = visibleSeries[seriesIndex];
      if (series) selectSeries(series);
      return;
    }
    if (showCustomTitleOption && highlightedIndex === optionCount - 1) {
      selectCustomTitle(trimmedQuery);
    }
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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
      if (highlightedIndex >= 0) {
        handleHighlightedSelection();
        return;
      }
      if (trimmedQuery !== '') {
        selectCustomTitle(trimmedQuery);
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
              !trimmedSeriesTitle && 'text-muted-foreground',
              invalid && 'border-destructive'
            )}
          >
            <span className="min-w-0 flex-1 truncate text-left">
              {trimmedSeriesTitle || 'Select series (optional)'}
            </span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 self-center opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          aria-label="SermonAudio series"
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
              placeholder="Search series by title"
              autoComplete="off"
              aria-label="Search series by title"
            />
          </div>
          <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
            {isSearching ? 'Search results' : 'Recent series'}
          </p>
          <div aria-live="polite" aria-atomic="true">
            {searchLoading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Searching series…
              </div>
            ) : null}
            {!searchLoading &&
            isSearching &&
            visibleSeries.length === 0 &&
            !showCustomTitleOption ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">No series found.</p>
            ) : null}
            {!searchLoading && !isSearching && recentLoaded && visibleSeries.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                {recentFailed
                  ? 'Recent series unavailable. Search or enter a new title below.'
                  : 'No recent series yet. Search or enter a new title below.'}
              </p>
            ) : null}
            {!searchLoading && !isSearching && trimmedQuery.length === 1 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Type {SERMON_AUDIO_SERIES_SEARCH_MIN_LENGTH} or more characters to search all
                SermonAudio series.
              </p>
            ) : null}
          </div>
          <div
            id={listboxId}
            role="listbox"
            aria-label="Series options"
            className="scrollbar-visible max-h-52 overflow-y-auto overscroll-y-contain"
            onWheel={handleListWheel}
          >
            <button
              type="button"
              role="option"
              aria-selected={!trimmedSeriesTitle}
              className={cn(
                'flex w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                highlightedIndex === 0 && 'bg-accent text-accent-foreground'
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={clearSeries}
              onMouseEnter={() => setHighlightedIndex(0)}
            >
              No series
            </button>
            {visibleSeries.map((series, index) => {
              const optionIndex = index + clearOptionOffset;
              return (
                <button
                  key={series.seriesID}
                  type="button"
                  role="option"
                  aria-selected={seriesID === series.seriesID && seriesTitle === series.title}
                  className={cn(
                    'flex w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                    optionIndex === highlightedIndex && 'bg-accent text-accent-foreground'
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSeries(series)}
                  onMouseEnter={() => setHighlightedIndex(optionIndex)}
                >
                  {series.title}
                </button>
              );
            })}
            {showCustomTitleOption ? (
              <button
                type="button"
                role="option"
                aria-selected={false}
                className={cn(
                  'flex w-full border-t border-border px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                  highlightedIndex === optionCount - 1 && 'bg-accent text-accent-foreground'
                )}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectCustomTitle(trimmedQuery)}
                onMouseEnter={() => setHighlightedIndex(optionCount - 1)}
              >
                Use &ldquo;{trimmedQuery}&rdquo;
              </button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      <p className="mt-1 text-xs text-muted-foreground">
        Optional. Choose a recent series, search by title, or enter a new series name.
      </p>
    </div>
  );
}
