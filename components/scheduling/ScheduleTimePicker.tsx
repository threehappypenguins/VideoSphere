'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, ClockIcon } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  buildScheduleTimeStr,
  formatScheduleTimeLabel,
  getScheduleHourOptions,
  normalizeScheduleTimeStr,
  parseScheduleTimeParts,
  SCHEDULE_MINUTE_OPTIONS,
  to12HourParts,
  to24HourFrom12,
  uses12HourClock,
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
}

function TimePickerColumn<T extends string | number>({
  label,
  options,
  selected,
  formatOption,
  onSelect,
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
    <div className="min-w-0 flex-1">
      <p className="mb-2 text-center text-xs font-medium text-muted-foreground">{label}</p>
      <div
        ref={listRef}
        className="h-48 overflow-y-auto overscroll-y-contain rounded-md border border-border bg-background"
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
                'flex w-full items-center gap-2 px-2 py-1.5 text-sm transition-colors hover:bg-muted',
                isSelected && 'bg-primary/10 font-medium text-primary'
              )}
              onClick={() => onSelect(option)}
            >
              <span className="inline-flex w-4 shrink-0 justify-center">
                {isSelected ? <CheckIcon className="size-3.5" aria-hidden="true" /> : null}
              </span>
              <span>{formatOption(option)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Scroll-column time picker with locale-aware 12h or 24h hour labels.
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
  const use12Hour = uses12HourClock();
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
                {normalizedTime ? formatScheduleTimeLabel(normalizedTime) : 'Select time'}
              </span>
            </span>
            <ChevronDownIcon
              className="ml-2 size-4 shrink-0 self-center opacity-50"
              aria-hidden="true"
            />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <div className="flex gap-2">
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
              <TimePickerColumn
                label="AM/PM"
                options={['AM', 'PM'] as const}
                selected={display12.period}
                formatOption={(value) => value}
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
