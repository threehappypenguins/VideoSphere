import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  useOnboardingState,
  getOnboardingStorageKey,
} from '@/components/onboarding/useOnboardingState';

describe('useOnboardingState', () => {
  const userId = 'user_test_123';
  const storageKey = getOnboardingStorageKey(userId);

  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();

    // Mock fetch for onboarding-state API
    global.fetch = vi.fn((url: string, opts?: Record<string, unknown>) => {
      if (typeof url === 'string' && url.includes('/api/auth/onboarding-state')) {
        if (opts?.method === 'POST') {
          const body = JSON.parse(opts.body as string);
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ hasCompletedOnboarding: body.hasCompletedOnboarding }),
          } as Response);
        }
        // Default GET to return false
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ hasCompletedOnboarding: false }),
        } as Response);
      }
      return Promise.reject(new Error('Not mocked'));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads and writes the onboarding completion flag via API with localStorage fallback', async () => {
    const { result } = renderHook(() => useOnboardingState({ userId }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    expect(result.current.hasCompletedOnboarding).toBe(false);

    await act(async () => {
      await result.current.markCompleted();
    });

    expect(result.current.hasCompletedOnboarding).toBe(true);
    expect(window.localStorage.getItem(storageKey)).toBe('true');

    await act(async () => {
      await result.current.reset();
    });

    expect(result.current.hasCompletedOnboarding).toBe(false);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it('does not auto-run when completion flag already exists in API', async () => {
    // Mock fetch to return true for completed
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ hasCompletedOnboarding: true }),
      } as Response)
    );

    const { result } = renderHook(() => useOnboardingState({ userId }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    expect(result.current.hasCompletedOnboarding).toBe(true);
    expect(result.current.shouldAutoRun).toBe(false);
  });

  it('defaults to not completed when storage is unavailable and API read fails', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('Network down')));
    vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });

    const { result } = renderHook(() => useOnboardingState({ userId }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    expect(result.current.hasCompletedOnboarding).toBe(false);
    expect(result.current.shouldAutoRun).toBe(true);
  });
});
