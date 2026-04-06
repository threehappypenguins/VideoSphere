'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

interface SessionUser {
  $id?: string;
}

interface UseOnboardingStateOptions {
  userId?: string | null;
}

export function useOnboardingState(options?: UseOnboardingStateOptions) {
  const explicitUserId = options?.userId;
  const pathname = usePathname();
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(explicitUserId ?? null);
  const [isResolvingUser, setIsResolvingUser] = useState(explicitUserId === undefined);
  const shouldGateReadyRef = useRef(explicitUserId === undefined);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [hasLoadedState, setHasLoadedState] = useState(false);

  useEffect(() => {
    if (explicitUserId !== undefined) {
      setResolvedUserId(explicitUserId ?? null);
      setIsResolvingUser(false);
      shouldGateReadyRef.current = false;
    }
  }, [explicitUserId]);

  useEffect(() => {
    if (explicitUserId !== undefined) return;

    let isMounted = true;

    async function loadSessionUserId() {
      const shouldGateReady = shouldGateReadyRef.current;

      if (shouldGateReady) {
        setIsResolvingUser(true);
      }

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
          if (shouldGateReady) {
            setIsResolvingUser(false);
          }
          shouldGateReadyRef.current = false;
        }
      }
    }

    void loadSessionUserId();

    return () => {
      isMounted = false;
    };
  }, [explicitUserId, pathname]);

  // Load onboarding state from API.
  useEffect(() => {
    if (resolvedUserId === null) {
      setHasCompletedOnboarding(true);
      setHasLoadedState(true);
      return;
    }

    // Reset loading state when userId changes to prevent stale state during transition
    setHasLoadedState(false);

    let isMounted = true;

    async function loadOnboardingState() {
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
            setHasLoadedState(true);
          }
          return;
        }
      } catch {
        // Ignore and apply conservative fallback below.
      }

      if (isMounted) {
        // If onboarding state cannot be read, default to incomplete so users are not blocked.
        setHasCompletedOnboarding(false);
        setHasLoadedState(true);
      }
    }

    void loadOnboardingState();

    return () => {
      isMounted = false;
    };
  }, [resolvedUserId]);

  const markCompleted = useCallback(async (): Promise<boolean> => {
    if (!resolvedUserId) return false;

    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch('/api/auth/onboarding-state', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hasCompletedOnboarding: true }),
        });

        if (response.ok) {
          setHasCompletedOnboarding(true);
          return true;
        }
      } catch {
        // Retry transient network failures.
      }
    }

    return false;
  }, [resolvedUserId]);

  const reset = useCallback(async () => {
    if (!resolvedUserId) return;

    try {
      const response = await fetch('/api/auth/onboarding-state', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hasCompletedOnboarding: false }),
      });

      if (response.ok) {
        setHasCompletedOnboarding(false);
        return;
      }
    } catch {
      // Fall through to in-memory optimistic reset so replay can still proceed.
    }

    setHasCompletedOnboarding(false);
  }, [resolvedUserId]);

  const isReady = useMemo(
    () => !isResolvingUser && hasLoadedState,
    [hasLoadedState, isResolvingUser]
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
