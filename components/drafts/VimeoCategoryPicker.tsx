'use client';

import { useMemo, useState, type WheelEvent } from 'react';
import { ChevronDown, ChevronRight, Loader2, Plus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  addVimeoCategoryUri,
  countVimeoCategoryBatchEntries,
  isVimeoCategoryBatchAtLimit,
  removeVimeoCategoryUri,
  VIMEO_MAX_VIDEO_CATEGORY_BATCH_ENTRIES,
  vimeoCategoryChipLabelForUri,
  wouldAddingVimeoCategoryExceedLimit,
  type VimeoCategoryOption,
} from '@/lib/platforms/vimeo-categories';
import { cn } from '@/lib/utils';

/**
 * Props for {@link VimeoCategoryPicker}.
 * @property id - Base id for form controls.
 * @property value - Selected category/subcategory URIs.
 * @property categories - Category tree fetched from Vimeo.
 * @property onChange - Called when the selected URI list changes.
 * @property onLoadSubcategories - Optional fallback when subcategories were not bundled on first load.
 * @property className - Optional border styling class for the field container.
 */
export interface VimeoCategoryPickerProps {
  id: string;
  value: string[];
  categories: VimeoCategoryOption[];
  onChange: (next: string[]) => void;
  onLoadSubcategories?: (categoryUri: string) => Promise<void>;
  className?: string;
}

/**
 * Routes wheel events to a scroll container inside a modal dialog.
 * Dialog scroll lock can swallow trackpad scrolling on portaled popovers.
 * @param event - Wheel event on the category list container.
 */
function handleListWheel(event: WheelEvent<HTMLDivElement>) {
  event.stopPropagation();
  event.preventDefault();
  event.currentTarget.scrollTop += event.deltaY;
}

/**
 * Returns whether a category row should expose an expand control for subcategories.
 * @param category - Category row from the Vimeo API.
 * @returns True when subcategories are present or Vimeo indicates children exist.
 */
function categoryShowsSubcategoryToggle(category: VimeoCategoryOption): boolean {
  return category.subcategories.length > 0 || category.mayHaveSubcategories === true;
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
  onLoadSubcategories,
  className,
}: VimeoCategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [expandedUris, setExpandedUris] = useState<Set<string>>(() => new Set());
  const [loadingSubcategoryUris, setLoadingSubcategoryUris] = useState<Set<string>>(
    () => new Set()
  );

  const selectedSet = useMemo(() => new Set(value), [value]);
  const batchEntryCount = useMemo(() => countVimeoCategoryBatchEntries(value), [value]);
  const atLimit = isVimeoCategoryBatchAtLimit(value);

  const toggleExpanded = async (category: VimeoCategoryOption) => {
    if (expandedUris.has(category.uri)) {
      setExpandedUris((prev) => {
        const next = new Set(prev);
        next.delete(category.uri);
        return next;
      });
      return;
    }

    if (
      category.subcategories.length === 0 &&
      category.mayHaveSubcategories === true &&
      onLoadSubcategories
    ) {
      setLoadingSubcategoryUris((prev) => new Set(prev).add(category.uri));
      try {
        await onLoadSubcategories(category.uri);
      } finally {
        setLoadingSubcategoryUris((prev) => {
          const next = new Set(prev);
          next.delete(category.uri);
          return next;
        });
      }
    }

    setExpandedUris((prev) => new Set(prev).add(category.uri));
  };

  const toggleSelected = (uri: string) => {
    if (selectedSet.has(uri)) {
      onChange(removeVimeoCategoryUri(value, uri, categories));
      return;
    }
    if (wouldAddingVimeoCategoryExceedLimit(value, uri, categories)) {
      return;
    }
    onChange(addVimeoCategoryUri(value, uri, categories));
  };

  const removeSelected = (uri: string) => {
    onChange(removeVimeoCategoryUri(value, uri, categories));
  };

  const isOptionDisabled = (uri: string, selected: boolean) =>
    !selected && wouldAddingVimeoCategoryExceedLimit(value, uri, categories);

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
            {vimeoCategoryChipLabelForUri(uri, categories)}
            <button
              type="button"
              onClick={() => removeSelected(uri)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${vimeoCategoryChipLabelForUri(uri, categories)} category`}
            >
              x
            </button>
          </span>
        ))}

        <Popover open={open} onOpenChange={setOpen} modal={false}>
          <PopoverTrigger asChild>
            <button
              type="button"
              id={id}
              aria-label="Add Vimeo category"
              aria-disabled={atLimit}
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground hover:text-foreground',
                atLimit && 'cursor-not-allowed opacity-50 hover:text-muted-foreground'
              )}
            >
              <Plus className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-80 p-0"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
              {batchEntryCount} / {VIMEO_MAX_VIDEO_CATEGORY_BATCH_ENTRIES} category slots used.
              Subcategories count as both the parent category and the subcategory.
            </p>
            <div
              className="scrollbar-visible max-h-64 overflow-y-auto overscroll-y-contain py-1"
              onWheel={handleListWheel}
            >
              {categories.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">No categories available.</p>
              ) : (
                categories.map((category) => {
                  const hasSubcategories = category.subcategories.length > 0;
                  const showSubcategoryToggle = categoryShowsSubcategoryToggle(category);
                  const expanded = expandedUris.has(category.uri);
                  const loadingSubcategories = loadingSubcategoryUris.has(category.uri);
                  const categorySelected = selectedSet.has(category.uri);
                  const categoryDisabled = isOptionDisabled(category.uri, categorySelected);

                  return (
                    <div key={category.uri}>
                      <div className="flex items-center gap-1 px-1">
                        {showSubcategoryToggle ? (
                          <button
                            type="button"
                            onClick={() => void toggleExpanded(category)}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${category.name} subcategories`}
                          >
                            {loadingSubcategories ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : expanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        ) : (
                          <span className="inline-block h-7 w-7 shrink-0" aria-hidden="true" />
                        )}
                        <label
                          className={cn(
                            'flex min-h-7 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted',
                            categorySelected && 'bg-muted font-medium text-foreground',
                            categoryDisabled && 'cursor-not-allowed opacity-50 hover:bg-transparent'
                          )}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0"
                            checked={categorySelected}
                            disabled={categoryDisabled}
                            onChange={() => toggleSelected(category.uri)}
                          />
                          <span>{category.name}</span>
                        </label>
                      </div>

                      {expanded && loadingSubcategories ? (
                        <p className="px-3 py-2 pl-14 text-sm text-muted-foreground">
                          Loading subcategories…
                        </p>
                      ) : null}

                      {expanded && !loadingSubcategories && hasSubcategories ? (
                        <div className="pl-9 pr-1">
                          {category.subcategories.map((subcategory) => {
                            const subcategorySelected = selectedSet.has(subcategory.uri);
                            const subcategoryDisabled = isOptionDisabled(
                              subcategory.uri,
                              subcategorySelected
                            );
                            return (
                              <label
                                key={subcategory.uri}
                                className={cn(
                                  'flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-md py-1 pl-5 pr-2 text-sm hover:bg-muted',
                                  subcategorySelected && 'bg-muted font-medium text-foreground',
                                  subcategoryDisabled &&
                                    'cursor-not-allowed opacity-50 hover:bg-transparent'
                                )}
                              >
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 shrink-0"
                                  checked={subcategorySelected}
                                  disabled={subcategoryDisabled}
                                  onChange={() => toggleSelected(subcategory.uri)}
                                />
                                <span>{subcategory.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      ) : null}
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
