'use client';

import { useEffect, useState } from 'react';

import { DEFAULT_USER_CLOCK_FORMAT, resolveUserClockFormat } from '@/lib/user-preferences';
import type { UserClockFormat, UserPreferences } from '@/types';

let cachedClockFormat: UserClockFormat | null = null;
let inflight: Promise<UserClockFormat> | null = null;
/** Bumped on invalidation so stale in-flight session fetches cannot repopulate the cache. */
let cacheVersion = 0;

/**
 * Clears the in-memory clock-format cache after profile preference updates.
 */
export function invalidateUserClockFormatCache(): void {
  cachedClockFormat = null;
  inflight = null;
  cacheVersion += 1;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('videosphere:clock-format-changed'));
  }
}

async function fetchUserClockFormat(): Promise<UserClockFormat> {
  if (cachedClockFormat) {
    return cachedClockFormat;
  }

  if (!inflight) {
    const requestVersion = cacheVersion;
    inflight = fetch('/api/auth/session', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) {
          return DEFAULT_USER_CLOCK_FORMAT;
        }

        const payload = (await response.json()) as {
          preferences?: UserPreferences;
          clockFormat?: UserClockFormat;
        };
        return resolveUserClockFormat(
          payload.preferences ??
            (payload.clockFormat === '24' || payload.clockFormat === '12'
              ? { clockFormat: payload.clockFormat }
              : undefined)
        );
      })
      .catch(() => DEFAULT_USER_CLOCK_FORMAT)
      .then((clockFormat) => {
        if (requestVersion === cacheVersion) {
          cachedClockFormat = clockFormat;
        }
        return clockFormat;
      })
      .finally(() => {
        if (requestVersion === cacheVersion) {
          inflight = null;
        }
      });
  }

  return inflight;
}

/**
 * Loads the authenticated user's schedule clock format preference.
 * @returns `'12'` or `'24'`. Defaults to `'12'` until the session request settles.
 */
export function useUserClockFormat(): UserClockFormat {
  const [clockFormat, setClockFormat] = useState<UserClockFormat>(
    () => cachedClockFormat ?? DEFAULT_USER_CLOCK_FORMAT
  );

  useEffect(() => {
    const refresh = () => {
      const requestVersion = cacheVersion;
      void fetchUserClockFormat().then((clockFormat) => {
        if (requestVersion === cacheVersion) {
          setClockFormat(clockFormat);
        }
      });
    };

    refresh();
    window.addEventListener('videosphere:clock-format-changed', refresh);
    return () => window.removeEventListener('videosphere:clock-format-changed', refresh);
  }, []);

  return clockFormat;
}

/**
 * Whether the user's saved preference uses a 12-hour schedule picker.
 * @returns True when hour columns should be `1`–`12` with AM/PM.
 */
export function usePrefers12HourClock(): boolean {
  return useUserClockFormat() === '12';
}
