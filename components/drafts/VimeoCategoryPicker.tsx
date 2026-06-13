'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  vimeoCategoryLabelForUri,
  type VimeoCategoryOption,
} from '@/lib/platforms/vimeo-categories';
import { cn } from '@/lib/utils';

/**
 * Props for {@link VimeoCategoryPicker}.
 * @property id - Base id for form controls.
 * @property value - Selected category/subcategory URIs.
 * @property categories - Category tree fetched from Vimeo.
 * @property onChange - Called when the selected URI list changes.
 * @property className - Optional border styling class for the field container.
 */
export interface VimeoCategoryPickerProps {
  id: string;
  value: string[];
  categories: VimeoCategoryOption[];
  onChange: (next: string[]) => void;
  className?: string;
}

/**
 * Multi-select Vimeo category picker with expandable subcategories and removable tag chips.
 * @param props - Picker configuration.
 * @returns Category field UI.
 */
export function VimeoCategoryPicker({
  id,
  value,
  categories,
  onChange,
  className,
}: VimeoCategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [expandedUris, setExpandedUris] = useState<Set<string>>(() => new Set());

  const selectedSet = useMemo(() => new Set(value), [value]);

  const toggleExpanded = (uri: string) => {
    setExpandedUris((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) {
        next.delete(uri);
      } else {
        next.add(uri);
      }
      return next;
    });
  };

  const toggleSelected = (uri: string) => {
    if (selectedSet.has(uri)) {
      onChange(value.filter((existing) => existing !== uri));
      return;
    }
    onChange([...value, uri]);
  };

  const removeSelected = (uri: string) => {
    onChange(value.filter((existing) => existing !== uri));
  };

  return (
    <div
      className={cn('mt-1 rounded-md border bg-background px-2 py-2', className)}
      data-testid="vimeo-category-picker"
    >
      <div className="flex flex-wrap items-center gap-2">
        {value.map((uri) => (
          <span
            key={uri}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
          >
            {vimeoCategoryLabelForUri(uri, categories)}
            <button
              type="button"
              onClick={() => removeSelected(uri)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${vimeoCategoryLabelForUri(uri, categories)} category`}
            >
              x
            </button>
          </span>
        ))}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              id={id}
              aria-label="Add Vimeo category"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-80 p-0"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <div
              role="listbox"
              aria-multiselectable="true"
              aria-labelledby={id}
              className="max-h-64 overflow-y-auto py-1"
            >
              {categories.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">No categories available.</p>
              ) : (
                categories.map((category) => {
                  const hasSubcategories = category.subcategories.length > 0;
                  const expanded = expandedUris.has(category.uri);
                  const categorySelected = selectedSet.has(category.uri);

                  return (
                    <div key={category.uri}>
                      <div className="flex items-center gap-1 px-1">
                        {hasSubcategories ? (
                          <button
                            type="button"
                            onClick={() => toggleExpanded(category.uri)}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${category.name} subcategories`}
                          >
                            {expanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        ) : (
                          <span className="inline-block h-7 w-7 shrink-0" aria-hidden="true" />
                        )}
                        <button
                          type="button"
                          role="option"
                          aria-selected={categorySelected}
                          onClick={() => toggleSelected(category.uri)}
                          className={cn(
                            'flex min-h-7 flex-1 items-center rounded-md px-2 text-left text-sm hover:bg-muted',
                            categorySelected && 'bg-muted font-medium text-foreground'
                          )}
                        >
                          {category.name}
                        </button>
                      </div>

                      {hasSubcategories && expanded
                        ? category.subcategories.map((subcategory) => {
                            const subcategorySelected = selectedSet.has(subcategory.uri);
                            return (
                              <button
                                key={subcategory.uri}
                                type="button"
                                role="option"
                                aria-selected={subcategorySelected}
                                onClick={() => toggleSelected(subcategory.uri)}
                                className={cn(
                                  'flex min-h-7 w-full items-center rounded-md py-1 pl-10 pr-2 text-left text-sm hover:bg-muted',
                                  subcategorySelected && 'bg-muted font-medium text-foreground'
                                )}
                              >
                                {subcategory.name}
                              </button>
                            );
                          })
                        : null}
                    </div>
                  );
                })
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
