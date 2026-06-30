'use client';

import {
  draftLabelColorWithAlpha,
  lookupDraftLabelColor,
  normalizeDraftLabelColor,
} from '@/lib/draft-labels';
import { cn } from '@/lib/utils';
import type { DraftLabelDefinition } from '@/types';
import { DraftLabelColorPicker } from '@/components/drafts/DraftLabelColorPicker';

interface DraftLabelChipProps {
  /** Label text shown on the chip. */
  label: string;
  /** Saved library used to resolve color when `color` is omitted. */
  library?: readonly DraftLabelDefinition[];
  /** Explicit chip color override. */
  color?: string;
  /** Optional class names for the outer chip element. */
  className?: string;
  /** When set, shows a remove button on the chip. */
  onRemove?: () => void;
  /** When set, shows an inline color picker on the chip. */
  onColorChange?: (color: string) => void;
  /** When true, color editing and remove are disabled. */
  disabled?: boolean;
}

/**
 * Renders a colored draft label chip with optional remove and color controls.
 * @param props - Label text, color, and optional handlers.
 * @returns Styled label chip.
 */
export function DraftLabelChip({
  label,
  library = [],
  color,
  className,
  onRemove,
  onColorChange,
  disabled = false,
}: DraftLabelChipProps) {
  const resolvedColor = normalizeDraftLabelColor(color ?? lookupDraftLabelColor(library, label));

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-snug',
        className
      )}
      style={{
        backgroundColor: draftLabelColorWithAlpha(resolvedColor, 0.14),
        borderColor: draftLabelColorWithAlpha(resolvedColor, 0.45),
        color: resolvedColor,
      }}
    >
      {onColorChange ? (
        <DraftLabelColorPicker
          color={resolvedColor}
          onChange={onColorChange}
          ariaLabel={`Change color for ${label}`}
          disabled={disabled}
        />
      ) : null}
      <span className="truncate">{label}</span>
      {onRemove && !disabled ? (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 opacity-70 hover:opacity-100"
          aria-label={`Remove ${label} label`}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
