import { addMonths, endOfDay } from 'date-fns';
import { describe, expect, it } from 'vitest';

import {
  FACEBOOK_MAX_SCHEDULE_LEAD_DAYS,
  getScheduleMaxDate,
  getScheduleMaxDateTimeMs,
  getScheduleMinDate,
  SERMONAUDIO_MAX_SCHEDULE_LEAD_DAYS,
  validateFacebookScheduledPublishTime,
  validateSchedulePublishAtIso,
  validateSermonAudioScheduledPublishTime,
  YOUTUBE_MAX_SCHEDULE_LEAD_MONTHS,
} from '@/lib/schedule-bounds';

describe('schedule bounds', () => {
  const now = new Date('2025-06-08T15:30:00.000Z');

  it('limits YouTube dates to today through 12 months ahead', () => {
    expect(getScheduleMinDate(now).toISOString().slice(0, 10)).toBe('2025-06-08');
    expect(getScheduleMaxDate('youtube', now).toISOString().slice(0, 10)).toBe('2026-06-08');
  });

  it('limits Facebook dates to today through 75 days ahead', () => {
    expect(getScheduleMinDate(now).toISOString().slice(0, 10)).toBe('2025-06-08');
    expect(getScheduleMaxDate('facebook', now).toISOString().slice(0, 10)).toBe('2025-08-22');
  });

  it('limits SermonAudio dates to today through 60 days ahead', () => {
    const july1 = new Date('2026-07-01T12:00:00.000Z');
    expect(getScheduleMaxDate('sermon_audio', july1).toISOString().slice(0, 10)).toBe('2026-08-30');
  });

  it('ends the max schedule day at local end-of-day (DST-safe)', () => {
    for (const platform of ['youtube', 'facebook', 'sermon_audio'] as const) {
      const maxDay = getScheduleMaxDate(platform, now);
      expect(getScheduleMaxDateTimeMs(platform, now)).toBe(endOfDay(maxDay).getTime());
    }
  });

  it('accepts YouTube publish times within the 12-month window', () => {
    const iso = new Date(now.getTime() + 60 * 60_000).toISOString();
    expect(validateSchedulePublishAtIso(iso, now)).toBeUndefined();
  });

  it('rejects YouTube publish times beyond 12 months', () => {
    const tooFar = addMonths(now, YOUTUBE_MAX_SCHEDULE_LEAD_MONTHS + 1);
    expect(validateSchedulePublishAtIso(tooFar.toISOString(), now)).toMatch(/12 months/);
  });

  it('rejects Facebook timestamps beyond 75 days', () => {
    const tooFarSec =
      Math.floor(now.getTime() / 1000) + (FACEBOOK_MAX_SCHEDULE_LEAD_DAYS + 1) * 24 * 60 * 60;
    expect(validateFacebookScheduledPublishTime(tooFarSec, now.getTime())).toMatch(/75 days/);
  });

  it('accepts SermonAudio timestamps in the past and within 60 days', () => {
    const pastSec = Math.floor(now.getTime() / 1000) - 3600;
    const futureSec =
      Math.floor(now.getTime() / 1000) + SERMONAUDIO_MAX_SCHEDULE_LEAD_DAYS * 24 * 60 * 60;
    expect(validateSermonAudioScheduledPublishTime(pastSec, now.getTime())).toBeUndefined();
    expect(validateSermonAudioScheduledPublishTime(futureSec, now.getTime())).toBeUndefined();
  });

  it('rejects SermonAudio timestamps beyond 60 days', () => {
    const tooFarSec =
      Math.floor(now.getTime() / 1000) + (SERMONAUDIO_MAX_SCHEDULE_LEAD_DAYS + 1) * 24 * 60 * 60;
    expect(validateSermonAudioScheduledPublishTime(tooFarSec, now.getTime())).toMatch(/60 days/);
  });

  it('rejects timezone-less ISO schedule timestamps', () => {
    expect(validateSchedulePublishAtIso('2026-06-09T15:30:00', now)).toBe(
      'Scheduled time must be a valid date and time.'
    );
  });

  it('accepts UTC ISO timestamps with Z or numeric offset suffixes', () => {
    const isoZ = new Date(now.getTime() + 60 * 60_000).toISOString();
    const isoOffset = isoZ.replace('Z', '+00:00');

    expect(validateSchedulePublishAtIso(isoZ, now)).toBeUndefined();
    expect(validateSchedulePublishAtIso(isoOffset, now)).toBeUndefined();
    expect(validateSchedulePublishAtIso(`  ${isoZ}  `, now)).toBeUndefined();
  });
});
