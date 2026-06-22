'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { invalidateUserClockFormatCache, useUserClockFormat } from '@/hooks/useUserClockFormat';
import { resolveUserClockFormat } from '@/lib/user-preferences';
import type { User, UserClockFormat } from '@/types';

const INPUT_CLASS =
  'mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/**
 * Account preference controls for schedule time display.
 * @returns Preferences section for the profile settings page.
 */
export function ProfilePreferencesSection() {
  const savedClockFormat = useUserClockFormat();
  const [clockFormat, setClockFormat] = useState<UserClockFormat>(savedClockFormat);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setClockFormat(savedClockFormat);
  }, [savedClockFormat]);

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const response = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          preferences: { clockFormat },
        }),
      });
      const data = (await response.json().catch(() => ({}))) as User & { error?: string };

      if (!response.ok) {
        setError(data.error ?? 'Failed to save preferences.');
        return;
      }

      const nextClockFormat = resolveUserClockFormat(data.preferences);
      invalidateUserClockFormatCache();
      setClockFormat(nextClockFormat);
      toast.success('Preferences updated.');
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="mt-8 rounded-xl border border-border bg-background p-6">
      <h2 className="text-xl font-semibold text-foreground">Preferences</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        These settings apply across devices when you are signed in.
      </p>

      <form className="mt-6 space-y-4" onSubmit={handleSave}>
        <div>
          <label htmlFor="profile-clock-format" className="text-sm font-medium text-foreground">
            Time format
          </label>
          <select
            id="profile-clock-format"
            value={clockFormat}
            onChange={(event) => setClockFormat(event.target.value as UserClockFormat)}
            className={INPUT_CLASS}
          >
            <option value="12">12-hour (AM/PM)</option>
            <option value="24">24-hour</option>
          </select>
          <p className="mt-2 text-xs text-muted-foreground">
            Used by schedule time pickers in drafts and livestreams.
          </p>
        </div>

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        <button
          type="submit"
          disabled={isSaving}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save preferences'}
        </button>
      </form>
    </section>
  );
}
