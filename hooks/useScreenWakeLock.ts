'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Outcome of attempting to hold a screen wake lock.
 * - `idle` — not requested yet
 * - `active` — Wake Lock API sentinel held
 * - `insecure` — page is not a secure context (HTTP on a LAN IP); API unavailable
 * - `unsupported` — browser has no `navigator.wakeLock`
 * - `denied` — request rejected (battery saver, policy, etc.)
 */
export type ScreenWakeLockStatus = 'idle' | 'active' | 'insecure' | 'unsupported' | 'denied';

type WakeLockControls = {
  /** Current wake-lock outcome for UI feedback. */
  status: ScreenWakeLockStatus;
  /**
   * Call from a click/tap handler. Safe to call repeatedly.
   * On Chrome Android this is the reliable way to (re)acquire after denial.
   */
  armFromUserGesture: () => void;
};

/**
 * Keeps the device screen awake via the Screen Wake Lock API while `enabled`.
 * Requests automatically when `enabled` becomes true (Chromium allows this without a
 * button). Call `armFromUserGesture` from taps as a fallback when the UA requires it.
 * Requires a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)
 * (HTTPS, or `http://localhost`). Plain `http://192.168.x.x` will not work on Chrome Android.
 * @param enabled - When true, attempt to hold a screen wake lock.
 * @returns Status plus `armFromUserGesture` for tap-driven (re)acquire.
 */
export function useScreenWakeLock(enabled: boolean): WakeLockControls {
  const [status, setStatus] = useState<ScreenWakeLockStatus>('idle');
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const wantActiveRef = useRef(false);
  const enabledRef = useRef(enabled);
  const activateRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const releaseSentinel = useCallback(async () => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    if (!sentinel || sentinel.released) return;
    try {
      await sentinel.release();
    } catch {
      // Already released by the UA.
    }
  }, []);

  const requestLock = useCallback(async (): Promise<ScreenWakeLockStatus> => {
    if (typeof window === 'undefined') return 'idle';
    if (!wantActiveRef.current || !enabledRef.current) return 'idle';
    if (document.visibilityState !== 'visible') {
      return sentinelRef.current && !sentinelRef.current.released ? 'active' : 'idle';
    }

    if (!window.isSecureContext) {
      return 'insecure';
    }
    if (!('wakeLock' in navigator) || typeof navigator.wakeLock?.request !== 'function') {
      return 'unsupported';
    }

    if (sentinelRef.current && !sentinelRef.current.released) {
      return 'active';
    }

    try {
      const next = await navigator.wakeLock.request('screen');
      if (!wantActiveRef.current || !enabledRef.current) {
        await next.release();
        return 'idle';
      }
      sentinelRef.current = next;
      next.addEventListener('release', () => {
        if (sentinelRef.current === next) {
          sentinelRef.current = null;
          if (
            wantActiveRef.current &&
            enabledRef.current &&
            document.visibilityState === 'visible'
          ) {
            setStatus((prev) => (prev === 'active' ? 'idle' : prev));
          }
        }
      });
      return 'active';
    } catch {
      return 'denied';
    }
  }, []);

  const activate = useCallback(async () => {
    if (!wantActiveRef.current || !enabledRef.current) return;
    const nextStatus = await requestLock();
    if (wantActiveRef.current && enabledRef.current) {
      setStatus(nextStatus);
    }
  }, [requestLock]);

  useEffect(() => {
    activateRef.current = () => {
      void activate();
    };
  }, [activate]);

  const armFromUserGesture = useCallback(() => {
    wantActiveRef.current = true;
    activateRef.current();
  }, []);

  useEffect(() => {
    if (!enabled) {
      wantActiveRef.current = false;
      void releaseSentinel();
      return;
    }

    wantActiveRef.current = true;
    // Defer so status updates are not synchronous inside this effect body (eslint).
    // Screen Wake Lock does not require a user gesture in Chromium when the page is visible.
    const pending = window.setTimeout(() => {
      void activate();
    }, 0);

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (!wantActiveRef.current || !enabledRef.current) return;
      void activate();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearTimeout(pending);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      wantActiveRef.current = false;
      void releaseSentinel();
    };
  }, [enabled, releaseSentinel, activate]);

  return { status: enabled ? status : 'idle', armFromUserGesture };
}
