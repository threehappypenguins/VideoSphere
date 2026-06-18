import { describe, expect, it } from 'vitest';
import {
  formatSermonAudioPublishDate,
  formatTimeZoneOffsetForInstant,
  sermonAudioPublishDateToScheduleParts,
  sermonAudioPublishDateToUtcIso,
} from '@/lib/platforms/sermon-audio-schedule';

describe('sermon-audio-schedule', () => {
  it('formats publishDate with wall-clock time and offset', () => {
    const publishDate = formatSermonAudioPublishDate('2026-07-01', '09:00', 'America/New_York');
    expect(publishDate).toMatch(/^2026-07-01T09:00:00[+-]\d{2}:\d{2}$/);
  });

  it('round-trips publishDate through schedule picker parts', () => {
    const publishDate = formatSermonAudioPublishDate('2026-07-01', '09:00', 'America/New_York');
    const utcIso = sermonAudioPublishDateToUtcIso(publishDate);
    expect(utcIso).not.toBeNull();
    const parts = sermonAudioPublishDateToScheduleParts(publishDate, 'America/New_York');
    expect(parts).toEqual({ dateStr: '2026-07-01', timeStr: '09:00' });
  });

  it('parses GMT offset labels from Intl', () => {
    const offset = formatTimeZoneOffsetForInstant('2026-07-01T13:00:00.000Z', 'America/New_York');
    expect(offset).toMatch(/^[+-]\d{2}:\d{2}$/);
  });
});
