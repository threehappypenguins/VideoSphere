'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Languages } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  filterTranslationLanguages,
  translationLanguagePublicLabel,
  type TranslationLanguageOption,
} from '@/lib/translation/languages';
import { cn } from '@/lib/utils';

/** No-op subscribe — client snapshot is always true after hydration. */
function subscribeAlwaysMounted(): () => void {
  return () => undefined;
}

/**
 * Formats a row label for the language dropdown.
 * @param lang - Language option.
 * @param labelStyle - Admin vs public labeling.
 * @returns Display string.
 */
function rowLabel(lang: TranslationLanguageOption, labelStyle: 'admin' | 'public'): string {
  if (labelStyle === 'public') {
    return translationLanguagePublicLabel(lang.code);
  }
  if (lang.name.localeCompare(lang.nativeName, undefined, { sensitivity: 'accent' }) === 0) {
    return `${lang.name} (${lang.code})`;
  }
  return `${lang.name} (${lang.nativeName}) · ${lang.code}`;
}

/**
 * Searchable single-select language dropdown for the public listen UI.
 * Renders the menu in a `fixed` portal so it is not covered by the captions
 * pane below (a common mobile-only stacking issue with in-tree `absolute` menus).
 * @param props - Options and selection handlers.
 * @returns Trigger plus dropdown panel with optional search.
 */
export function TranslationLanguageCombobox(props: {
  /** Languages available in this picker. */
  options: readonly TranslationLanguageOption[];
  /** Trigger button id (for label association). */
  id: string;
  /** Accessible name for the option list. */
  listLabel: string;
  /** Currently selected language code (empty when none). */
  value: string;
  /** Called when the user picks a language. */
  onValueChange: (code: string) => void;
  /**
   * How option rows are labeled.
   * - `admin`: English name + code
   * - `public`: English name + native autonym
   */
  labelStyle?: 'admin' | 'public';
  /** Optional class for the outer wrapper. */
  className?: string;
  /** Placeholder when no language is selected. */
  placeholder?: string;
  /**
   * Trigger presentation.
   * - `label`: full-width labeled combobox (default)
   * - `icon`: compact Languages glyph for navbar chrome
   */
  triggerMode?: 'label' | 'icon';
}) {
  const {
    options,
    id,
    listLabel,
    value,
    onValueChange,
    labelStyle = 'public',
    className,
    placeholder = 'Select a language…',
    triggerMode = 'label',
  } = props;

  const listboxId = useId();
  const optionIdPrefix = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selectedOptionRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const mounted = useSyncExternalStore(
    subscribeAlwaysMounted,
    () => true,
    () => false
  );

  const filtered = useMemo(() => filterTranslationLanguages(options, query), [options, query]);

  const selectedLabel = useMemo(() => {
    if (!value) return '';
    const match = options.find((lang) => lang.code === value);
    return match ? rowLabel(match, labelStyle) : translationLanguagePublicLabel(value);
  }, [labelStyle, options, value]);

  const highlightedOptionId =
    open && highlightedIndex >= 0 && filtered[highlightedIndex]
      ? `${optionIdPrefix}-${filtered[highlightedIndex]!.code}`
      : undefined;

  useEffect(() => {
    if (!open || !value) return;
    selectedOptionRef.current?.scrollIntoView({ block: 'nearest' });
  }, [filtered, open, value]);

  /**
   * Positions the fixed portal menu under the trigger (and flips above if needed).
   */
  function updatePanelPosition(): void {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gutter = 8;
    const maxHeight = Math.min(280, window.innerHeight - gutter * 2);
    const spaceBelow = window.innerHeight - rect.bottom - gutter;
    const spaceAbove = rect.top - gutter;
    const openUpward = spaceBelow < 160 && spaceAbove > spaceBelow;
    const height = Math.min(maxHeight, openUpward ? spaceAbove : spaceBelow);
    const isIcon = triggerMode === 'icon';
    const width = isIcon ? Math.min(320, window.innerWidth - gutter * 2) : Math.max(rect.width, 12);
    const left = isIcon
      ? Math.max(gutter, Math.min(rect.right - width, window.innerWidth - gutter - width))
      : rect.left;

    setPanelStyle({
      position: 'fixed',
      left,
      width,
      zIndex: 1000,
      maxHeight: height,
      ...(openUpward
        ? { bottom: window.innerHeight - rect.top + 4, top: 'auto' }
        : { top: rect.bottom + 4, bottom: 'auto' }),
    });
  }

  useLayoutEffect(() => {
    if (!open) return;
    updatePanelPosition();
    /**
     * Repositions on viewport changes (rotate, URL bar show/hide, scroll).
     */
    function onReposition(): void {
      updatePanelPosition();
    }
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updatePanelPosition reads triggerMode/DOM
  }, [open, triggerMode]);

  /**
   * Closes the panel and clears ephemeral search/highlight state.
   */
  function closePanel(): void {
    setOpen(false);
    setQuery('');
    setHighlightedIndex(-1);
  }

  /**
   * Opens the panel with highlight on the current selection (or the first option).
   */
  function openPanel(): void {
    const selectedIdx = value ? options.findIndex((lang) => lang.code === value) : -1;
    setQuery('');
    setHighlightedIndex(selectedIdx >= 0 ? selectedIdx : options.length > 0 ? 0 : -1);
    setOpen(true);
  }

  /**
   * Opens or closes the dropdown panel.
   */
  function toggleOpen(): void {
    if (open) closePanel();
    else openPanel();
  }

  /**
   * Selects a language and closes the dropdown.
   * @param code - Language code.
   */
  function selectLanguage(code: string): void {
    onValueChange(code);
    closePanel();
  }

  /**
   * Updates the search query and keeps keyboard highlight in range.
   * @param nextQuery - New search text.
   */
  function handleQueryChange(nextQuery: string): void {
    setQuery(nextQuery);
    const nextFiltered = filterTranslationLanguages(options, nextQuery);
    const selectedIdx = value ? nextFiltered.findIndex((lang) => lang.code === value) : -1;
    setHighlightedIndex(selectedIdx >= 0 ? selectedIdx : nextFiltered.length > 0 ? 0 : -1);
  }

  // Close on outside pointer / Escape. Attach after a tick so the opening tap
  // cannot immediately dismiss the menu on mobile.
  useEffect(() => {
    if (!open) return;

    /**
     * Closes when the user taps/clicks outside trigger + panel.
     * @param event - Pointer event from the document.
     */
    function onPointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      closePanel();
    }

    /**
     * Closes on Escape.
     * @param event - Keyboard event from the document.
     */
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') closePanel();
    }

    const timer = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown);
      document.addEventListener('keydown', onKeyDown);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  /**
   * Keyboard navigation for the search field.
   * @param event - Keyboard event from the search input.
   */
  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (filtered.length === 0) return;
      setHighlightedIndex((prev) => (prev + 1) % filtered.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (filtered.length === 0) return;
      setHighlightedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const lang = highlightedIndex >= 0 ? filtered[highlightedIndex] : undefined;
      if (lang) selectLanguage(lang.code);
    }
  }

  const panel =
    open && mounted
      ? createPortal(
          <div
            ref={panelRef}
            style={panelStyle}
            className="border-input bg-popover text-popover-foreground flex flex-col overflow-hidden rounded-md border shadow-md"
            role="presentation"
          >
            <div className="border-border shrink-0 border-b p-2">
              <Input
                type="search"
                value={query}
                onChange={(event) => handleQueryChange(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search languages…"
                autoComplete="off"
                enterKeyHint="search"
                aria-label="Search languages"
                aria-controls={listboxId}
                aria-activedescendant={highlightedOptionId}
                aria-autocomplete="list"
              />
            </div>
            <div
              id={listboxId}
              role="listbox"
              aria-label={listLabel}
              className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
            >
              {filtered.length === 0 ? (
                <p className="text-muted-foreground px-3 py-3 text-sm">
                  No languages match “{query.trim()}”.
                </p>
              ) : (
                filtered.map((lang, index) => {
                  const selected = value === lang.code;
                  const highlighted = index === highlightedIndex;
                  return (
                    <button
                      key={lang.code}
                      ref={selected ? selectedOptionRef : undefined}
                      id={`${optionIdPrefix}-${lang.code}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={cn(
                        'flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left text-sm',
                        selected
                          ? 'bg-primary/10 text-primary'
                          : highlighted
                            ? 'bg-accent text-accent-foreground'
                            : 'active:bg-muted/50'
                      )}
                      onClick={() => selectLanguage(lang.code)}
                      onPointerEnter={() => setHighlightedIndex(index)}
                    >
                      <span className="min-w-0 flex-1 truncate">{rowLabel(lang, labelStyle)}</span>
                      {selected ? (
                        <Check className="text-primary h-4 w-4 shrink-0" aria-hidden="true" />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )
      : null;

  const iconAriaLabel = selectedLabel
    ? `Language: ${selectedLabel}`
    : placeholder || 'Select a language';

  return (
    <div className={cn('relative', className)}>
      {triggerMode === 'icon' ? (
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-label={iconAriaLabel}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listboxId : undefined}
          title={iconAriaLabel}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={toggleOpen}
        >
          <Languages className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : (
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listboxId : undefined}
          className={cn(
            'border-input bg-background ring-offset-background focus:ring-ring flex h-11 w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm focus:ring-2 focus:ring-offset-2 focus:outline-none',
            !selectedLabel && 'text-muted-foreground'
          )}
          onClick={toggleOpen}
        >
          <span className="min-w-0 flex-1 truncate">{selectedLabel || placeholder}</span>
          <ChevronDown
            className={cn(
              'ml-2 h-4 w-4 shrink-0 opacity-50 transition-transform',
              open && 'rotate-180'
            )}
            aria-hidden="true"
          />
        </button>
      )}
      {panel}
    </div>
  );
}
