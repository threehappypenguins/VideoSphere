'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';

const ONBOARDING_STORAGE_PREFIX = 'videosphere:onboarding:';

interface SessionUser {
  $id?: string;
}

interface UseOnboardingStateOptions {
  userId?: string | null;
}

export function getOnboardingStorageKey(userId: string): string {
  return `${ONBOARDING_STORAGE_PREFIX}${userId}`;
}

function readHasCompletedOnboarding(userId: string): boolean {
  try {
    return window.localStorage.getItem(getOnboardingStorageKey(userId)) === 'true';
  } catch {
    // If storage is unavailable (e.g. private mode), treat as not completed
    // so onboarding can still run for the current session.
    return false;
  }
}

function writeHasCompletedOnboarding(userId: string, value: boolean): void {
  const key = getOnboardingStorageKey(userId);

  try {
    if (value) {
      window.localStorage.setItem(key, 'true');
      return;
    }

    window.localStorage.removeItem(key);
  } catch {
    // Non-fatal: onboarding becomes a session-only experience if storage is unavailable.
  }
}

export function useOnboardingState(options?: UseOnboardingStateOptions) {
  const explicitUserId = options?.userId;
  const pathname = usePathname();
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(explicitUserId ?? null);
  const [isResolvingUser, setIsResolvingUser] = useState(explicitUserId === undefined);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);

  useEffect(() => {
    if (explicitUserId !== undefined) {
      setResolvedUserId(explicitUserId ?? null);
      setIsResolvingUser(false);
    }
  }, [explicitUserId]);

  useEffect(() => {
    if (explicitUserId !== undefined) return;

    let isMounted = true;

    async function loadSessionUserId() {
      setIsResolvingUser(true);

      try {
        const response = await fetch('/api/auth/session', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });

        if (!response.ok) {
          if (isMounted) {
            setResolvedUserId(null);
          }
          return;
        }

        const payload = (await response.json().catch(() => null)) as SessionUser | null;

        if (!isMounted) return;
        setResolvedUserId(payload?.$id ?? null);
      } catch {
        if (!isMounted) return;
        setResolvedUserId(null);
      } finally {
        if (isMounted) {
          setIsResolvingUser(false);
        }
      }
    }

    void loadSessionUserId();

    return () => {
      isMounted = false;
    };
  }, [explicitUserId, pathname]);

  // Load onboarding state from API (or localStorage fallback)
  useEffect(() => {
    if (resolvedUserId === null) {
      setHasCompletedOnboarding(true);
      setHasLoadedStorage(true);
      return;
    }

    let isMounted = true;

    async function loadOnboardingState() {
      // Try API first
      try {
        const response = await fetch('/api/auth/onboarding-state', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });

        if (response.ok) {
          const data = (await response.json().catch(() => null)) as {
            hasCompletedOnboarding?: boolean;
          } | null;
          if (isMounted) {
            const completed = data?.hasCompletedOnboarding ?? false;
            setHasCompletedOnboarding(completed);
            setHasLoadedStorage(true);
          }
          return;
        }
      } catch {
        // API call failed, fall through to localStorage
      }

      // Fallback: localStorage
      if (isMounted) {
        const completed = readHasCompletedOnboarding(resolvedUserId);
        setHasCompletedOnboarding(completed);
        setHasLoadedStorage(true);
      }
    }

    void loadOnboardingState();

    return () => {
      isMounted = false;
    };
  }, [resolvedUserId]);

  const markCompleted = useCallback(async () => {
    if (!resolvedUserId) return;

    try {
      // Try API first
      const response = await fetch('/api/auth/onboarding-state', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hasCompletedOnboarding: true }),
      });

      if (response.ok) {
        setHasCompletedOnboarding(true);
        // Also update localStorage for offline support
        writeHasCompletedOnboarding(resolvedUserId, true);
        return;
      }
    } catch {
      // API call failed, fall through to localStorage only
    }

    // Fallback: localStorage only
    writeHasCompletedOnboarding(resolvedUserId, true);
    setHasCompletedOnboarding(true);
  }, [resolvedUserId]);

  const reset = useCallback(async () => {
    if (!resolvedUserId) return;

    try {
      // Try API first
      const response = await fetch('/api/auth/onboarding-state', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hasCompletedOnboarding: false }),
      });

      if (response.ok) {
        setHasCompletedOnboarding(false);
        // Also update localStorage for offline support
        writeHasCompletedOnboarding(resolvedUserId, false);
        return;
      }
    } catch {
      // API call failed, fall through to localStorage only
    }

    // Fallback: localStorage only
    writeHasCompletedOnboarding(resolvedUserId, false);
    setHasCompletedOnboarding(false);
  }, [resolvedUserId]);

  const isReady = useMemo(
    () => !isResolvingUser && hasLoadedStorage,
    [hasLoadedStorage, isResolvingUser]
  );

  return {
    userId: resolvedUserId,
    isReady,
    hasCompletedOnboarding,
    shouldAutoRun: isReady && !hasCompletedOnboarding,
    markCompleted,
    reset,
  };
}
