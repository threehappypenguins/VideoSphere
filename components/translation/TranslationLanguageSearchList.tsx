'use client';

import { useId, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  filterTranslationLanguages,
  translationLanguagePublicLabel,
  type TranslationLanguageOption,
} from '@/lib/translation/languages';
import { cn } from '@/lib/utils';

type SingleProps = {
  /** Single-select mode for source / public listen. */
  mode: 'single';
  /** Currently selected language code. */
  value: string;
  /** Called when the user picks a language. */
  onValueChange: (code: string) => void;
};

type MultipleProps = {
  /** Multi-select mode for target languages. */
  mode: 'multiple';
  /** Currently selected language codes. */
  value: string[];
  /** Called when a language checkbox is toggled. */
  onToggle: (code: string, checked: boolean) => void;
};

type TranslationLanguageSearchListProps = (SingleProps | MultipleProps) & {
  /** Languages available in this picker. */
  options: readonly TranslationLanguageOption[];
  /** Search input id (for label association). */
  id: string;
  /** Accessible name for the option list. */
  listLabel: string;
  /** Optional class for the outer wrapper. */
  className?: string;
  /**
   * How option rows are labeled.
   * - `admin`: English name + code
   * - `public`: English name + native autonym
   */
  labelStyle?: 'admin' | 'public';
};

/**
 * Formats a row label for the search list.
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
 * Searchable language list with live filter for translation admin and public listen UIs.
 * @param props - Mode, options, and selection handlers.
 * @returns Search field plus filtered single- or multi-select list.
 */
export function TranslationLanguageSearchList(props: TranslationLanguageSearchListProps) {
  const { options, id, listLabel, className, labelStyle = 'admin' } = props;
  const listId = useId();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => filterTranslationLanguages(options, query), [options, query]);

  return (
    <div className={cn('space-y-2', className)}>
      <Input
        id={id}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search languages…"
        autoComplete="off"
        aria-controls={listId}
        aria-autocomplete="list"
      />
      <div
        id={listId}
        role="listbox"
        aria-label={listLabel}
        aria-multiselectable={props.mode === 'multiple' || undefined}
        className="border-input bg-background max-h-56 space-y-1 overflow-y-auto rounded-md border p-2"
      >
        {filtered.length === 0 ? (
          <p className="text-muted-foreground px-1 py-2 text-sm">
            No languages match “{query.trim()}”.
          </p>
        ) : props.mode === 'single' ? (
          filtered.map((lang) => {
            const selected = props.value === lang.code;
            return (
              <button
                key={lang.code}
                type="button"
                role="option"
                aria-selected={selected}
                className={cn(
                  'hover:bg-muted/50 flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-left text-sm',
                  selected && 'bg-primary/10 text-primary'
                )}
                onClick={() => props.onValueChange(lang.code)}
              >
                {rowLabel(lang, labelStyle)}
              </button>
            );
          })
        ) : (
          filtered.map((lang) => {
            const checked = props.value.includes(lang.code);
            return (
              <label
                key={lang.code}
                className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  role="option"
                  aria-selected={checked}
                  className="border-input text-primary size-4 accent-current"
                  checked={checked}
                  onChange={(e) => props.onToggle(lang.code, e.target.checked)}
                />
                <span>{rowLabel(lang, labelStyle)}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
