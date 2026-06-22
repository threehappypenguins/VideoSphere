'use client';

import { useCallback, useMemo, useState } from 'react';
import { format, setMonth as setCalendarMonth, setYear, startOfDay } from 'date-fns';
import { ChevronLeftIcon } from 'lucide-react';
import type { MonthCaptionProps } from 'react-day-picker';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';

type CalendarView = 'day' | 'month' | 'year';

const MONTH_INDEXES = Array.from({ length: 12 }, (_, index) => index);

/**
 * Props for {@link ScheduleCalendar}.
 * @property selected - Currently selected day.
 * @property onSelect - Called when the user picks a day.
 * @property minDate - Earliest selectable day (inclusive).
 * @property maxDate - Latest selectable day (inclusive).
 */
export interface ScheduleCalendarProps {
  selected?: Date;
  onSelect: (date: Date) => void;
  minDate: Date;
  maxDate: Date;
}

function isMonthOutsideRange(
  year: number,
  monthIndex: number,
  minDate: Date,
  maxDate: Date
): boolean {
  const monthStart = startOfDay(new Date(year, monthIndex, 1));
  const monthEnd = startOfDay(new Date(year, monthIndex + 1, 0));
  return monthEnd < minDate || monthStart > maxDate;
}

/**
 * Drill-down calendar for schedulers: day grid with clickable month/year captions.
 * @param props - Selection, bounds, and change handler.
 * @returns Calendar panel with day, month, and year views.
 */
export function ScheduleCalendar({ selected, onSelect, minDate, maxDate }: ScheduleCalendarProps) {
  const [view, setView] = useState<CalendarView>('day');
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => selected ?? startOfDay(new Date()));
  const displayMonth = visibleMonth ?? selected ?? startOfDay(new Date());

  const minYear = minDate.getFullYear();
  const maxYear = maxDate.getFullYear();
  const years = useMemo(
    () => Array.from({ length: maxYear - minYear + 1 }, (_, index) => minYear + index),
    [maxYear, minYear]
  );

  const DrillDownMonthCaption = useCallback(
    ({ calendarMonth, displayIndex: _displayIndex, className, ...props }: MonthCaptionProps) => {
      const date = calendarMonth.date;
      return (
        <div
          className={cn(
            'pointer-events-none relative flex items-center justify-center gap-1',
            className
          )}
          {...props}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="pointer-events-auto h-8 px-2 font-semibold"
            onClick={(event) => {
              event.stopPropagation();
              setView('month');
            }}
          >
            {format(date, 'MMMM')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="pointer-events-auto h-8 px-2 font-semibold"
            onClick={(event) => {
              event.stopPropagation();
              setView('year');
            }}
          >
            {format(date, 'yyyy')}
          </Button>
        </div>
      );
    },
    []
  );

  if (view === 'year') {
    return (
      <div className="w-[280px] p-3">
        <div className="mb-3 flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Back to month selection"
            onClick={() => setView('month')}
          >
            <ChevronLeftIcon className="size-4" aria-hidden="true" />
          </Button>
          <p className="text-sm font-medium text-foreground">Select year</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {years.map((year) => {
            const isActive = displayMonth.getFullYear() === year;
            return (
              <Button
                key={year}
                type="button"
                variant={isActive ? 'default' : 'outline'}
                size="sm"
                className="h-9"
                onClick={() => {
                  setVisibleMonth(setYear(displayMonth, year));
                  setView('month');
                }}
              >
                {year}
              </Button>
            );
          })}
        </div>
      </div>
    );
  }

  if (view === 'month') {
    const year = displayMonth.getFullYear();
    return (
      <div className="w-[280px] p-3">
        <div className="mb-3 flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Back to calendar"
            onClick={() => setView('day')}
          >
            <ChevronLeftIcon className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="font-semibold"
            onClick={() => setView('year')}
          >
            {year}
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {MONTH_INDEXES.map((monthIndex) => {
            const disabled = isMonthOutsideRange(year, monthIndex, minDate, maxDate);
            const isActive =
              displayMonth.getMonth() === monthIndex && displayMonth.getFullYear() === year;
            const label = format(new Date(2020, monthIndex, 1), 'MMM');
            return (
              <Button
                key={monthIndex}
                type="button"
                variant={isActive ? 'default' : 'outline'}
                size="sm"
                className="h-9"
                disabled={disabled}
                onClick={() => {
                  setVisibleMonth(setCalendarMonth(setYear(displayMonth, year), monthIndex));
                  setView('day');
                }}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <Calendar
      mode="single"
      className="w-full [--cell-size:2.5rem]"
      month={displayMonth}
      onMonthChange={setVisibleMonth}
      selected={selected}
      captionLayout="label"
      startMonth={minDate}
      endMonth={maxDate}
      disabled={{ before: minDate, after: maxDate }}
      onSelect={(date) => {
        if (date) {
          onSelect(date);
        }
      }}
      components={{
        MonthCaption: DrillDownMonthCaption,
      }}
    />
  );
}
