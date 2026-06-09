'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type WheelEvent } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { YOUTUBE_LOCATION_SEARCH_MIN_LENGTH } from '@/lib/platforms/google-places';
import { cn } from '@/lib/utils';
import type { ApiResponse } from '@/types';
import type { GooglePlaceLocation, GooglePlaceSuggestion } from '@/lib/platforms/google-places';

/** Selected recording location stored on the draft. */
export interface YouTubeLocationValue {
  /** Text sent to `recordingDetails.locationDescription`. */
  recordingLocationDescription?: string;
  /** Latitude sent to `recordingDetails.location.latitude`. */
  recordingLocationLatitude?: number;
  /** Longitude sent to `recordingDetails.location.longitude`. */
  recordingLocationLongitude?: number;
}

interface YouTubeLocationComboboxProps {
  /** Trigger button id (label `htmlFor`). */
  id: string;
  /** Current location description shown on the trigger. */
  recordingLocationDescription?: string;
  /** Called when the user selects or clears a validated place. */
  onLocationChange: (value: YouTubeLocationValue) => void;
  /** Additional classes for the trigger button. */
  className?: string;
}

/**
 * Routes wheel events to a scroll container inside a modal dialog.
 * @param event - Wheel event from the location list container.
 */
function handleListWheel(event: WheelEvent<HTMLDivElement>) {
  event.stopPropagation();
  event.preventDefault();
  event.currentTarget.scrollTop += event.deltaY;
}

/**
 * YouTube video location picker backed by Google Places Autocomplete (New).
 * Only validated place selections are committed; free text is not saved.
 * @param props - Picker configuration and callbacks.
 * @returns Location picker UI.
 */
export function YouTubeLocationCombobox({
  id,
  recordingLocationDescription,
  onLocationChange,
  className,
}: YouTubeLocationComboboxProps) {
  const listboxId = useId();
  const optionIdPrefix = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelQueryRef = useRef('');
  const sessionTokenRef = useRef('');
  const [open, setOpen] = useState(false);
  const [panelQuery, setPanelQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GooglePlaceSuggestion[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectingPlaceId, setSelectingPlaceId] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [hasTypedSinceOpen, setHasTypedSinceOpen] = useState(false);

  panelQueryRef.current = panelQuery;

  const trimmedQuery = panelQuery.trim();
  const isSearching =
    hasTypedSinceOpen && trimmedQuery.length >= YOUTUBE_LOCATION_SEARCH_MIN_LENGTH;
  const selectedDescription = recordingLocationDescription?.trim() ?? '';

  const getOptionId = (placeId: string) => `${optionIdPrefix}-${placeId}`;

  const highlightedOptionId = (() => {
    if (!open || highlightedIndex < 0 || highlightedIndex >= searchResults.length) {
      return undefined;
    }
    const suggestion = searchResults[highlightedIndex];
    return suggestion ? getOptionId(suggestion.placeId) : undefined;
  })();

  useEffect(() => {
    if (!open) return;

    const trimmed = panelQuery.trim();
    if (!hasTypedSinceOpen || trimmed.length < YOUTUBE_LOCATION_SEARCH_MIN_LENGTH) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/platforms/youtube/locations/search?q=${encodeURIComponent(trimmed)}&sessionToken=${encodeURIComponent(sessionTokenRef.current)}`,
          { cache: 'no-store' }
        );
        if (!response.ok) {
          throw new Error('Failed to search locations');
        }
        const payload = (await response.json()) as ApiResponse<GooglePlaceSuggestion[]>;
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

  useEffect(() => {
    if (!open) {
      setHighlightedIndex(-1);
      return;
    }
    setHighlightedIndex(searchResults.length > 0 ? 0 : -1);
  }, [open, searchResults]);

  const clearPanelQuery = () => {
    panelQueryRef.current = '';
    setPanelQuery('');
    setHasTypedSinceOpen(false);
    setSearchResults([]);
    setSearchLoading(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      sessionTokenRef.current = crypto.randomUUID();
      clearPanelQuery();
    } else {
      clearPanelQuery();
    }
    setOpen(nextOpen);
  };

  const selectPlace = async (suggestion: GooglePlaceSuggestion) => {
    setSelectingPlaceId(suggestion.placeId);
    try {
      const params = new URLSearchParams({
        placeId: suggestion.placeId,
        sessionToken: sessionTokenRef.current,
        description: suggestion.description,
      });
      const response = await fetch(`/api/platforms/youtube/locations/details?${params}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('Failed to resolve location');
      }
      const payload = (await response.json()) as ApiResponse<GooglePlaceLocation>;
      const location = payload.data;
      if (
        !location?.description ||
        location.latitude === undefined ||
        location.longitude === undefined
      ) {
        throw new Error('Invalid location response');
      }

      onLocationChange({
        recordingLocationDescription: location.description,
        recordingLocationLatitude: location.latitude,
        recordingLocationLongitude: location.longitude,
      });
      sessionTokenRef.current = crypto.randomUUID();
      clearPanelQuery();
      setOpen(false);
    } catch {
      // Keep the panel open so the user can retry another suggestion.
    } finally {
      setSelectingPlaceId(null);
    }
  };

  const handlePanelQueryChange = (nextValue: string) => {
    setPanelQuery(nextValue);
    setHasTypedSinceOpen(true);
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
        const suggestion = searchResults[highlightedIndex];
        if (suggestion) void selectPlace(suggestion);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            disabled={selectingPlaceId !== null}
            className={cn(
              className,
              'flex h-10 w-full items-center justify-between text-left',
              !selectedDescription && 'text-muted-foreground',
              selectingPlaceId !== null && 'opacity-70'
            )}
          >
            <span className="min-w-0 flex-1 truncate text-left">
              {selectingPlaceId !== null ? 'Resolving location…' : selectedDescription || 'None'}
            </span>
            {selectingPlaceId !== null ? (
              <Loader2
                className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50"
                aria-hidden="true"
              />
            ) : (
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 self-center opacity-50" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          aria-label="YouTube video locations"
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
              onChange={(event) => handlePanelQueryChange(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search locations"
              autoComplete="off"
              aria-label="Search locations"
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-activedescendant={highlightedOptionId}
              aria-autocomplete="list"
            />
          </div>
          <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
            {isSearching ? 'Search results' : 'Type to search Google Places'}
          </p>
          <div
            className="scrollbar-visible max-h-52 overflow-y-auto overscroll-y-contain"
            onWheel={handleListWheel}
          >
            <div aria-live="polite" aria-atomic="true">
              {searchLoading ? (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Searching locations…
                </div>
              ) : null}
              {!searchLoading && isSearching && searchResults.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">No locations found.</p>
              ) : null}
              {!searchLoading && !isSearching ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">
                  Enter at least {YOUTUBE_LOCATION_SEARCH_MIN_LENGTH} characters to search.
                </p>
              ) : null}
              <ul id={listboxId} role="listbox" aria-label="Location suggestions">
                {searchResults.map((suggestion, index) => {
                  const isHighlighted = index === highlightedIndex;
                  const isSelecting = selectingPlaceId === suggestion.placeId;
                  return (
                    <li key={suggestion.placeId} role="presentation">
                      <button
                        id={getOptionId(suggestion.placeId)}
                        type="button"
                        role="option"
                        aria-selected={isHighlighted}
                        disabled={isSelecting}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted',
                          isHighlighted && 'bg-muted'
                        )}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        onClick={() => void selectPlace(suggestion)}
                      >
                        <span className="min-w-0 flex-1 truncate">{suggestion.description}</span>
                        {isSelecting ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {selectedDescription !== '' ? (
        <button
          type="button"
          className="rounded-md border border-border px-3 py-2 text-xs text-foreground hover:bg-muted"
          onClick={() =>
            onLocationChange({
              recordingLocationDescription: undefined,
              recordingLocationLatitude: undefined,
              recordingLocationLongitude: undefined,
            })
          }
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
