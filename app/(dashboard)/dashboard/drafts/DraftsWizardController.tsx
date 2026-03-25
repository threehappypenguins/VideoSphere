'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { DraftWizard } from '@/components/DraftWizard';
import { useDraftWizard } from '@/hooks/use-draft-wizard';

interface DraftsWizardControllerProps {
  openButton: React.ReactNode;
}

/**
 * Client component that manages `DraftWizard` open/close state.
 * Separated so the parent `DraftsPage` can remain a server component
 * and export `metadata` for `<head>`.
 *
 * Renders `openButton` with an injected `onClick` handler, then mounts
 * the wizard dialog alongside it.
 */
export function DraftsWizardController({ openButton }: DraftsWizardControllerProps) {
  const { isOpen, openWizard, closeWizard } = useDraftWizard();
  const searchParams = useSearchParams();

  // Open wizard when navigated to with ?openWizard=true (e.g. "New upload" quick action).
  // Use the resolved string value as the dependency so the effect only re-runs
  // when the flag actually changes, not on every render.
  const openWizardParam = searchParams.get('openWizard');
  useEffect(() => {
    if (openWizardParam === 'true') {
      openWizard();
    }
  }, [openWizardParam, openWizard]);

  return (
    <>
      <button
        type="button"
        onClick={openWizard}
        className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {openButton}
      </button>

      <DraftWizard isOpen={isOpen} onClose={closeWizard} />
    </>
  );
}
