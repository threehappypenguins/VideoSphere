'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { DRAFT_LABEL_COLOR_PRESETS, normalizeDraftLabelColor } from '@/lib/draft-labels';
import { cn } from '@/lib/utils';

interface DraftLabelColorPickerProps {
  /** Current hex color for the label. */
  color: string;
  /** Called when the user selects a new color. */
  onChange: (color: string) => void;
  /** Accessible name for the trigger button. */
  ariaLabel: string;
  /** When true, the picker is disabled. */
  disabled?: boolean;
}

/**
 * Compact color picker for draft labels with preset swatches and a custom color input.
 * @param props - Current color and change handler.
 * @returns Popover color picker trigger and panel.
 */
export function DraftLabelColorPicker({
  color,
  onChange,
  ariaLabel,
  disabled = false,
}: DraftLabelColorPickerProps) {
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const normalizedColor = normalizeDraftLabelColor(color);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/80 ring-offset-background transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-60',
          open && 'ring-2 ring-ring ring-offset-1'
        )}
      >
        <span
          className="block h-3.5 w-3.5 rounded-full"
          style={{ backgroundColor: normalizedColor }}
        />
      </button>
      {open && !disabled ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Label color"
          className="absolute left-0 top-full z-40 mt-1 w-44 rounded-md border border-border bg-background p-2 shadow-md"
        >
          <div className="grid grid-cols-5 gap-1.5">
            {DRAFT_LABEL_COLOR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-label={`Use ${preset}`}
                aria-pressed={preset === normalizedColor}
                onClick={() => {
                  onChange(preset);
                  setOpen(false);
                }}
                className={cn(
                  'h-6 w-6 rounded-full border border-border/70 transition-transform hover:scale-105',
                  preset === normalizedColor && 'ring-2 ring-ring ring-offset-1'
                )}
                style={{ backgroundColor: preset }}
              />
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Custom</span>
            <input
              type="color"
              value={normalizedColor}
              onChange={(event) => onChange(normalizeDraftLabelColor(event.target.value))}
              className="h-7 w-10 cursor-pointer rounded border border-border bg-background p-0.5"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
