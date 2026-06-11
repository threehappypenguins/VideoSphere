import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getLocalTimeZone,
  getSupportedTimeZones,
  utcIsoToZonedScheduleParts,
  zonedDateTimeToUtcIso,
} from '@/lib/youtube-schedule';

describe('zonedDateTimeToUtcIso', () => {
  it('converts a valid wall-clock selection to UTC and round-trips in the same timezone', () => {
    const iso = zonedDateTimeToUtcIso('2026-06-10', '23:30', 'America/Halifax');
    expect(iso).toBe('2026-06-11T02:30:00.000Z');

    const parts = utcIsoToZonedScheduleParts(iso, 'America/Halifax');
    expect(parts).toEqual({ dateStr: '2026-06-10', timeStr: '23:30' });
  });

  it('throws when the wall-clock time does not exist in the timezone (DST gap)', () => {
    expect(() => zonedDateTimeToUtcIso('2026-03-08', '02:30', 'America/New_York')).toThrow(
      /invalid youtube schedule date or time for the selected timezone/i
    );
  });

  it('throws for malformed date or time input', () => {
    expect(() => zonedDateTimeToUtcIso('', '23:30', 'UTC')).toThrow(
      /invalid youtube schedule date or time/i
    );
  });
});

describe('getLocalTimeZone', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns UTC when resolvedOptions throws', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () =>
        ({
          resolvedOptions: () => {
            throw new Error('unsupported');
          },
        }) as unknown as Intl.DateTimeFormat
    );

    expect(getLocalTimeZone()).toBe('UTC');
  });
});

describe('getSupportedTimeZones', () => {
  const originalSupportedValuesOf = (
    Intl as typeof Intl & { supportedValuesOf?: (key: string) => Iterable<string> }
  ).supportedValuesOf;

  afterEach(() => {
    if (originalSupportedValuesOf === undefined) {
      delete (Intl as typeof Intl & { supportedValuesOf?: (key: string) => Iterable<string> })
        .supportedValuesOf;
    } else {
      (
        Intl as typeof Intl & { supportedValuesOf?: (key: string) => Iterable<string> }
      ).supportedValuesOf = originalSupportedValuesOf;
    }
    vi.restoreAllMocks();
  });

  it('returns sorted timezones from Intl.supportedValuesOf when available', () => {
    (
      Intl as typeof Intl & { supportedValuesOf?: (key: string) => Iterable<string> }
    ).supportedValuesOf = (key: string) => {
      if (key === 'timeZone') return ['America/New_York', 'UTC', 'America/Halifax'];
      throw new Error(`Unsupported key: ${key}`);
    };

    expect(getSupportedTimeZones()).toEqual(['America/Halifax', 'America/New_York', 'UTC']);
  });

  it('falls back to local timezone and UTC when supportedValuesOf is missing', () => {
    delete (Intl as typeof Intl & { supportedValuesOf?: (key: string) => Iterable<string> })
      .supportedValuesOf;

    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () =>
        ({
          resolvedOptions: () => ({ timeZone: 'America/Halifax' }),
        }) as unknown as Intl.DateTimeFormat
    );

    expect(getSupportedTimeZones()).toEqual(['America/Halifax', 'UTC']);
  });

  it('falls back when supportedValuesOf throws', () => {
    (
      Intl as typeof Intl & { supportedValuesOf?: (key: string) => Iterable<string> }
    ).supportedValuesOf = () => {
      throw new Error('unsupported');
    };

    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () =>
        ({
          resolvedOptions: () => ({ timeZone: 'America/Halifax' }),
        }) as unknown as Intl.DateTimeFormat
    );

    expect(getSupportedTimeZones()).toEqual(['America/Halifax', 'UTC']);
  });
});
