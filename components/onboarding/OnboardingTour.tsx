'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ACTIONS,
  EVENTS,
  ORIGIN,
  STATUS,
  Joyride,
  type EventData,
  type TooltipRenderProps,
} from 'react-joyride';
import { onboardingSteps } from '@/components/onboarding/onboarding-steps';
import { useOnboardingState } from '@/components/onboarding/useOnboardingState';
import { useOnboardingContext } from '@/components/onboarding/OnboardingContext';

const CREATE_DRAFT_BUTTON_SELECTOR = '[data-tour="drafts-create-draft-button"]';
const WAIT_FOR_TARGET_STEP_IDS = new Set([
  'first-connect-button',
  'drafts-nav-link',
  'draft-platforms',
  'draft-title-input',
  'draft-upload-section',
  'draft-save',
]);

function TourTooltip({
  backProps,
  closeProps,
  index,
  isLastStep,
  primaryProps,
  size,
  skipProps,
  step,
  tooltipProps,
}: TooltipRenderProps) {
  return (
    <div
      {...tooltipProps}
      className="w-[min(92vw,26rem)] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
    >
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        Step {index + 1} of {size}
      </div>

      {step.title ? (
        <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
      ) : null}

      <div className="mt-2 text-sm text-muted-foreground">{step.content}</div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <button
          {...skipProps}
          className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
          type="button"
        >
          Skip
        </button>

        <div className="flex items-center gap-2">
          {index > 0 ? (
            <button
              {...backProps}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
              type="button"
            >
              Back
            </button>
          ) : null}

          <button
            {...primaryProps}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            type="button"
          >
            {isLastStep ? 'Finish' : 'Next'}
          </button>

          <button
            {...closeProps}
            aria-label="Close onboarding tour"
            className="rounded-md border border-border px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            type="button"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

export function OnboardingTour() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isReady, shouldAutoRun, markCompleted } = useOnboardingState();
  const { cleanupOnboardingDraft } = useOnboardingContext();
  const [stepIndex, setStepIndex] = useState(0);

  const shouldReplay = useMemo(() => searchParams.get('onboarding') === '1', [searchParams]);
  const isOnboarding = useMemo(() => shouldReplay || shouldAutoRun, [shouldAutoRun, shouldReplay]);
  const isConnectionsWithFlow = useMemo(
    () => pathname === '/profile/connections' && searchParams.has('onboardingFlow'),
    [pathname, searchParams]
  );
  const isDraftsWithFlow = useMemo(
    () => pathname === '/dashboard/drafts' && searchParams.has('onboardingFlow'),
    [pathname, searchParams]
  );
  const run = useMemo(
    () =>
      isReady &&
      isOnboarding &&
      (pathname === '/dashboard' || isConnectionsWithFlow || isDraftsWithFlow),
    [isReady, isOnboarding, isConnectionsWithFlow, isDraftsWithFlow, pathname]
  );

  const stopTourAsCompleted = useCallback(async () => {
    setStepIndex(0);
    await cleanupOnboardingDraft();
    markCompleted();
    router.push('/dashboard');
  }, [cleanupOnboardingDraft, markCompleted, router]);

  const handleEvent = useCallback(
    ({ action, origin, status, type }: EventData) => {
      const currentStep = onboardingSteps[stepIndex];

      if (type === EVENTS.TARGET_NOT_FOUND) {
        const missingStep = onboardingSteps[stepIndex];
        // Block async modal steps so the tour waits for them to mount.
        if (missingStep && WAIT_FOR_TARGET_STEP_IDS.has(String(missingStep.id))) {
          return;
        }
      }

      if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
        const isLastStep = stepIndex >= onboardingSteps.length - 1;

        // Complete the tour when the last step is advanced or its target is never found.
        if (isLastStep && action !== ACTIONS.PREV) {
          void stopTourAsCompleted();
          return;
        }

        // When advancing from connected-accounts-link, navigate there.
        if (
          type === EVENTS.STEP_AFTER &&
          action !== ACTIONS.PREV &&
          currentStep?.id === 'connected-accounts-link'
        ) {
          router.push('/profile/connections?onboardingFlow=true');
        }

        // When advancing from the drafts sidebar link, navigate to the drafts page.
        if (
          type === EVENTS.STEP_AFTER &&
          action !== ACTIONS.PREV &&
          currentStep?.id === 'drafts-nav-link'
        ) {
          router.push('/dashboard/drafts?onboardingFlow=true');
        }

        // When advancing from create-draft button step, auto-click it to open the modal.
        if (
          type === EVENTS.STEP_AFTER &&
          action !== ACTIONS.PREV &&
          currentStep?.id === 'create-draft-button'
        ) {
          const createDraftButton = document.querySelector<HTMLButtonElement>(
            CREATE_DRAFT_BUTTON_SELECTOR
          );
          createDraftButton?.click();
        }

        setStepIndex((currentIndex) => {
          const delta = action === ACTIONS.PREV ? -1 : 1;
          return Math.max(0, Math.min(currentIndex + delta, onboardingSteps.length - 1));
        });
      }

      if (action === ACTIONS.CLOSE && origin === ORIGIN.KEYBOARD) {
        void stopTourAsCompleted();
        return;
      }

      if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
        void stopTourAsCompleted();
      }
    },
    [router, stepIndex, stopTourAsCompleted]
  );

  // Handle URL cleanup for replay
  useEffect(() => {
    if (pathname !== '/dashboard') return;
    if (!isReady || !shouldReplay) return;

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('onboarding');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [isReady, pathname, router, searchParams, shouldReplay]);

  if (
    pathname !== '/dashboard' &&
    pathname !== '/profile/connections' &&
    pathname !== '/dashboard/drafts'
  ) {
    return null;
  }

  return (
    <Joyride
      continuous
      floatingOptions={{
        shiftOptions: { padding: 10 },
      }}
      onEvent={handleEvent}
      options={{
        buttons: ['back', 'close', 'primary', 'skip'],
        closeButtonAction: 'skip',
        dismissKeyAction: 'close',
        overlayClickAction: false,
        overlayColor: 'rgba(15, 23, 42, 0.55)',
        primaryColor: 'var(--primary)',
        backgroundColor: 'var(--popover)',
        textColor: 'var(--popover-foreground)',
        showProgress: false,
        spotlightRadius: 8,
        zIndex: 10000,
      }}
      run={run}
      scrollToFirstStep
      stepIndex={stepIndex}
      steps={onboardingSteps}
      tooltipComponent={TourTooltip}
    />
  );
}
