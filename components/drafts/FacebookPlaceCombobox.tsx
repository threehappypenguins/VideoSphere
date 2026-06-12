'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type WheelEvent } from 'react';
import { ChevronDown, Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  FACEBOOK_PLACE_SEARCH_MIN_LENGTH,
  type FacebookPlaceOption,
} from '@/lib/platforms/facebook-places-types';
import { cn } from '@/lib/utils';
import type { ApiResponse } from '@/types';

/** Selected place values stored on the draft. */
export interface FacebookPlaceValue {
  /** Facebook Page ID used as the Reels `place` parameter. */
  placeId: string;
  /** Display name for UI rendering. */
  placeName: string;
}

interface FacebookPlaceComboboxProps {
  /** Trigger button id (label `htmlFor`). */
  id: string;
  /** Tagged place Page ID, if any. */
  placeId?: string;
  /** Tagged place display name. */
  placeName?: string;
  /** Called when the tagged place changes or is cleared. */
  onPlaceChange: (value: FacebookPlaceValue | undefined) => void;
  /** Additional classes for the trigger button. */
  className?: string;
}

/**
 * Routes wheel events to a scroll container inside a modal dialog.
 * @param event - Wheel event from the place list container.
 */
function handleListWheel(event: WheelEvent<HTMLDivElement>) {
  event.stopPropagation();
  event.preventDefault();
  event.currentTarget.scrollTop += event.deltaY;
}

/**
 * Facebook place picker with search backed by the server proxy route.
 * @param props - Picker configuration and callbacks.
 * @returns Place search picker UI.
 */
export function FacebookPlaceCombobox({
  id,
  placeId,
  placeName,
  onPlaceChange,
  className,
}: FacebookPlaceComboboxProps) {
  const listboxId = useId();
  const optionIdPrefix = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [panelQuery, setPanelQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FacebookPlaceOption[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  useEffect(() => {
    if (!open) return;

    const trimmed = panelQuery.trim();
    if (trimmed.length < FACEBOOK_PLACE_SEARCH_MIN_LENGTH) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(null);
      setSearchNotice(null);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);
    setSearchNotice(null);
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/platforms/facebook/places?q=${encodeURIComponent(trimmed)}`,
          { cache: 'no-store' }
        );
        const payload = (await response.json()) as ApiResponse<FacebookPlaceOption[]> & {
          message?: string;
        };
        if (!response.ok) {
          throw new Error(payload.message ?? 'Failed to search places');
        }
        if (!cancelled) {
          setSearchResults(Array.isArray(payload.data) ? payload.data : []);
          setSearchNotice(payload.message?.trim() ? payload.message : null);
        }
      } catch (err) {
        if (!cancelled) {
          setSearchResults([]);
          setSearchError(err instanceof Error ? err.message : 'Failed to search places');
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
  }, [open, panelQuery]);

  const trimmedQuery = panelQuery.trim();
  const trimmedPlaceName = placeName?.trim() ?? '';

  const getPlaceOptionId = (place: FacebookPlaceOption) => `${optionIdPrefix}-place-${place.id}`;

  const highlightedOptionId =
    open && highlightedIndex >= 0 && highlightedIndex < searchResults.length
      ? getPlaceOptionId(searchResults[highlightedIndex]!)
      : undefined;

  useEffect(() => {
    if (!open) {
      setHighlightedIndex(-1);
      return;
    }
    setHighlightedIndex(searchResults.length > 0 ? 0 : -1);
  }, [open, searchResults]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setPanelQuery('');
      setSearchResults([]);
      setSearchError(null);
      setSearchNotice(null);
    }
    setOpen(nextOpen);
  };

  const selectPlace = (place: FacebookPlaceOption) => {
    onPlaceChange({ placeId: place.id, placeName: place.name });
    setOpen(false);
    setPanelQuery('');
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const optionCount = searchResults.length;

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
      if (highlightedIndex >= 0 && highlightedIndex < searchResults.length) {
        const place = searchResults[highlightedIndex];
        if (place) selectPlace(place);
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
      {trimmedPlaceName && placeId ? (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {trimmedPlaceName}
          </span>
          <button
            type="button"
            aria-label="Remove tagged place"
            onClick={() => onPlaceChange(undefined)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
          <PopoverTrigger asChild>
            <button
              id={id}
              type="button"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-controls={open ? listboxId : undefined}
              className={cn(
                className,
                'flex h-10 w-full items-center justify-between text-left text-muted-foreground'
              )}
            >
              <span className="min-w-0 flex-1 truncate text-left">Search for a place</span>
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 self-center opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            aria-label="Facebook places"
            align="start"
            side="bottom"
            className="w-[var(--radix-popover-trigger-width)] p-0"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              searchInputRef.current?.focus();
            }}
          >
            <div className="border-b border-border p-2">
              <Input
                ref={searchInputRef}
                value={panelQuery}
                onChange={(event) => setPanelQuery(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search places"
                autoComplete="off"
                aria-label="Search places"
                role="combobox"
                aria-expanded={open}
                aria-controls={listboxId}
                aria-activedescendant={highlightedOptionId}
                aria-autocomplete="list"
              />
            </div>
            <div
              className="scrollbar-visible max-h-52 overflow-y-auto overscroll-y-contain"
              onWheel={handleListWheel}
            >
              <div aria-live="polite" aria-atomic="true">
                {searchLoading ? (
                  <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Searching places…
                  </div>
                ) : null}
                {searchError ? (
                  <p className="px-3 py-3 text-sm text-red-600 dark:text-red-400">{searchError}</p>
                ) : null}
                {searchNotice ? (
                  <p className="px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    {searchNotice}
                  </p>
                ) : null}
                {!searchLoading &&
                !searchError &&
                trimmedQuery.length >= FACEBOOK_PLACE_SEARCH_MIN_LENGTH &&
                searchResults.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-muted-foreground">No places found.</p>
                ) : null}
                {!searchLoading &&
                trimmedQuery.length > 0 &&
                trimmedQuery.length < FACEBOOK_PLACE_SEARCH_MIN_LENGTH ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    Type {FACEBOOK_PLACE_SEARCH_MIN_LENGTH} or more characters to search.
                  </p>
                ) : null}
              </div>
              <div id={listboxId} role="listbox" aria-label="Place options">
                {searchResults.map((place, index) => (
                  <button
                    key={place.id}
                    id={getPlaceOptionId(place)}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={placeId === place.id}
                    className={cn(
                      'flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                      index === highlightedIndex && 'bg-accent text-accent-foreground'
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectPlace(place)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                  >
                    <span className="font-medium">{place.name}</span>
                    {place.location ? (
                      <span className="text-xs text-muted-foreground">{place.location}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        Optionally tag a Facebook Page as the location for this Reel.
      </p>
    </div>
  );
}
