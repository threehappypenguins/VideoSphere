'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent, type WheelEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** One selectable option in {@link YouTubeSearchableSelect}. */
export interface YouTubeSearchableSelectOption {
  /** Stored value (e.g. BCP-47 tag or category id). */
  value: string;
  /** Human-readable label shown in the trigger and list. */
  label: string;
}

interface YouTubeSearchableSelectProps {
  /** Trigger id (label `htmlFor`). */
  id: string;
  /** Selected option value, if any. */
  value?: string;
  /** Placeholder when no value is selected. */
  placeholder?: string;
  /** Full option list (filtered client-side while the panel is open). */
  options: YouTubeSearchableSelectOption[];
  /** Called when the user selects an option or clears the selection. */
  onValueChange: (value: string | undefined) => void;
  /** Additional classes for the trigger button. */
  className?: string;
}

function handleListWheel(event: WheelEvent<HTMLDivElement>) {
  event.stopPropagation();
  event.preventDefault();
  event.currentTarget.scrollTop += event.deltaY;
}

function findMatchingOption(
  value: string | undefined,
  options: YouTubeSearchableSelectOption[]
): YouTubeSearchableSelectOption | undefined {
  if (!value) return undefined;
  const exact = options.find((option) => option.value === value);
  if (exact) return exact;

  const base = value.split('-')[0]?.toLowerCase();
  if (!base) return undefined;

  return options.find((option) => {
    const optionBase = option.value.split('-')[0]?.toLowerCase();
    return optionBase === base;
  });
}

/**
 * Searchable single-select dropdown for YouTube language and category fields.
 * @param props - Select configuration and callbacks.
 * @returns Searchable select UI.
 */
export function YouTubeSearchableSelect({
  id,
  value,
  placeholder = 'Select…',
  options,
  onValueChange,
  className,
}: YouTubeSearchableSelectProps) {
  const listboxId = useId();
  const optionIdPrefix = useId();
  const clearOptionId = `${optionIdPrefix}-clear`;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [panelQuery, setPanelQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const selectedLabel = useMemo(() => findMatchingOption(value, options)?.label, [options, value]);

  const trimmedQuery = panelQuery.trim().toLowerCase();
  const visibleOptions = useMemo(() => {
    if (!trimmedQuery) return options;
    return options.filter((option) => option.label.toLowerCase().includes(trimmedQuery));
  }, [options, trimmedQuery]);

  const clearOptionOffset = 1;
  const optionCount = clearOptionOffset + visibleOptions.length;

  const getOptionId = (optionValue: string) => `${optionIdPrefix}-option-${optionValue}`;

  const highlightedOptionId = (() => {
    if (!open || highlightedIndex < 0) return undefined;
    if (highlightedIndex === 0) return clearOptionId;
    const optionIndex = highlightedIndex - clearOptionOffset;
    const option = visibleOptions[optionIndex];
    return option ? getOptionId(option.value) : undefined;
  })();

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setPanelQuery('');
      setHighlightedIndex(0);
    } else {
      setHighlightedIndex(-1);
    }
    setOpen(nextOpen);
  };

  const selectOption = (option: YouTubeSearchableSelectOption) => {
    onValueChange(option.value);
    setOpen(false);
  };

  const clearSelection = () => {
    onValueChange(undefined);
    setOpen(false);
  };

  const handleHighlightedSelection = () => {
    if (highlightedIndex === 0) {
      clearSelection();
      return;
    }
    const optionIndex = highlightedIndex - clearOptionOffset;
    const option = visibleOptions[optionIndex];
    if (option) selectOption(option);
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
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
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
            !selectedLabel && 'text-muted-foreground'
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left">
            {selectedLabel ?? (value !== undefined && value !== '' ? value : placeholder)}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 self-center opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
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
            onChange={(event) => {
              setPanelQuery(event.target.value);
              setHighlightedIndex(0);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search…"
            autoComplete="off"
            aria-label="Search options"
            aria-activedescendant={highlightedOptionId}
            aria-autocomplete="list"
          />
        </div>
        <div
          id={listboxId}
          role="listbox"
          className="scrollbar-visible max-h-52 overflow-y-auto overscroll-y-contain"
          onWheel={handleListWheel}
        >
          <button
            id={clearOptionId}
            type="button"
            role="option"
            aria-selected={!value}
            className={cn(
              'flex w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              highlightedIndex === 0 && 'bg-accent text-accent-foreground'
            )}
            onMouseDown={(event) => event.preventDefault()}
            onClick={clearSelection}
            onMouseEnter={() => setHighlightedIndex(0)}
          >
            None
          </button>
          {visibleOptions.map((option, index) => {
            const optionIndex = index + clearOptionOffset;
            return (
              <button
                key={option.value}
                id={getOptionId(option.value)}
                type="button"
                role="option"
                aria-selected={value === option.value}
                className={cn(
                  'flex w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                  optionIndex === highlightedIndex && 'bg-accent text-accent-foreground'
                )}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
                onMouseEnter={() => setHighlightedIndex(optionIndex)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
