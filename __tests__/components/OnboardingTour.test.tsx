import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const markCompletedMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

/**
 * Shared mutable navigation state. router.push() updates it synchronously and
 * triggers React state setters so usePathname() re-renders the component with
 * the new path — exactly like real Next.js navigation.
 */
const mockNav = vi.hoisted(() => ({
  pathname: '/dashboard',
  searchParams: new URLSearchParams(),
  pathnameSetters: new Set<React.Dispatch<React.SetStateAction<string>>>(),
  navigate(url: string) {
    const parsed = new URL(url, 'http://localhost');
    this.pathname = parsed.pathname;
    this.searchParams = parsed.searchParams;
    this.pathnameSetters.forEach((fn) => fn(parsed.pathname));
  },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => {
    const [path, setPath] = React.useState(mockNav.pathname);
    React.useEffect(() => {
      mockNav.pathnameSetters.add(setPath);
      return () => {
        mockNav.pathnameSetters.delete(setPath);
      };
    }, []);
    return path;
  },
  useRouter: () => ({
    push: vi.fn((url: string) => mockNav.navigate(url)),
    replace: vi.fn((url: string) => mockNav.navigate(url)),
  }),
  useSearchParams: () => mockNav.searchParams,
}));

vi.mock('@/components/onboarding/useOnboardingState', () => ({
  useOnboardingState: () => ({
    isReady: true,
    shouldAutoRun: true,
    markCompleted: markCompletedMock,
  }),
}));

vi.mock('@/components/onboarding/OnboardingContext', () => ({
  useOnboardingContext: () => ({
    onboardingDraftId: null,
    setOnboardingDraftId: vi.fn(),
    cleanupOnboardingDraft: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
  },
}));

vi.mock('react-joyride', () => {
  return {
    ACTIONS: { PREV: 'prev', CLOSE: 'close' },
    EVENTS: { STEP_AFTER: 'step:after', TARGET_NOT_FOUND: 'error:target_not_found' },
    ORIGIN: { KEYBOARD: 'keyboard' },
    STATUS: { FINISHED: 'finished', SKIPPED: 'skipped' },
    Joyride: ({
      onEvent,
      run,
      stepIndex = 0,
    }: {
      onEvent?: (data: any) => void;
      run?: boolean;
      stepIndex?: number;
    }) => (
      <div>
        <p data-testid="joyride-run-state">{String(Boolean(run))}</p>
        <p data-testid="joyride-step-index">{stepIndex}</p>
        <button
          type="button"
          onClick={() =>
            onEvent?.({
              action: 'skip',
              index: stepIndex,
              origin: null,
              status: 'skipped',
              type: 'tour:status',
            })
          }
        >
          Dismiss Tour
        </button>
        <button
          type="button"
          onClick={() =>
            onEvent?.({
              action: 'next',
              index: stepIndex,
              origin: null,
              status: 'running',
              type: 'step:after',
            })
          }
        >
          Advance Step
        </button>
        <button
          type="button"
          onClick={() =>
            onEvent?.({
              action: 'next',
              index: stepIndex,
              origin: null,
              status: 'running',
              type: 'error:target_not_found',
            })
          }
        >
          Missing Target
        </button>
      </div>
    ),
  };
});

import { OnboardingTour } from '@/components/onboarding/OnboardingTour';

describe('OnboardingTour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset navigation state between tests so each starts from /dashboard.
    mockNav.pathname = '/dashboard';
    mockNav.searchParams = new URLSearchParams();
    mockNav.pathnameSetters.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts the tour and marks onboarding complete when dismissed', async () => {
    render(<OnboardingTour />);

    await waitFor(() => {
      expect(screen.getByTestId('joyride-run-state')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Tour' }));

    await waitFor(() => {
      expect(markCompletedMock).toHaveBeenCalledTimes(1);
    });
  });

  it('does not mark onboarding complete when a draft step target is missing', async () => {
    render(<OnboardingTour />);

    await waitFor(() => {
      expect(screen.getByTestId('joyride-run-state')).toHaveTextContent('true');
    });

    // Move from dashboard-overview to a draft/modal wait step first.
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Advance Step' }));
    }

    fireEvent.click(screen.getByRole('button', { name: 'Missing Target' }));

    await waitFor(() => {
      expect(markCompletedMock).toHaveBeenCalledTimes(0);
    });
  });

  it('does not skip create-draft-button when its target is missing', async () => {
    render(<OnboardingTour />);

    await waitFor(() => {
      expect(screen.getByTestId('joyride-run-state')).toHaveTextContent('true');
    });

    // Advance to create-draft-button (index 4).
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Advance Step' }));
    }

    expect(screen.getByTestId('joyride-step-index')).toHaveTextContent('4');

    fireEvent.click(screen.getByRole('button', { name: 'Missing Target' }));

    await waitFor(() => {
      expect(screen.getByTestId('joyride-step-index')).toHaveTextContent('4');
    });
  });

  it('recovers from missing target by advancing after timeout', async () => {
    render(<OnboardingTour />);

    await waitFor(() => {
      expect(screen.getByTestId('joyride-run-state')).toHaveTextContent('true');
    });

    // Advance to create-draft-button (index 4).
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Advance Step' }));
    }

    expect(screen.getByTestId('joyride-step-index')).toHaveTextContent('4');

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Missing Target' }));

    await act(async () => {
      vi.advanceTimersByTime(8000);
    });

    expect(screen.getByTestId('joyride-step-index')).toHaveTextContent('5');
  });
});
