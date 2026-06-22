import { describe, expect, it } from 'vitest';

import { parseUserPreferencesPatch } from '@/lib/auth/user-preferences-validation';
import {
  clockFormatUses12Hour,
  normalizeStoredUserPreferences,
  resolveUserClockFormat,
} from '@/lib/user-preferences';

describe('user preferences helpers', () => {
  it('defaults missing clock format to 12-hour', () => {
    expect(resolveUserClockFormat(undefined)).toBe('12');
    expect(resolveUserClockFormat({})).toBe('12');
    expect(clockFormatUses12Hour(resolveUserClockFormat(undefined))).toBe(true);
  });

  it('normalizes stored preferences', () => {
    expect(normalizeStoredUserPreferences({ clockFormat: '24' })).toEqual({
      clockFormat: '24',
    });
    expect(normalizeStoredUserPreferences({ clockFormat: 'invalid' })).toBeUndefined();
  });

  it('validates profile preference patches', () => {
    expect(parseUserPreferencesPatch({ clockFormat: '24' })).toEqual({
      ok: true,
      preferences: { clockFormat: '24' },
    });
    expect(parseUserPreferencesPatch({ clockFormat: '25' })).toEqual({
      ok: false,
      error: 'preferences.clockFormat must be "12" or "24".',
    });
  });
});
