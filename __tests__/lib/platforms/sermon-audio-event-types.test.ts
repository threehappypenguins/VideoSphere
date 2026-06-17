import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatSermonAudioLocalDate,
  mergeSermonAudioDefaultFields,
  mergeSermonAudioEventTypes,
  SERMON_AUDIO_EVENT_TYPES,
} from '@/lib/platforms/sermon-audio-event-types';

describe('mergeSermonAudioEventTypes', () => {
  it('includes the full documented catalog when API returns a broadcaster subset', () => {
    const merged = mergeSermonAudioEventTypes([
      'Conference',
      'Funeral Service',
      'Special Meeting',
      'Sunday - AM',
      'Sunday - PM',
      'Sunday Service',
    ]);

    expect(merged).toHaveLength(SERMON_AUDIO_EVENT_TYPES.length);
    expect(merged).toContain('Bible Study');
    expect(merged).toContain('Youth');
    expect(merged).toContain('Sunday Service');
  });

  it('preserves extra API-only labels not yet in the static catalog', () => {
    const merged = mergeSermonAudioEventTypes(['Custom Event']);
    expect(merged).toContain('Custom Event');
    expect(merged.length).toBe(SERMON_AUDIO_EVENT_TYPES.length + 1);
  });
});

describe('mergeSermonAudioDefaultFields', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('defaults preachDate, eventType, and languageCode when unset', () => {
    const patch = mergeSermonAudioDefaultFields({});
    expect(patch.preachDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(patch.eventType).toBe('Sunday Service');
    expect(patch.languageCode).toBe('en');
  });

  it('defaults preachDate using the local calendar date, not UTC', () => {
    vi.useFakeTimers();
    vi.stubEnv('TZ', 'America/Chicago');
    vi.setSystemTime(new Date('2026-06-02T03:00:00.000Z'));

    expect(formatSermonAudioLocalDate()).toBe('2026-06-01');
    expect(mergeSermonAudioDefaultFields({}).preachDate).toBe('2026-06-01');
  });

  it('does not override existing values', () => {
    expect(
      mergeSermonAudioDefaultFields({
        preachDate: '2026-01-01',
        eventType: 'Bible Study',
        languageCode: 'es',
      })
    ).toEqual({});
  });
});
