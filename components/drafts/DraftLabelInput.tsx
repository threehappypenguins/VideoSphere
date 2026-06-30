'use client';

import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
} from 'react';
import { DraftLabelChip } from '@/components/drafts/DraftLabelChip';
import {
  MAX_DRAFT_LABELS_PER_DRAFT,
  mergeDraftLabelLibraryEntries,
  mergeUniqueDraftLabels,
  parseDraftLabelInput,
} from '@/lib/draft-labels';
import { cn } from '@/lib/utils';
import type { ApiResponse, DraftLabelDefinition } from '@/types';

interface DraftLabelInputProps {
  /** Current labels on the draft. */
  labels: string[];
  /** Saved label definitions used for chip colors and autocomplete. */
  labelLibrary?: DraftLabelDefinition[];
  /** Called when the saved library changes (for example, after a color edit). */
  onLabelLibraryChange?: (library: DraftLabelDefinition[]) => void;
  /** Called when the label list changes. */
  onChange: (labels: string[]) => void;
  /** When true, editing is disabled. */
  disabled?: boolean;
  /** Optional stable id prefix for the text input. */
  inputId?: string;
}

/** Imperative handle for flushing pending label input before save. */
export interface DraftLabelInputHandle {
  /** Commits any pending text in the input as labels. */
  commitPending: () => void;
}

/**
 * Chip input for draft organizational labels with autocomplete from the saved library.
 * @param props - Label value and change handlers.
 * @returns Draft label editor with suggestion list.
 */
export const DraftLabelInput = forwardRef<DraftLabelInputHandle, DraftLabelInputProps>(
  function DraftLabelInput(
    {
      labels,
      labelLibrary,
      onLabelLibraryChange,
      onChange,
      disabled = false,
      inputId = 'draft-labels',
    },
    ref
  ) {
    const listboxId = useId();
    const containerRef = useRef<HTMLDivElement>(null);
    const [inputValue, setInputValue] = useState('');
    const [fetchedLibrary, setFetchedLibrary] = useState<DraftLabelDefinition[]>([]);
    const [suggestions, setSuggestions] = useState<DraftLabelDefinition[]>([]);
    const [suggestionsOpen, setSuggestionsOpen] = useState(false);
    const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
    const library = labelLibrary ?? fetchedLibrary;

    const loadSuggestions = useCallback(
      async (query: string) => {
        try {
          const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
          const response = await fetch(`/api/drafts/labels${params}`, { cache: 'no-store' });
          if (!response.ok) return;
          const payload = (await response.json()) as ApiResponse<DraftLabelDefinition[]>;
          const next = Array.isArray(payload.data) ? payload.data : [];
          if (query.trim()) {
            setSuggestions(next);
            setSuggestionsOpen(next.length > 0);
            setActiveSuggestionIndex(next.length > 0 ? 0 : -1);
            return;
          }
          if (!labelLibrary) {
            setFetchedLibrary(next);
          }
        } catch {
          setSuggestions([]);
          setSuggestionsOpen(false);
        }
      },
      [labelLibrary]
    );

    useEffect(() => {
      if (disabled) return;
      const trimmedQuery = inputValue.trim();
      if (!trimmedQuery && labelLibrary) {
        return;
      }
      const handle = window.setTimeout(
        () => {
          void loadSuggestions(inputValue);
        },
        trimmedQuery ? 200 : 0
      );
      return () => window.clearTimeout(handle);
    }, [disabled, inputValue, labelLibrary, loadSuggestions]);

    useEffect(() => {
      const handlePointerDown = (event: MouseEvent) => {
        if (!containerRef.current?.contains(event.target as Node)) {
          setSuggestionsOpen(false);
        }
      };
      document.addEventListener('mousedown', handlePointerDown);
      return () => document.removeEventListener('mousedown', handlePointerDown);
    }, []);

    const syncLibraryEntries = useCallback(
      async (entries: DraftLabelDefinition[]) => {
        if (entries.length === 0) return;
        try {
          const response = await fetch('/api/drafts/labels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ labels: entries }),
          });
          if (!response.ok) return;
          const payload = (await response.json()) as ApiResponse<DraftLabelDefinition[]>;
          if (Array.isArray(payload.data)) {
            if (!labelLibrary) {
              setFetchedLibrary(payload.data);
            }
            onLabelLibraryChange?.(payload.data);
          }
        } catch {
          // Library sync is best-effort; draft save also syncs label names.
        }
      },
      [labelLibrary, onLabelLibraryChange]
    );

    const upsertLabelNamesInLibrary = useCallback(
      async (nextLabels: string[]) => {
        if (nextLabels.length === 0) return;
        try {
          const response = await fetch('/api/drafts/labels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ labels: nextLabels }),
          });
          if (!response.ok) return;
          const payload = (await response.json()) as ApiResponse<DraftLabelDefinition[]>;
          if (Array.isArray(payload.data)) {
            if (!labelLibrary) {
              setFetchedLibrary(payload.data);
            }
            onLabelLibraryChange?.(payload.data);
          }
        } catch {
          // Library upsert is best-effort; draft save also syncs labels.
        }
      },
      [labelLibrary, onLabelLibraryChange]
    );

    const addLabels = useCallback(
      (parsed: string[]) => {
        if (parsed.length === 0) return;
        const merged = mergeUniqueDraftLabels(labels, parsed);
        if (merged.length > MAX_DRAFT_LABELS_PER_DRAFT) return;
        const added = merged.filter((label) => !labels.includes(label));
        onChange(merged);
        void upsertLabelNamesInLibrary(added.length > 0 ? added : parsed);
        setInputValue('');
        setSuggestionsOpen(false);
      },
      [labels, onChange, upsertLabelNamesInLibrary]
    );

    const updateLabelColor = useCallback(
      (label: string, color: string) => {
        const next = mergeDraftLabelLibraryEntries(library, [{ name: label, color }]);
        if (labelLibrary) {
          onLabelLibraryChange?.(next);
        } else {
          setFetchedLibrary(next);
        }
        void syncLibraryEntries([{ name: label, color }]);
      },
      [labelLibrary, library, onLabelLibraryChange, syncLibraryEntries]
    );

    const commitInput = useCallback(() => {
      addLabels(parseDraftLabelInput(inputValue));
    }, [addLabels, inputValue]);

    useImperativeHandle(ref, () => ({ commitPending: commitInput }), [commitInput]);

    const visibleSuggestions = suggestions.filter(
      (suggestion) => !labels.some((label) => label.toLowerCase() === suggestion.name.toLowerCase())
    );

    return (
      <div ref={containerRef} className="relative">
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          Labels
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          Organize drafts in VideoSphere. Press Enter or comma to add a label. Use the color dot to
          customize each label.
        </p>
        <div
          className={cn(
            'mt-2 flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5',
            disabled && 'opacity-60'
          )}
        >
          {labels.map((label) => (
            <DraftLabelChip
              key={label}
              label={label}
              library={library}
              onColorChange={(color) => updateLabelColor(label, color)}
              onRemove={() => onChange(labels.filter((existing) => existing !== label))}
              disabled={disabled}
            />
          ))}
          {!disabled ? (
            <input
              id={inputId}
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              onFocus={() => {
                void loadSuggestions(inputValue);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  if (
                    suggestionsOpen &&
                    activeSuggestionIndex >= 0 &&
                    visibleSuggestions[activeSuggestionIndex]
                  ) {
                    addLabels([visibleSuggestions[activeSuggestionIndex].name]);
                    return;
                  }
                  commitInput();
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  if (visibleSuggestions.length === 0) return;
                  setSuggestionsOpen(true);
                  setActiveSuggestionIndex((index) =>
                    index >= visibleSuggestions.length - 1 ? 0 : index + 1
                  );
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  if (visibleSuggestions.length === 0) return;
                  setSuggestionsOpen(true);
                  setActiveSuggestionIndex((index) =>
                    index <= 0 ? visibleSuggestions.length - 1 : index - 1
                  );
                } else if (event.key === 'Escape') {
                  setSuggestionsOpen(false);
                } else if (event.key === 'Backspace' && inputValue === '' && labels.length > 0) {
                  event.preventDefault();
                  const lastLabel = labels[labels.length - 1];
                  onChange(labels.slice(0, -1));
                  setInputValue(lastLabel);
                }
              }}
              onBlur={() => {
                commitInput();
              }}
              role="combobox"
              aria-expanded={suggestionsOpen && visibleSuggestions.length > 0}
              aria-controls={listboxId}
              aria-autocomplete="list"
              placeholder={labels.length === 0 ? 'Add a label…' : ''}
              disabled={disabled || labels.length >= MAX_DRAFT_LABELS_PER_DRAFT}
              className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          ) : null}
        </div>
        {suggestionsOpen && visibleSuggestions.length > 0 && !disabled ? (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute z-30 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-background py-1 shadow-md"
          >
            {visibleSuggestions.map((suggestion, index) => (
              <li key={suggestion.name} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeSuggestionIndex}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted',
                    index === activeSuggestionIndex && 'bg-muted'
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    addLabels([suggestion.name]);
                  }}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border border-border/60"
                    style={{ backgroundColor: suggestion.color }}
                    aria-hidden
                  />
                  {suggestion.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
);
