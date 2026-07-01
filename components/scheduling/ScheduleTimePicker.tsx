'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon, ClockIcon } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePrefers12HourClock } from '@/hooks/useUserClockFormat';
import {
  buildScheduleTimeStr,
  formatScheduleTimeLabel,
  getScheduleHourOptions,
  normalizeScheduleTimeStr,
  parseScheduleTimeInput,
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
  /** Optional class names for the column wrapper. */
  className?: string;
}

function TimePickerColumn<T extends string | number>({
  label,
  options,
  selected,
  formatOption,
  onSelect,
  className,
}: TimePickerColumnProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

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
    <div className={cn('min-w-[4.5rem]', className)}>
      <p className="mb-1 text-center text-[11px] font-medium text-muted-foreground sm:mb-2 sm:text-xs">
        {label}
      </p>
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
                'flex w-full items-center justify-center px-2 py-1.5 text-sm tabular-nums transition-colors hover:bg-muted',
                isSelected && 'bg-primary/10 font-medium text-primary'
              )}
              onClick={() => onSelect(option)}
            >
              {formatOption(option)}
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
    <div className={cn('min-w-[5.5rem]', className)}>
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
 * Scroll-column time picker using the signed-in user's saved 12h or 24h preference.
 * The main field accepts free-form typed times (for example `2:00 pm`); the popover keeps scroll columns.
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
  const [draftValue, setDraftValue] = useState<string | null>(null);
  const use12Hour = usePrefers12HourClock();
  const normalizedTime = normalizeScheduleTimeStr(timeStr);
  const parsed = parseScheduleTimeParts(normalizedTime) ?? { hour: 12, minute: 0 };
  const hourOptions = useMemo(() => getScheduleHourOptions(use12Hour), [use12Hour]);
  const display12 = to12HourParts(parsed.hour);
  const formattedTime = normalizedTime
    ? formatScheduleTimeLabel(normalizedTime, { hour12: use12Hour })
    : '';
  const isEditing = draftValue !== null;

  const updateTime = (hour24: number, minute: number) => {
    onTimeChange(buildScheduleTimeStr(hour24, minute));
    setDraftValue(null);
  };

  const commitDraft = () => {
    if (draftValue === null) {
      return;
    }

    const trimmed = draftValue.trim();
    if (trimmed === '') {
      setDraftValue(null);
      return;
    }

    const fallbackPeriod = to12HourParts(parsed.hour).period;
    const parsedInput = parseScheduleTimeInput(trimmed, {
      hour12: use12Hour,
      fallbackPeriod,
    });

    if (parsedInput) {
      onTimeChange(buildScheduleTimeStr(parsedInput.hour, parsedInput.minute));
    }

    setDraftValue(null);
  };

  return (
    <div className="w-full min-w-0">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div
            className={cn(
              'relative mt-1 h-10 w-full min-w-0 overflow-hidden rounded-md border border-input bg-background ring-offset-background hover:bg-accent hover:text-accent-foreground focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
              className,
              invalid && 'border-red-600 focus-within:ring-red-600 dark:border-red-500',
              disabled && 'pointer-events-none opacity-50'
            )}
          >
            <ClockIcon
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 opacity-70"
              aria-hidden="true"
            />
            <Input
              id={id}
              type="text"
              disabled={disabled}
              data-time={normalizedTime}
              aria-label={label}
              aria-expanded={open}
              placeholder="Select time"
              value={isEditing ? draftValue : formattedTime}
              className={cn(
                'h-full w-full min-w-0 border-0 bg-transparent px-10 py-0 text-center text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
                !formattedTime && !isEditing && 'text-muted-foreground'
              )}
              onFocus={(event) => {
                setOpen(true);
                setDraftValue(formattedTime);
                event.target.select();
              }}
              onClick={() => {
                setOpen(true);
              }}
              onChange={(event) => {
                setDraftValue(event.target.value);
              }}
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitDraft();
                  event.currentTarget.blur();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setDraftValue(null);
                  setOpen(false);
                  event.currentTarget.blur();
                }
              }}
            />
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Open ${label.toLowerCase()} picker`}
                className="absolute right-0 top-0 flex h-full shrink-0 items-center pr-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed"
              >
                <ChevronDownIcon className="size-4 opacity-50" aria-hidden="true" />
              </button>
            </PopoverTrigger>
          </div>
        </PopoverAnchor>
        <PopoverContent
          className={cn(
            'p-2 sm:p-3',
            'w-[var(--radix-popover-trigger-width)] max-sm:max-w-[calc(100dvw-2rem)]',
            use12Hour ? 'sm:w-auto sm:min-w-[16rem]' : 'sm:w-auto sm:min-w-[10rem]'
          )}
          align="start"
          side="bottom"
          sideOffset={4}
          collisionPadding={16}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
          }}
          onPointerDown={(event) => {
            event.preventDefault();
          }}
        >
          <div
            className={cn(
              'grid w-full gap-1 sm:gap-2',
              use12Hour ? 'max-sm:grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'
            )}
          >
            <TimePickerColumn
              label="Hour"
              options={hourOptions}
              selected={use12Hour ? display12.hour12 : parsed.hour}
              formatOption={(value) => String(value).padStart(use12Hour ? 1 : 2, '0')}
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
              formatOption={(value) => String(value).padStart(2, '0')}
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
