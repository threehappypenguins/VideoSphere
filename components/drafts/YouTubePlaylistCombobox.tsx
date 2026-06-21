'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type WheelEvent,
} from 'react';
import Link from 'next/link';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { ApiError, ApiResponse } from '@/types';

/** Selected playlist values stored on the draft. */
export interface YouTubePlaylistValue {
  /** Known YouTube playlist id from `playlists.list`. */
  playlistId?: string;
  /** Custom playlist title to create at upload time when no id is selected. */
  playlistTitle?: string;
}

interface YouTubePlaylistComboboxProps {
  /** Trigger button id (label `htmlFor`). */
  id: string;
  /** Selected playlist id when chosen from the user's playlist list. */
  playlistId?: string;
  /** Custom playlist title when the user creates a new playlist by name. */
  playlistTitle?: string;
  /** Called when the playlist selection changes. */
  onPlaylistChange: (value: YouTubePlaylistValue) => void;
  /** Additional classes for the trigger button. */
  className?: string;
}

type YouTubePlaylistOption = { id: string; title: string };

/**
 * Routes wheel events to a scroll container inside a modal dialog.
 * @param event - Wheel event from the playlist list container.
 */
function handleListWheel(event: WheelEvent<HTMLDivElement>) {
  event.stopPropagation();
  event.preventDefault();
  event.currentTarget.scrollTop += event.deltaY;
}

function responseIndicatesInsufficientScope(status: number, message: string): boolean {
  if (status !== 403 && status !== 502) return false;
  return message.toLowerCase().includes('insufficient');
}

type FetchRecentYouTubePlaylistsResult =
  | { ok: true; playlists: YouTubePlaylistOption[] }
  | { ok: false; scopeWarning: boolean; loadFailed: true };

async function fetchRecentYouTubePlaylists(
  signal?: AbortSignal
): Promise<FetchRecentYouTubePlaylistsResult> {
  const response = await fetch('/api/platforms/youtube/playlists/recent', {
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  const payload = (await response.json().catch(() => ({}))) as
    | ApiResponse<YouTubePlaylistOption[]>
    | ApiError;
  const message =
    typeof (payload as ApiError).message === 'string' ? (payload as ApiError).message : '';

  if (!response.ok) {
    return {
      ok: false,
      scopeWarning: responseIndicatesInsufficientScope(response.status, message),
      loadFailed: true,
    };
  }

  const data = (payload as ApiResponse<YouTubePlaylistOption[]>).data;
  return { ok: true, playlists: Array.isArray(data) ? data : [] };
}

/**
 * YouTube playlist picker with client-side filtering and optional custom playlist creation.
 * @param props - Picker configuration and callbacks.
 * @returns Playlist picker UI.
 */
export function YouTubePlaylistCombobox({
  id,
  playlistId,
  playlistTitle,
  onPlaylistChange,
  className,
}: YouTubePlaylistComboboxProps) {
  const listboxId = useId();
  const optionIdPrefix = useId();
  const noneOptionId = `${optionIdPrefix}-none`;
  const createOptionId = `${optionIdPrefix}-create`;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [panelQuery, setPanelQuery] = useState('');
  const [playlists, setPlaylists] = useState<YouTubePlaylistOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [scopeWarning, setScopeWarning] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const selectedTitle = useMemo(() => {
    const storedTitle = playlistTitle?.trim();
    if (storedTitle) return storedTitle;
    if (playlistId) {
      const match = playlists.find((playlist) => playlist.id === playlistId);
      if (match?.title) return match.title;
      if (loading) return 'Loading playlist…';
      return playlistId;
    }
    return '';
  }, [loading, playlistId, playlistTitle, playlists]);

  useEffect(() => {
    const needsPreload = Boolean(playlistId?.trim()) && !playlistTitle?.trim();
    if (!open && !needsPreload) return;

    const controller = new AbortController();

    const loadPlaylists = async () => {
      setLoading(true);
      setLoadFailed(false);
      setScopeWarning(false);
      try {
        const result = await fetchRecentYouTubePlaylists(controller.signal);
        if (controller.signal.aborted) return;

        if (result.ok === false) {
          if (result.scopeWarning) {
            setScopeWarning(true);
          }
          setPlaylists([]);
          setLoadFailed(true);
          return;
        }

        setPlaylists(result.playlists);
      } catch {
        if (!controller.signal.aborted) {
          setPlaylists([]);
          setLoadFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadPlaylists();
    return () => {
      controller.abort();
    };
  }, [open, playlistId, playlistTitle]);

  const trimmedQuery = panelQuery.trim();
  const visiblePlaylists = useMemo(() => {
    if (!trimmedQuery) return playlists;
    const needle = trimmedQuery.toLowerCase();
    return playlists.filter((playlist) => playlist.title.toLowerCase().includes(needle));
  }, [playlists, trimmedQuery]);

  const showCreateOption =
    trimmedQuery !== '' &&
    !visiblePlaylists.some(
      (playlist) => playlist.title.toLowerCase() === trimmedQuery.toLowerCase()
    );
  const noneOptionOffset = 1;
  const optionCount = noneOptionOffset + visiblePlaylists.length + (showCreateOption ? 1 : 0);

  const getPlaylistOptionId = (playlist: YouTubePlaylistOption) =>
    `${optionIdPrefix}-playlist-${playlist.id}`;

  const highlightedOptionId = (() => {
    if (!open || highlightedIndex < 0) return undefined;
    if (highlightedIndex === 0) return noneOptionId;
    const playlistIndex = highlightedIndex - noneOptionOffset;
    if (playlistIndex >= 0 && playlistIndex < visiblePlaylists.length) {
      const playlist = visiblePlaylists[playlistIndex];
      return playlist ? getPlaylistOptionId(playlist) : undefined;
    }
    if (showCreateOption && highlightedIndex === optionCount - 1) {
      return createOptionId;
    }
    return undefined;
  })();

  useEffect(() => {
    if (!open) {
      setHighlightedIndex(-1);
      return;
    }
    setHighlightedIndex(optionCount > 0 ? 0 : -1);
  }, [open, optionCount]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setPanelQuery('');
    }
    setOpen(nextOpen);
  };

  const clearPlaylist = () => {
    onPlaylistChange({});
    setOpen(false);
  };

  const selectPlaylist = (playlist: YouTubePlaylistOption) => {
    onPlaylistChange({ playlistId: playlist.id, playlistTitle: playlist.title });
    setOpen(false);
  };

  const selectCustomTitle = (title: string) => {
    onPlaylistChange({ playlistTitle: title });
    setOpen(false);
  };

  const handleHighlightedSelection = () => {
    if (highlightedIndex === 0) {
      clearPlaylist();
      return;
    }
    const playlistIndex = highlightedIndex - noneOptionOffset;
    if (playlistIndex >= 0 && playlistIndex < visiblePlaylists.length) {
      const playlist = visiblePlaylists[playlistIndex];
      if (playlist) selectPlaylist(playlist);
      return;
    }
    if (showCreateOption && highlightedIndex === optionCount - 1) {
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
      {scopeWarning ? (
        <p className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          Playlist access requires reconnecting your YouTube account. Go to{' '}
          <Link href="/profile/connections" className="underline underline-offset-2">
            Profile → Connections
          </Link>
          .
        </p>
      ) : null}
      <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={open ? listboxId : undefined}
            className={cn(
              className,
              'flex h-10 w-full items-center justify-between text-left',
              !selectedTitle && 'text-muted-foreground'
            )}
          >
            <span className="min-w-0 flex-1 truncate text-left">{selectedTitle || 'None'}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 self-center opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          aria-label="YouTube playlist"
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
              onChange={(event) => setPanelQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search playlists"
              autoComplete="off"
              aria-label="Search playlists"
              aria-activedescendant={highlightedOptionId}
              aria-autocomplete="list"
            />
          </div>
          <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
            Your playlists
          </p>
          <div aria-live="polite" aria-atomic="true">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading playlists…
              </div>
            ) : null}
            {!loading && loadFailed ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                Playlists unavailable. Enter a new playlist name below.
              </p>
            ) : null}
            {!loading && !loadFailed && visiblePlaylists.length === 0 && !showCreateOption ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">No playlists found.</p>
            ) : null}
          </div>
          <div
            id={listboxId}
            role="listbox"
            aria-label="Playlist options"
            className="scrollbar-visible max-h-52 overflow-y-auto overscroll-y-contain"
            onWheel={handleListWheel}
          >
            <button
              id={noneOptionId}
              type="button"
              role="option"
              aria-selected={!selectedTitle}
              className={cn(
                'flex w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                highlightedIndex === 0 && 'bg-accent text-accent-foreground'
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={clearPlaylist}
              onMouseEnter={() => setHighlightedIndex(0)}
            >
              None
            </button>
            {visiblePlaylists.map((playlist, index) => {
              const optionIndex = index + noneOptionOffset;
              return (
                <button
                  key={playlist.id}
                  id={getPlaylistOptionId(playlist)}
                  type="button"
                  role="option"
                  aria-selected={playlistId === playlist.id}
                  className={cn(
                    'flex w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                    optionIndex === highlightedIndex && 'bg-accent text-accent-foreground'
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectPlaylist(playlist)}
                  onMouseEnter={() => setHighlightedIndex(optionIndex)}
                >
                  {playlist.title}
                </button>
              );
            })}
            {showCreateOption ? (
              <button
                id={createOptionId}
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
                Create &ldquo;{trimmedQuery}&rdquo;
              </button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      <p className="mt-1 text-xs text-muted-foreground">
        Optional. Choose an existing playlist or create a new one by name at upload time.
      </p>
    </div>
  );
}
