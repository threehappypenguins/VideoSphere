import { describe, expect, it } from 'vitest';
import {
  sermonAudioPublishTimestampToScheduleParts,
  validateSermonAudioScheduledPublishTime,
} from '@/lib/platforms/sermon-audio-schedule';

describe('sermon-audio-schedule', () => {
  it('parses publishTimestamp into schedule picker parts', () => {
    const publishTimestamp = Math.floor(Date.parse('2026-07-01T13:00:00.000Z') / 1000);
    const parts = sermonAudioPublishTimestampToScheduleParts(publishTimestamp, 'America/New_York');
    expect(parts).toEqual({ dateStr: '2026-07-01', timeStr: '09:00' });
  });

  it('allows past publishTimestamp values', () => {
    const nowMs = Date.parse('2026-07-01T15:00:00.000Z');
    const pastTs = Math.floor((nowMs - 60 * 60_000) / 1000);
    expect(validateSermonAudioScheduledPublishTime(pastTs, nowMs)).toBeUndefined();
  });

  it('rejects publishTimestamp beyond 60 days', () => {
    const nowMs = Date.parse('2026-07-01T15:00:00.000Z');
    const tooFarTs = Math.floor((nowMs + 61 * 24 * 60 * 60_000) / 1000);
    expect(validateSermonAudioScheduledPublishTime(tooFarTs, nowMs)).toMatch(/60 days/);
  });
});
