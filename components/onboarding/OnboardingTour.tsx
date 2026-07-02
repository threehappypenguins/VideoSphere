'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ACTIONS,
  EVENTS,
  ORIGIN,
  STATUS,
  Joyride,
  type EventData,
  type Step,
  type TooltipRenderProps,
} from 'react-joyride';
import { toast } from 'sonner';
import { onboardingSteps } from '@/components/onboarding/onboarding-steps';
import { useOnboardingState } from '@/components/onboarding/useOnboardingState';
import { useOnboardingContext } from '@/components/onboarding/OnboardingContext';

const CREATE_DRAFT_BUTTON_SELECTOR = '[data-tour="drafts-create-draft-button"]';

/**
 * React Joyride supports function targets at runtime but the TypeScript types
 * only declare `string | HTMLElement`. We widen locally and cast at the
 * Joyride call-site. No production steps export this type.
 */
type StepWithFnTarget = Omit<Step, 'target'> & {
  target: Step['target'] | (() => HTMLElement | null);
};
const WAIT_FOR_TARGET_STEP_IDS = new Set([
  'uploads-nav-link',
  'create-draft-button',
  'first-connect-button',
  'draft-platforms',
  'draft-title-input',
  'draft-upload-section',
  'draft-save',
]);
const DEFAULT_TARGET_NOT_FOUND_MAX_RETRIES = 10;
const TARGET_NOT_FOUND_FALLBACK_TIMEOUT_MS = 8000;
const TARGET_NOT_FOUND_MAX_RETRIES_BY_STEP_ID: Partial<Record<string, number>> = {
  // Connections page takes longer to load and render on mobile; give it more time
  'first-connect-button': 20,
};

function isStepTargetMissing(step: StepWithFnTarget | undefined): boolean {
  if (!step) return true;

  const target = step.target;
  let element: HTMLElement | null = null;

  if (typeof target === 'string') {
    element = document.querySelector<HTMLElement>(target);
  } else if (typeof target === 'function') {
    element = target();
  } else {
    const maybeRef = target as { current?: HTMLElement | null };
    element = 'current' in maybeRef ? (maybeRef.current ?? null) : (target as HTMLElement);
  }

  // Joyride cannot place a tooltip if the target has no client rects.
  return !element || element.getClientRects().length === 0;
}

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

/**
 * Renders the onboarding tour component.
 * @returns The rendered UI output.
 */
export function OnboardingTour() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isReady, shouldAutoRun, markCompleted } = useOnboardingState();
  const { cleanupOnboardingDraft } = useOnboardingContext();
  const [stepIndex, setStepIndex] = useState(0);
  const [hasReplayStarted, setHasReplayStarted] = useState(false);
  const targetNotFoundRetryCountsRef = useRef<Record<string, number>>({});
  const targetNotFoundTimeoutsRef = useRef<Record<string, number>>({});
  const hasCompletionStartedRef = useRef(false);
  const pendingNavigationStepAdvanceRef = useRef<number | null>(null);
  const lastPathnameRef = useRef(pathname);

  const shouldReplay = useMemo(() => searchParams.get('onboarding') === '1', [searchParams]);
  const hasOnboardingFlow = useMemo(
    () => searchParams.get('onboardingFlow') === 'true',
    [searchParams]
  );
  const isOnboarding = useMemo(
    () => shouldReplay || shouldAutoRun || hasReplayStarted,
    [hasReplayStarted, shouldAutoRun, shouldReplay]
  );
  const isConnectionsWithFlow = useMemo(
    () => pathname === '/profile/connections' && hasOnboardingFlow,
    [hasOnboardingFlow, pathname]
  );
  const isUploadsWithFlow = useMemo(
    () => pathname === '/dashboard/uploads' && hasOnboardingFlow,
    [hasOnboardingFlow, pathname]
  );
  const run = useMemo(
    () =>
      isReady &&
      isOnboarding &&
      (pathname === '/dashboard' || isConnectionsWithFlow || isUploadsWithFlow),
    [isReady, isOnboarding, isConnectionsWithFlow, isUploadsWithFlow, pathname]
  );

  // Override the uploads-nav-link step with a function target that picks the
  // visible element. A CSS comma-selector uses DOM order, which always returns
  // the desktop sidebar link first — even on mobile where it lives inside a
  // `display:none` aside (zero bounding rect → Joyride raises the overlay but
  // can never place the tooltip, hanging the tour indefinitely).
  // Note: tourSteps has an empty dependency array. onboardingSteps is a stable
  // module constant and will never change, so it's not a dependency; the memoization
  // is for performance (avoiding .map() on every render), not dependency safety.
  const tourSteps = useMemo<StepWithFnTarget[]>(
    () =>
      onboardingSteps.map((step) => {
        if (step.id !== 'uploads-nav-link') return step;
        return {
          ...step,
          target: (): HTMLElement | null => {
            const mobileUploads = document.querySelector<HTMLElement>(
              '[data-tour="uploads-nav-link-mobile"]'
            );
            const mobileSectionsTrigger = document.querySelector<HTMLElement>(
              '[data-tour="dashboard-sections-trigger-mobile"]'
            );
            const desktop = document.querySelector<HTMLElement>(
              '[data-tour="uploads-nav-link-desktop"]'
            );
            if (mobileUploads && mobileUploads.offsetParent !== null) return mobileUploads;
            if (mobileSectionsTrigger && mobileSectionsTrigger.offsetParent !== null) {
              return mobileSectionsTrigger;
            }
            if (desktop && desktop.offsetParent !== null) return desktop;
            return mobileUploads ?? mobileSectionsTrigger ?? desktop ?? null;
          },
        };
      }),
    []
  );

  const stopTourAsCompleted = useCallback(async () => {
    if (hasCompletionStartedRef.current) {
      return;
    }

    hasCompletionStartedRef.current = true;
    const wasPersisted = await markCompleted();
    if (!wasPersisted) {
      hasCompletionStartedRef.current = false;
      toast.error('Could not save onboarding progress. Please click Finish again.');
      return;
    }

    targetNotFoundRetryCountsRef.current = {};
    Object.values(targetNotFoundTimeoutsRef.current).forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    targetNotFoundTimeoutsRef.current = {};
    pendingNavigationStepAdvanceRef.current = null;
    setStepIndex(0);
    setHasReplayStarted(false);
    await cleanupOnboardingDraft();
    router.push('/dashboard');
  }, [cleanupOnboardingDraft, markCompleted, router]);

  const clearTargetNotFoundTimer = useCallback((stepId: string) => {
    const timeoutId = targetNotFoundTimeoutsRef.current[stepId];
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      delete targetNotFoundTimeoutsRef.current[stepId];
    }
  }, []);

  useEffect(() => {
    if (!run) {
      hasCompletionStartedRef.current = false;
      targetNotFoundRetryCountsRef.current = {};
      Object.values(targetNotFoundTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      targetNotFoundTimeoutsRef.current = {};
      pendingNavigationStepAdvanceRef.current = null;
    }
  }, [run]);

  useEffect(() => {
    return () => {
      targetNotFoundRetryCountsRef.current = {};
      Object.values(targetNotFoundTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      targetNotFoundTimeoutsRef.current = {};
      pendingNavigationStepAdvanceRef.current = null;
    };
  }, []);

  // Detect pathname changes and advance pending step after navigation completes
  useEffect(() => {
    if (pathname !== lastPathnameRef.current) {
      lastPathnameRef.current = pathname;
      if (pendingNavigationStepAdvanceRef.current !== null) {
        const nextStep = pendingNavigationStepAdvanceRef.current;
        pendingNavigationStepAdvanceRef.current = null;
        setStepIndex(nextStep);
      }
    }
  }, [pathname]);

  const handleEvent = useCallback(
    ({ action, index, origin, status, step, type }: EventData) => {
      if (shouldReplay && !hasReplayStarted && (type === 'tour:start' || type === 'step:before')) {
        setHasReplayStarted(true);
      }

      const eventIndex = typeof index === 'number' ? index : stepIndex;
      const currentStep = step ?? onboardingSteps[eventIndex];
      const currentStepId = String(currentStep?.id ?? '');

      if (type === EVENTS.TARGET_NOT_FOUND) {
        const missingStepId = currentStepId;
        const isLastStep = eventIndex >= onboardingSteps.length - 1;

        // Complete tour immediately if the last step's target is never found
        if (isLastStep && action !== ACTIONS.PREV) {
          void stopTourAsCompleted();
          return;
        }

        // Block async/modal steps briefly so they can mount, but never stall forever.
        if (missingStepId && WAIT_FOR_TARGET_STEP_IDS.has(missingStepId)) {
          const maxRetries =
            TARGET_NOT_FOUND_MAX_RETRIES_BY_STEP_ID[missingStepId] ??
            DEFAULT_TARGET_NOT_FOUND_MAX_RETRIES;
          const nextCount = (targetNotFoundRetryCountsRef.current[missingStepId] ?? 0) + 1;
          targetNotFoundRetryCountsRef.current[missingStepId] = nextCount;

          if (nextCount <= maxRetries) {
            return;
          }

          if (targetNotFoundTimeoutsRef.current[missingStepId] === undefined) {
            targetNotFoundTimeoutsRef.current[missingStepId] = window.setTimeout(() => {
              delete targetNotFoundRetryCountsRef.current[missingStepId];
              clearTargetNotFoundTimer(missingStepId);

              setStepIndex((currentIndex) => {
                if (currentIndex !== eventIndex) {
                  return currentIndex;
                }
                const activeStep = tourSteps[currentIndex] as StepWithFnTarget | undefined;
                if (!isStepTargetMissing(activeStep)) {
                  return currentIndex;
                }
                return Math.max(0, Math.min(currentIndex + 1, onboardingSteps.length - 1));
              });
            }, TARGET_NOT_FOUND_FALLBACK_TIMEOUT_MS);
          }

          // Retries are exhausted; keep waiting for the fallback timer.
          return;
        }

        if (missingStepId) {
          clearTargetNotFoundTimer(missingStepId);
          delete targetNotFoundRetryCountsRef.current[missingStepId];
        }
      }

      if (type === EVENTS.STEP_AFTER && currentStepId) {
        clearTargetNotFoundTimer(currentStepId);
        delete targetNotFoundRetryCountsRef.current[currentStepId];
      }

      if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
        const isLastStep = eventIndex >= onboardingSteps.length - 1;

        // Complete the tour when the last step is advanced (TARGET_NOT_FOUND is already handled above).
        if (type === EVENTS.STEP_AFTER && isLastStep && action !== ACTIONS.PREV) {
          void stopTourAsCompleted();
          return;
        }
      }

      if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
        // When advancing from connected-accounts-link, navigate there.
        if (
          type === EVENTS.STEP_AFTER &&
          action !== ACTIONS.PREV &&
          currentStepId === 'connected-accounts-link'
        ) {
          router.push('/profile/connections?onboardingFlow=true');
          // Queue step advance to happen after navigation completes
          const nextStep = Math.max(0, Math.min(eventIndex + 1, onboardingSteps.length - 1));
          pendingNavigationStepAdvanceRef.current = nextStep;
          return;
        }

        // When advancing from the uploads sidebar link, navigate to the uploads page.
        if (
          type === EVENTS.STEP_AFTER &&
          action !== ACTIONS.PREV &&
          currentStepId === 'uploads-nav-link'
        ) {
          router.push('/dashboard/uploads?onboardingFlow=true');
          // Queue step advance to happen after navigation completes
          const nextStep = Math.max(0, Math.min(eventIndex + 1, onboardingSteps.length - 1));
          pendingNavigationStepAdvanceRef.current = nextStep;
          return;
        }

        // When advancing from create-draft button step, auto-click it to open the modal.
        if (
          type === EVENTS.STEP_AFTER &&
          action !== ACTIONS.PREV &&
          currentStepId === 'create-draft-button'
        ) {
          const createDraftButton = document.querySelector<HTMLButtonElement>(
            CREATE_DRAFT_BUTTON_SELECTOR
          );
          createDraftButton?.click();
        }

        setStepIndex(() => {
          const delta = action === ACTIONS.PREV ? -1 : 1;
          return Math.max(0, Math.min(eventIndex + delta, onboardingSteps.length - 1));
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
    [
      clearTargetNotFoundTimer,
      hasReplayStarted,
      router,
      shouldReplay,
      stepIndex,
      stopTourAsCompleted,
      tourSteps,
    ]
  );

  // Handle URL cleanup for replay
  useEffect(() => {
    if (pathname !== '/dashboard') return;
    if (!isReady || !shouldReplay || !hasReplayStarted) return;

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('onboarding');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [hasReplayStarted, isReady, pathname, router, searchParams, shouldReplay]);

  if (
    pathname !== '/dashboard' &&
    pathname !== '/profile/connections' &&
    pathname !== '/dashboard/uploads'
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
      steps={tourSteps as unknown as Step[]}
      tooltipComponent={TourTooltip}
    />
  );
}
