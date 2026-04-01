'use client';

import { usePathname } from 'next/navigation';
import { Suspense } from 'react';
import { OnboardingTour } from './OnboardingTour';

/**
 * Client-side gate for OnboardingTour that only renders on routes where
 * onboarding can run (/dashboard, /profile). This prevents unnecessary
 * API calls and network requests on other pages.
 */
export function OnboardingTourGate() {
  const pathname = usePathname();

  // Only render tour on authenticated pages where onboarding can run.
  const isOnboardingRoute = pathname.startsWith('/dashboard') || pathname.startsWith('/profile');
  if (!isOnboardingRoute) return null;

  return (
    <Suspense fallback={null}>
      <OnboardingTour />
    </Suspense>
  );
}
