import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useOnboardingState } from '@/components/onboarding/useOnboardingState';

describe('useOnboardingState', () => {
  const userId = 'user_test_123';

  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock fetch for onboarding-state API
    global.fetch = vi.fn((url: string, opts?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/auth/onboarding-state')) {
        if (opts && opts.method === 'POST') {
          const body = JSON.parse((opts.body as string) ?? '{}');
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

  it('reads and writes the onboarding completion flag via API', async () => {
    const { result } = renderHook(() => useOnboardingState({ userId }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    expect(result.current.hasCompletedOnboarding).toBe(false);

    await act(async () => {
      await result.current.markCompleted();
    });

    expect(result.current.hasCompletedOnboarding).toBe(true);

    await act(async () => {
      await result.current.reset();
    });

    expect(result.current.hasCompletedOnboarding).toBe(false);
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

  it('does not mark onboarding complete when the API update fails', async () => {
    global.fetch = vi.fn((url: string, opts?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/auth/onboarding-state')) {
        if (opts && opts.method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ error: 'Internal server error' }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ hasCompletedOnboarding: false }),
        } as Response);
      }

      return Promise.reject(new Error('Not mocked'));
    });

    const { result } = renderHook(() => useOnboardingState({ userId }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    let completed = true;
    await act(async () => {
      completed = await result.current.markCompleted();
    });

    expect(completed).toBe(false);
    expect(result.current.hasCompletedOnboarding).toBe(false);
  });

  it('defaults to completed when API read fails', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('Network down')));

    const { result } = renderHook(() => useOnboardingState({ userId }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    expect(result.current.hasCompletedOnboarding).toBe(true);
    expect(result.current.shouldAutoRun).toBe(false);
  });
});
