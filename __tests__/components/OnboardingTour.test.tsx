import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const markCompletedMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => {
  const params = new URLSearchParams();
  return {
    usePathname: () => '/dashboard',
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => params,
  };
});

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
});
