import { describe, expect, it } from 'vitest';
import { formatTrimTimeInputValue, parseTrimTimeInput } from '@/lib/parse-trim-time-input';

describe('parseTrimTimeInput', () => {
  it('parses plain second values', () => {
    expect(parseTrimTimeInput('90')).toBe(90);
    expect(parseTrimTimeInput('90.5')).toBe(90.5);
  });

  it('parses minute:second values', () => {
    expect(parseTrimTimeInput('1:30')).toBe(90);
    expect(parseTrimTimeInput('12:05')).toBe(725);
    expect(parseTrimTimeInput('1:30.5')).toBe(90.5);
  });

  it('parses hour:minute:second values', () => {
    expect(parseTrimTimeInput('1:02:03')).toBe(3723);
    expect(parseTrimTimeInput('1:02:03.25')).toBe(3723.25);
  });

  it('rejects invalid values', () => {
    expect(parseTrimTimeInput('')).toBeNull();
    expect(parseTrimTimeInput('abc')).toBeNull();
    expect(parseTrimTimeInput('1:75')).toBeNull();
    expect(parseTrimTimeInput('1:02:75')).toBeNull();
    expect(parseTrimTimeInput('1:2:3:4')).toBeNull();
  });
});

describe('formatTrimTimeInputValue', () => {
  it('formats whole seconds using YouTube-style labels', () => {
    expect(formatTrimTimeInputValue(90)).toBe('1:30');
    expect(formatTrimTimeInputValue(3723)).toBe('1:02:03');
  });

  it('formats fractional seconds with colon timestamps', () => {
    expect(formatTrimTimeInputValue(90.5)).toBe('1:30.5');
    expect(formatTrimTimeInputValue(10 + 1 / 30)).toBe('10.033');
    expect(formatTrimTimeInputValue(5595.867)).toBe('1:33:15.867');
    expect(formatTrimTimeInputValue(3723.25)).toBe('1:02:03.25');
  });

  it('round-trips through parseTrimTimeInput', () => {
    for (const seconds of [90, 3723, 90.5, 5595.867, 10 + 1 / 30]) {
      expect(parseTrimTimeInput(formatTrimTimeInputValue(seconds))).toBeCloseTo(seconds, 3);
    }
  });
});
