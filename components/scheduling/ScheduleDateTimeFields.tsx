'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, ChevronDownIcon } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScheduleCalendar } from '@/components/scheduling/ScheduleCalendar';
import { ScheduleTimePicker } from '@/components/scheduling/ScheduleTimePicker';
import {
  getScheduleMaxDate,
  getScheduleMinDate,
  type SchedulePlatform,
} from '@/lib/schedule-bounds';
import { scheduleDateStrToDate, scheduleDateToDateStr } from '@/lib/schedule-date-time';
import { cn } from '@/lib/utils';

/**
 * Props for {@link ScheduleDateTimeFields}.
 * @property dateId - DOM id for the date trigger button.
 * @property timeId - DOM id for the time picker trigger button.
 * @property dateStr - Selected wall-clock date (`YYYY-MM-DD`).
 * @property timeStr - Selected wall-clock time (`HH:MM`, 24-hour storage).
 * @property onDateChange - Called when the calendar date changes or is cleared.
 * @property onTimeChange - Called when the time input changes.
 * @property platform - Platform schedule window (`youtube`, `facebook`, or `sermon_audio`).
 */
export interface ScheduleDateTimeFieldsProps {
  dateId: string;
  timeId: string;
  dateStr: string;
  timeStr: string;
  platform: SchedulePlatform;
  onDateChange: (dateStr: string) => void;
  onTimeChange: (timeStr: string) => void;
  dateLabel?: string;
  timeLabel?: string;
  dateClassName?: string;
  timeClassName?: string;
  dateInvalid?: boolean;
  timeInvalid?: boolean;
  disabled?: boolean;
}

/**
 * Unified shadcn date and time fields for platform schedulers.
 * Date uses a calendar popover; time uses a scroll-column picker with typed entry (profile 12h/24h preference).
 * @param props - Field ids, values, change handlers, and styling.
 * @returns Date and time field columns for a scheduler row.
 */
export function ScheduleDateTimeFields({
  dateId,
  timeId,
  dateStr,
  timeStr,
  platform,
  onDateChange,
  onTimeChange,
  dateLabel = 'Date',
  timeLabel = 'Time',
  dateClassName,
  timeClassName,
  dateInvalid = false,
  timeInvalid = false,
  disabled = false,
}: ScheduleDateTimeFieldsProps) {
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [calendarViewResetKey, setCalendarViewResetKey] = useState(0);
  const selectedDate = useMemo(() => scheduleDateStrToDate(dateStr), [dateStr]);
  const minDate = useMemo(() => getScheduleMinDate(), []);
  const maxDate = useMemo(() => getScheduleMaxDate(platform), [platform]);

  const handleDatePopoverOpenChange = (open: boolean) => {
    setDatePopoverOpen(open);
    if (open) {
      setCalendarViewResetKey((key) => key + 1);
    }
  };

  return (
    <>
      <div className="min-w-0">
        <label htmlFor={dateId} className="text-xs font-medium text-muted-foreground">
          {dateLabel}
        </label>
        <Popover open={datePopoverOpen} onOpenChange={handleDatePopoverOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              id={dateId}
              disabled={disabled}
              data-date={dateStr}
              className={cn(
                'mt-1 w-full rounded-md border border-input bg-background px-3 text-sm font-normal ring-offset-background hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
                dateClassName,
                'flex h-10 min-w-0 items-center justify-between text-left',
                !dateStr && 'text-muted-foreground',
                dateInvalid && 'border-red-600 focus-visible:ring-red-600 dark:border-red-500'
              )}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                <CalendarIcon className="size-4 shrink-0 opacity-70" aria-hidden="true" />
                <span className="truncate">
                  {selectedDate ? format(selectedDate, 'PPP') : 'Select date'}
                </span>
              </span>
              <ChevronDownIcon
                className="ml-2 size-4 shrink-0 self-center opacity-50"
                aria-hidden="true"
              />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-0" align="start">
            <ScheduleCalendar
              key={calendarViewResetKey}
              selected={selectedDate}
              minDate={minDate}
              maxDate={maxDate}
              onSelect={(date) => {
                onDateChange(scheduleDateToDateStr(date));
                setDatePopoverOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="min-w-0">
        <ScheduleTimePicker
          id={timeId}
          timeStr={timeStr}
          label={timeLabel}
          disabled={disabled}
          invalid={timeInvalid}
          className={timeClassName}
          onTimeChange={onTimeChange}
        />
      </div>
    </>
  );
}
