'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent, type WheelEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface YouTubeTimezoneSelectProps {
  /** Trigger id (label `htmlFor`). */
  id: string;
  /** Selected IANA timezone name. */
  value: string;
  /** Full timezone list (typically from {@link getSupportedTimeZones}). */
  options: readonly string[];
  /** Called when the user selects a timezone. */
  onValueChange: (value: string) => void;
  /** Additional classes for the trigger button. */
  className?: string;
}

function handleListWheel(event: WheelEvent<HTMLDivElement>) {
  event.stopPropagation();
  event.preventDefault();
  event.currentTarget.scrollTop += event.deltaY;
}

/**
 * Searchable timezone picker for YouTube schedule fields.
 * @param props - Picker configuration and callbacks.
 * @returns Searchable timezone select UI.
 */
export function YouTubeTimezoneSelect({
  id,
  value,
  options,
  onValueChange,
  className,
}: YouTubeTimezoneSelectProps) {
  const listboxId = useId();
  const optionIdPrefix = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [panelQuery, setPanelQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const trimmedQuery = panelQuery.trim().toLowerCase();
  const visibleOptions = useMemo(() => {
    if (!trimmedQuery) return options;
    return options.filter((timeZone) => timeZone.toLowerCase().includes(trimmedQuery));
  }, [options, trimmedQuery]);

  const getOptionId = (timeZone: string) => `${optionIdPrefix}-option-${timeZone}`;

  const highlightedOptionId =
    open && highlightedIndex >= 0 && visibleOptions[highlightedIndex]
      ? getOptionId(visibleOptions[highlightedIndex])
      : undefined;

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setPanelQuery('');
      const selectedIndex = options.findIndex((timeZone) => timeZone === value);
      setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : options.length > 0 ? 0 : -1);
    } else {
      setHighlightedIndex(-1);
    }
    setOpen(nextOpen);
  };

  const selectOption = (timeZone: string) => {
    onValueChange(timeZone);
    setOpen(false);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((prev) =>
        visibleOptions.length === 0 ? -1 : (prev + 1) % visibleOptions.length
      );
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((prev) =>
        visibleOptions.length === 0
          ? -1
          : (prev - 1 + visibleOptions.length) % visibleOptions.length
      );
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = visibleOptions[highlightedIndex];
      if (option) selectOption(option);
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
            'flex h-10 min-w-0 flex-1 items-center justify-between text-left text-sm'
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left">{value}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 self-center opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-[min(24rem,var(--radix-popover-trigger-width))] p-0"
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
              const nextQuery = event.target.value;
              setPanelQuery(nextQuery);
              const trimmed = nextQuery.trim().toLowerCase();
              const filtered = trimmed
                ? options.filter((timeZone) => timeZone.toLowerCase().includes(trimmed))
                : options;
              const selectedIndex = filtered.findIndex((timeZone) => timeZone === value);
              setHighlightedIndex(
                selectedIndex >= 0 ? selectedIndex : filtered.length > 0 ? 0 : -1
              );
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search timezones…"
            autoComplete="off"
            aria-label="Search timezones"
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
          {visibleOptions.map((timeZone, index) => (
            <button
              key={timeZone}
              id={getOptionId(timeZone)}
              type="button"
              role="option"
              aria-selected={value === timeZone}
              className={cn(
                'flex w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                index === highlightedIndex && 'bg-accent text-accent-foreground'
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(timeZone)}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              {timeZone}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
