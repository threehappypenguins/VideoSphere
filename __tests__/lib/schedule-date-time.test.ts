import { describe, expect, it } from 'vitest';

import {
  buildScheduleTimeStr,
  formatScheduleTimeLabel,
  normalizeScheduleTimeStr,
  parseScheduleHourInput,
  parseScheduleMinuteInput,
  parseScheduleTimeInput,
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

  it('parses calendar date strings as local midnight', () => {
    const date = scheduleDateStrToDate('2026-06-09');
    expect(date).toEqual(new Date(2026, 5, 9));
    expect(date?.getHours()).toBe(0);
    expect(date?.getMinutes()).toBe(0);
  });

  it('rejects invalid calendar dates', () => {
    expect(scheduleDateStrToDate('2026-02-30')).toBeUndefined();
    expect(scheduleDateStrToDate('not-a-date')).toBeUndefined();
  });

  it('normalizes time values to HH:MM', () => {
    expect(normalizeScheduleTimeStr('9:05')).toBe('09:05');
    expect(normalizeScheduleTimeStr('09:05:00')).toBe('09:05');
    expect(normalizeScheduleTimeStr('invalid')).toBe('');
  });

  it('formats schedule times for labels', () => {
    const hour12Label = formatScheduleTimeLabel('16:00', { hour12: true });
    const hour24Label = formatScheduleTimeLabel('16:00', { hour12: false });

    expect(hour12Label.length).toBeGreaterThan(0);
    expect(hour24Label.length).toBeGreaterThan(0);
    expect(hour12Label).not.toBe(hour24Label);
    expect(formatScheduleTimeLabel('16:00')).toBe(hour12Label);
  });

  it('converts between 12-hour and 24-hour parts', () => {
    expect(to12HourParts(0)).toEqual({ hour12: 12, period: 'AM' });
    expect(to12HourParts(13)).toEqual({ hour12: 1, period: 'PM' });
    expect(to24HourFrom12(1, 'PM')).toBe(13);
    expect(buildScheduleTimeStr(13, 5)).toBe('13:05');
    expect(parseScheduleTimeParts('13:05')).toEqual({ hour: 13, minute: 5 });
  });

  it('parses and clamps typed hour and minute inputs', () => {
    expect(parseScheduleHourInput('9', false)).toBe(9);
    expect(parseScheduleHourInput('25', false)).toBe(23);
    expect(parseScheduleHourInput('0', false)).toBe(0);
    expect(parseScheduleHourInput('13', true)).toBe(12);
    expect(parseScheduleHourInput('0', true)).toBe(1);
    expect(parseScheduleHourInput('', false)).toBeNull();
    expect(parseScheduleHourInput('1.5', false)).toBeNull();
    expect(parseScheduleHourInput('1e2', false)).toBeNull();

    expect(parseScheduleMinuteInput('5')).toBe(5);
    expect(parseScheduleMinuteInput('99')).toBe(59);
    expect(parseScheduleMinuteInput('')).toBeNull();
    expect(parseScheduleMinuteInput('1.5')).toBeNull();
    expect(parseScheduleMinuteInput('1e2')).toBeNull();
  });

  it('parses free-form schedule time input', () => {
    expect(parseScheduleTimeInput('2:00 pm', { hour12: true })).toEqual({ hour: 14, minute: 0 });
    expect(parseScheduleTimeInput('2:00pm', { hour12: true })).toEqual({ hour: 14, minute: 0 });
    expect(parseScheduleTimeInput('2 pm', { hour12: true })).toEqual({ hour: 14, minute: 0 });
    expect(parseScheduleTimeInput('2pm', { hour12: true })).toEqual({ hour: 14, minute: 0 });
    expect(parseScheduleTimeInput('12:30 am', { hour12: true })).toEqual({ hour: 0, minute: 30 });
    expect(parseScheduleTimeInput('14:00', { hour12: false })).toEqual({ hour: 14, minute: 0 });
    expect(parseScheduleTimeInput('9:05')).toEqual({ hour: 9, minute: 5 });
    expect(parseScheduleTimeInput('2:00', { hour12: true, fallbackPeriod: 'PM' })).toEqual({
      hour: 14,
      minute: 0,
    });
    expect(parseScheduleTimeInput('invalid')).toBeNull();
    expect(parseScheduleTimeInput('13:00 pm', { hour12: true })).toBeNull();
  });
});
