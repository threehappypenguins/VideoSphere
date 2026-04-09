'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { OnboardingTour } from './OnboardingTour';

/**
 * Client-side gate for OnboardingTour that only renders on routes where
 * onboarding can run. This prevents unnecessary API calls and network
 * requests on other pages.
 */
function OnboardingTourGateContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Keep this predicate aligned with OnboardingTour route/query checks.
  const isOnboardingRoute =
    pathname === '/dashboard' ||
    (pathname === '/dashboard/drafts' && searchParams.has('onboardingFlow')) ||
    (pathname === '/profile/connections' && searchParams.has('onboardingFlow'));
  if (!isOnboardingRoute) return null;

  return <OnboardingTour />;
}

/**
 * Renders the onboarding tour gate component.
 * @returns The rendered UI output.
 */
export function OnboardingTourGate() {
  return (
    <Suspense fallback={null}>
      <OnboardingTourGateContent />
    </Suspense>
  );
}
