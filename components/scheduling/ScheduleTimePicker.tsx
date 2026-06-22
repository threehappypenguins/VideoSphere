'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, ClockIcon } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePrefers12HourClock } from '@/hooks/useUserClockFormat';
import {
  buildScheduleTimeStr,
  formatScheduleTimeLabel,
  getScheduleHourOptions,
  normalizeScheduleTimeStr,
  parseScheduleHourInput,
  parseScheduleMinuteInput,
  parseScheduleTimeParts,
  SCHEDULE_MINUTE_OPTIONS,
  to12HourParts,
  to24HourFrom12,
} from '@/lib/schedule-date-time';
import { cn } from '@/lib/utils';

/**
 * Props for {@link ScheduleTimePicker}.
 * @property id - DOM id for the trigger button.
 * @property timeStr - Selected wall-clock time (`HH:MM`, 24-hour storage).
 * @property onTimeChange - Called when the user picks a new time.
 */
export interface ScheduleTimePickerProps {
  id: string;
  timeStr: string;
  onTimeChange: (timeStr: string) => void;
  label?: string;
  className?: string;
  invalid?: boolean;
  disabled?: boolean;
}

interface TimePickerColumnProps<T extends string | number> {
  label: string;
  options: readonly T[];
  selected: T;
  formatOption: (value: T) => string;
  onSelect: (value: T) => void;
  /** When true, shows a text field above the list so values can be typed as well as selected. */
  editable?: boolean;
  /** Parses typed digits on commit; return null to keep the current selection. */
  parseTypedValue?: (value: string) => T | null;
  /** Maximum digit length while typing. */
  maxInputLength?: number;
  /** Optional class names for the column wrapper. */
  className?: string;
}

function TimePickerColumn<T extends string | number>({
  label,
  options,
  selected,
  formatOption,
  onSelect,
  editable = false,
  parseTypedValue,
  maxInputLength = 2,
  className,
}: TimePickerColumnProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const [draftValue, setDraftValue] = useState<string | null>(null);
  const isEditing = draftValue !== null;

  const commitDraft = () => {
    if (draftValue === null) {
      return;
    }

    const parsed = parseTypedValue?.(draftValue);
    if (parsed !== null && parsed !== undefined) {
      onSelect(parsed);
    }
    setDraftValue(null);
  };

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'center' });
  }, [selected]);

  useEffect(() => {
    const node = listRef.current;
    if (!node) {
      return;
    }

    const onWheel = (event: globalThis.WheelEvent) => {
      node.scrollTop += event.deltaY;
      event.preventDefault();
      event.stopPropagation();
    };

    const onTouchMove = (event: globalThis.TouchEvent) => {
      event.stopPropagation();
    };

    node.addEventListener('wheel', onWheel, { passive: false, capture: true });
    node.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });

    return () => {
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  return (
    <div className={cn('min-w-0', className)}>
      <p className="mb-1 text-center text-[11px] font-medium text-muted-foreground sm:mb-2 sm:text-xs">
        {label}
      </p>
      {editable ? (
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label={`${label} (type or select)`}
          maxLength={maxInputLength}
          value={isEditing ? draftValue : formatOption(selected)}
          className="mb-1 h-8 min-w-0 px-1 text-center text-xs tabular-nums sm:mb-2 sm:px-2 sm:text-sm"
          onFocus={(event) => {
            setDraftValue(formatOption(selected));
            event.target.select();
          }}
          onChange={(event) => {
            setDraftValue(event.target.value.replace(/\D/g, '').slice(0, maxInputLength));
          }}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitDraft();
              event.currentTarget.blur();
            }
          }}
        />
      ) : null}
      <div
        ref={listRef}
        className="max-h-[min(9rem,var(--radix-popover-content-available-height,9rem))] overflow-y-auto overscroll-y-contain rounded-md border border-border bg-background sm:max-h-[min(12rem,var(--radix-popover-content-available-height,12rem))]"
        role="listbox"
        aria-label={label}
      >
        {options.map((option) => {
          const isSelected = option === selected;
          return (
            <button
              key={String(option)}
              ref={isSelected ? selectedRef : undefined}
              type="button"
              role="option"
              aria-selected={isSelected}
              className={cn(
                'flex w-full items-center gap-1 px-1 py-1 text-xs transition-colors hover:bg-muted sm:gap-2 sm:px-2 sm:py-1.5 sm:text-sm',
                isSelected && 'bg-primary/10 font-medium text-primary'
              )}
              onClick={() => onSelect(option)}
            >
              <span className="hidden w-4 shrink-0 justify-center sm:inline-flex">
                {isSelected ? <CheckIcon className="size-3.5" aria-hidden="true" /> : null}
              </span>
              <span className="w-full text-center sm:w-auto sm:text-left">
                {formatOption(option)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface MeridiemToggleProps {
  selected: 'AM' | 'PM';
  onSelect: (period: 'AM' | 'PM') => void;
  className?: string;
}

/**
 * Compact AM/PM control for 12-hour schedule pickers.
 * @param props - Selected meridiem and change handler.
 * @returns Segmented AM/PM toggle buttons.
 */
function MeridiemToggle({ selected, onSelect, className }: MeridiemToggleProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="mb-1 text-center text-[11px] font-medium text-muted-foreground sm:mb-2 sm:text-xs">
        AM/PM
      </p>
      <div
        className="grid grid-cols-2 gap-1 rounded-md border border-border bg-background p-1"
        role="listbox"
        aria-label="AM/PM"
      >
        {(['AM', 'PM'] as const).map((period) => {
          const isSelected = period === selected;
          return (
            <button
              key={period}
              type="button"
              role="option"
              aria-selected={isSelected}
              className={cn(
                'rounded px-1 py-2 text-xs font-medium transition-colors sm:px-2 sm:py-2.5 sm:text-sm',
                isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
              )}
              onClick={() => onSelect(period)}
            >
              {period}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Scroll-column time picker with locale-aware 12h or 24h hour labels.
 * Hour and minute columns support both scrolling/clicking and direct numeric entry.
 * @param props - Trigger id, value, change handler, and styling.
 * @returns Popover time picker trigger and panel.
 */
export function ScheduleTimePicker({
  id,
  timeStr,
  onTimeChange,
  label = 'Time',
  className,
  invalid = false,
  disabled = false,
}: ScheduleTimePickerProps) {
  const [open, setOpen] = useState(false);
  const use12Hour = usePrefers12HourClock();
  const normalizedTime = normalizeScheduleTimeStr(timeStr);
  const parsed = parseScheduleTimeParts(normalizedTime) ?? { hour: 12, minute: 0 };
  const hourOptions = useMemo(() => getScheduleHourOptions(use12Hour), [use12Hour]);
  const display12 = to12HourParts(parsed.hour);

  const updateTime = (hour24: number, minute: number) => {
    onTimeChange(buildScheduleTimeStr(hour24, minute));
  };

  return (
    <div className="w-full min-w-0">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            disabled={disabled}
            data-time={normalizedTime}
            className={cn(
              'mt-1 w-full rounded-md border border-input bg-background px-3 text-sm font-normal ring-offset-background hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
              className,
              'flex h-10 min-w-0 items-center justify-between text-left',
              !normalizedTime && 'text-muted-foreground',
              invalid && 'border-red-600 focus-visible:ring-red-600 dark:border-red-500'
            )}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <ClockIcon className="size-4 shrink-0 opacity-70" aria-hidden="true" />
              <span className="truncate">
                {normalizedTime
                  ? formatScheduleTimeLabel(normalizedTime, { hour12: use12Hour })
                  : 'Select time'}
              </span>
            </span>
            <ChevronDownIcon
              className="ml-2 size-4 shrink-0 self-center opacity-50"
              aria-hidden="true"
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[calc(100dvw-2rem)] max-w-none p-2 sm:w-auto sm:max-w-[calc(100dvw-2rem)] sm:p-3"
          align="center"
          side="bottom"
          collisionPadding={16}
        >
          <div
            className={cn(
              'grid w-full min-w-0 gap-1 sm:gap-2',
              use12Hour ? 'max-sm:grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'
            )}
          >
            <TimePickerColumn
              label="Hour"
              options={hourOptions}
              selected={use12Hour ? display12.hour12 : parsed.hour}
              editable
              maxInputLength={2}
              formatOption={(value) => String(value).padStart(use12Hour ? 1 : 2, '0')}
              parseTypedValue={(value) => {
                const parsedHour = parseScheduleHourInput(value, use12Hour);
                return parsedHour === null ? null : (parsedHour as (typeof hourOptions)[number]);
              }}
              onSelect={(value) => {
                const hour24 = use12Hour
                  ? to24HourFrom12(Number(value), display12.period)
                  : Number(value);
                updateTime(hour24, parsed.minute);
              }}
            />
            <TimePickerColumn
              label="Minute"
              options={SCHEDULE_MINUTE_OPTIONS}
              selected={parsed.minute}
              editable
              maxInputLength={2}
              formatOption={(value) => String(value).padStart(2, '0')}
              parseTypedValue={(value) => parseScheduleMinuteInput(value)}
              onSelect={(minute) => updateTime(parsed.hour, minute)}
            />
            {use12Hour ? (
              <MeridiemToggle
                className="max-sm:col-span-2"
                selected={display12.period}
                onSelect={(period) =>
                  updateTime(to24HourFrom12(display12.hour12, period), parsed.minute)
                }
              />
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
