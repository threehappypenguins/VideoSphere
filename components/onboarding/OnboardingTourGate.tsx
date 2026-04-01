'use client';

import { usePathname } from 'next/navigation';
import { Suspense } from 'react';
import { OnboardingTour } from './OnboardingTour';

/**
 * Client-side gate for OnboardingTour that only renders on routes where
 * onboarding can run. This prevents unnecessary API calls and network
 * requests on other pages.
 */
export function OnboardingTourGate() {
  const pathname = usePathname();

  // Keep this list aligned with OnboardingTour route checks.
  const isOnboardingRoute =
    pathname === '/dashboard' ||
    pathname === '/dashboard/drafts' ||
    pathname === '/profile/connections';
  if (!isOnboardingRoute) return null;

  return (
    <Suspense fallback={null}>
      <OnboardingTour />
    </Suspense>
  );
}
