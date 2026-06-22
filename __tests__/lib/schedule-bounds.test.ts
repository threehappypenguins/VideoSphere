import { addMonths } from 'date-fns';
import { describe, expect, it } from 'vitest';

import {
  FACEBOOK_MAX_SCHEDULE_LEAD_DAYS,
  getScheduleMaxDate,
  getScheduleMinDate,
  validateFacebookScheduledPublishTime,
  validateSchedulePublishAtIso,
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
});
