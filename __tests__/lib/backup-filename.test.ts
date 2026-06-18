import { describe, expect, it } from 'vitest';
import {
  buildBackupFileName,
  buildBackupRemoteRelativePath,
  formatBackupDatePrefix,
  isValidCalendarDateString,
  normalizeBackupFileNameSettings,
  resolveBackupDatePrefixCalendarDate,
  sanitizeBackupFilenameComponent,
} from '@/lib/backup-filename';

describe('backup filename helpers', () => {
  const createdAt = '2026-06-18T15:30:00.000Z';
  const calendarDate = '2026-06-18';

  it('formats supported date tokens from a calendar date', () => {
    expect(formatBackupDatePrefix(calendarDate, 'YYYYMMDD')).toBe('20260618');
    expect(formatBackupDatePrefix(calendarDate, 'YYYY-MM-DD')).toBe('2026-06-18');
    expect(formatBackupDatePrefix(calendarDate, 'YYYYDDMM')).toBe('20261806');
    expect(formatBackupDatePrefix(calendarDate, 'YYYY-DD-MM')).toBe('2026-18-06');
  });

  it('validates calendar date strings', () => {
    expect(isValidCalendarDateString('2026-06-18')).toBe(true);
    expect(isValidCalendarDateString('2024-02-29')).toBe(true);
    expect(isValidCalendarDateString('2026-02-30')).toBe(false);
    expect(isValidCalendarDateString('20260618')).toBe(false);
  });

  it('removes invalid filename characters from segments', () => {
    expect(sanitizeBackupFilenameComponent('Title? with/bad:chars')).toBe('Title with bad chars');
  });

  it('builds default filename with date prefix and title', () => {
    expect(
      buildBackupFileName({
        title: 'Title of Video',
        contentType: 'video/mp4',
        createdAt,
        settings: normalizeBackupFileNameSettings({
          datePrefixDate: calendarDate,
        }),
      })
    ).toBe('20260618 - Title of Video.mp4');
  });

  it('prefers an explicit date prefix date over draft creation time', () => {
    expect(
      buildBackupFileName({
        title: 'Title of Video',
        contentType: 'video/mp4',
        createdAt,
        settings: normalizeBackupFileNameSettings({
          datePrefixDate: '2025-01-02',
        }),
      })
    ).toBe('20250102 - Title of Video.mp4');
  });

  it('defaults new backup naming settings to today', () => {
    const normalized = normalizeBackupFileNameSettings(undefined);
    expect(normalized.datePrefixDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(isValidCalendarDateString(normalized.datePrefixDate ?? '')).toBe(true);
  });

  it('defaults missing date prefix date to today', () => {
    expect(
      resolveBackupDatePrefixCalendarDate(
        normalizeBackupFileNameSettings({
          datePrefixEnabled: true,
        })
      )
    ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('builds remote preview paths with a year folder by default', () => {
    expect(
      buildBackupRemoteRelativePath({
        fileName: buildBackupFileName({
          title: 'Title of Video',
          settings: normalizeBackupFileNameSettings({
            datePrefixEnabled: true,
            dateFormat: 'YYYYMMDD',
            datePrefixDate: '2026-06-18',
            seriesEnabled: true,
            series: 'Series',
          }),
          includeExtension: false,
        }),
        settings: normalizeBackupFileNameSettings({
          datePrefixDate: '2026-06-18',
        }),
      })
    ).toBe('2026/20260618 - Series - Title of Video');
  });

  it('omits the year folder from preview paths when disabled', () => {
    expect(
      buildBackupRemoteRelativePath({
        fileName: buildBackupFileName({
          title: 'Title of Video',
          settings: normalizeBackupFileNameSettings({
            yearFolderEnabled: false,
            datePrefixEnabled: false,
          }),
          includeExtension: false,
        }),
        settings: normalizeBackupFileNameSettings({
          yearFolderEnabled: false,
        }),
      })
    ).toBe('Title of Video');
  });

  it('appends an optional AM/PM suffix directly to the formatted date prefix', () => {
    expect(
      buildBackupRemoteRelativePath({
        fileName: buildBackupFileName({
          title: 'This is the title',
          settings: normalizeBackupFileNameSettings({
            datePrefixEnabled: true,
            dateFormat: 'YYYYMMDD',
            datePrefixDate: '2026-06-18',
            dateSuffixEnabled: true,
            dateSuffix: 'AM',
            seriesEnabled: true,
            series: 'SERIES',
            suffixEnabled: true,
            suffix: 'This is the suffix',
          }),
          includeExtension: false,
        }),
        settings: normalizeBackupFileNameSettings({
          datePrefixDate: '2026-06-18',
        }),
      })
    ).toBe('2026/20260618AM - SERIES - This is the title (This is the suffix)');
  });

  it('appends a hyphenated date suffix when selected', () => {
    expect(
      buildBackupFileName({
        title: 'Title of Video',
        contentType: 'video/mp4',
        settings: normalizeBackupFileNameSettings({
          datePrefixEnabled: true,
          dateFormat: 'YYYYMMDD',
          datePrefixDate: '2026-06-18',
          dateSuffixEnabled: true,
          dateSuffix: '-PM',
        }),
        includeExtension: false,
      })
    ).toBe('20260618-PM - Title of Video');
  });

  it('includes optional series between date and title', () => {
    expect(
      buildBackupFileName({
        title: 'Title of Video',
        contentType: 'video/mp4',
        createdAt,
        settings: normalizeBackupFileNameSettings({
          datePrefixEnabled: true,
          dateFormat: 'YYYYMMDD',
          datePrefixDate: calendarDate,
          seriesEnabled: true,
          series: 'Series',
        }),
      })
    ).toBe('20260618 - Series - Title of Video.mp4');
  });

  it('preserves spaces in the series segment when building filenames', () => {
    expect(
      buildBackupFileName({
        title: 'Title of Video',
        contentType: 'video/mp4',
        createdAt,
        settings: normalizeBackupFileNameSettings({
          datePrefixEnabled: true,
          dateFormat: 'YYYYMMDD',
          datePrefixDate: calendarDate,
          seriesEnabled: true,
          series: 'My Series Name',
        }),
      })
    ).toBe('20260618 - My Series Name - Title of Video.mp4');
  });

  it('does not trim series while normalizing so spaces can be typed in the editor', () => {
    expect(
      normalizeBackupFileNameSettings({
        seriesEnabled: true,
        series: 'My ',
      }).series
    ).toBe('My ');
  });

  it('appends an optional suffix in parentheses after the title', () => {
    expect(
      buildBackupFileName({
        title: 'This is the title',
        contentType: 'video/mp4',
        settings: normalizeBackupFileNameSettings({
          datePrefixEnabled: true,
          dateFormat: 'YYYYMMDD',
          datePrefixDate: calendarDate,
          seriesEnabled: true,
          series: 'SERIES',
          suffixEnabled: true,
          suffix: 'This is the suffix',
        }),
        includeExtension: false,
      })
    ).toBe('20260618 - SERIES - This is the title (This is the suffix)');
  });

  it('preserves spaces in the suffix while normalizing so they can be typed in the editor', () => {
    expect(
      normalizeBackupFileNameSettings({
        suffixEnabled: true,
        suffix: 'Part ',
      }).suffix
    ).toBe('Part ');
  });

  it('omits empty suffix parentheses when suffix text is blank', () => {
    expect(
      buildBackupFileName({
        title: 'Title of Video',
        contentType: 'video/mp4',
        settings: normalizeBackupFileNameSettings({
          datePrefixEnabled: false,
          suffixEnabled: true,
          suffix: '   ',
        }),
      })
    ).toBe('Title of Video.mp4');
  });

  it('omits date and series when disabled', () => {
    expect(
      buildBackupFileName({
        title: 'Title of Video',
        contentType: 'video/quicktime',
        createdAt,
        settings: normalizeBackupFileNameSettings({
          datePrefixEnabled: false,
          seriesEnabled: false,
        }),
      })
    ).toBe('Title of Video.mov');
  });
});
