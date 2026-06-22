import { describe, expect, it } from 'vitest';

import {
  buildScheduleTimeStr,
  formatScheduleTimeLabel,
  normalizeScheduleTimeStr,
  parseScheduleTimeParts,
  scheduleDateStrToDate,
  scheduleDateToDateStr,
  to12HourParts,
  to24HourFrom12,
} from '@/lib/schedule-date-time';

describe('schedule-date-time helpers', () => {
  it('round-trips calendar date strings', () => {
    const date = scheduleDateStrToDate('2026-06-09');
    expect(date).toBeInstanceOf(Date);
    expect(scheduleDateToDateStr(date!)).toBe('2026-06-09');
  });

  it('normalizes time values to HH:MM', () => {
    expect(normalizeScheduleTimeStr('9:05')).toBe('09:05');
    expect(normalizeScheduleTimeStr('09:05:00')).toBe('09:05');
    expect(normalizeScheduleTimeStr('invalid')).toBe('');
  });

  it('formats schedule times for labels', () => {
    expect(formatScheduleTimeLabel('16:00')).toMatch(/4:00|16:00/);
  });

  it('converts between 12-hour and 24-hour parts', () => {
    expect(to12HourParts(0)).toEqual({ hour12: 12, period: 'AM' });
    expect(to12HourParts(13)).toEqual({ hour12: 1, period: 'PM' });
    expect(to24HourFrom12(1, 'PM')).toBe(13);
    expect(buildScheduleTimeStr(13, 5)).toBe('13:05');
    expect(parseScheduleTimeParts('13:05')).toEqual({ hour: 13, minute: 5 });
  });
});
