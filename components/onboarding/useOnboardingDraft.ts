'use client';

import { useCallback, useState } from 'react';

/**
 * Manages the temporary draft created during onboarding.
 * When onboarding completes or is skipped, the draft is deleted.
 */
export function useOnboardingDraft() {
  const [onboardingDraftId, setOnboardingDraftId] = useState<string | null>(null);

  const setDraftId = useCallback((id: string | null) => {
    setOnboardingDraftId(id);
  }, []);

  const cleanupDraft = useCallback(async (): Promise<void> => {
    if (!onboardingDraftId) return;

    try {
      const res = await fetch(`/api/drafts/${onboardingDraftId}`, { method: 'DELETE' });
      if (!res.ok) {
        console.warn('[useOnboardingDraft] Failed to cleanup draft:', onboardingDraftId);
      }
    } catch (err) {
      console.warn('[useOnboardingDraft] Error during cleanup:', err);
    } finally {
      setOnboardingDraftId(null);
    }
  }, [onboardingDraftId]);

  return {
    onboardingDraftId,
    setDraftId,
    cleanupDraft,
  };
}
