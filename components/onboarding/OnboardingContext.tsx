'use client';

import { createContext, useContext, useCallback, useState, ReactNode } from 'react';

interface OnboardingContextType {
  onboardingDraftId: string | null;
  setOnboardingDraftId: (id: string | null) => void;
  cleanupOnboardingDraft: () => Promise<void>;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [onboardingDraftId, setOnboardingDraftId] = useState<string | null>(null);

  const cleanupOnboardingDraft = useCallback(async (): Promise<void> => {
    if (!onboardingDraftId) return;

    try {
      const res = await fetch(`/api/drafts/${onboardingDraftId}`, { method: 'DELETE' });
      if (!res.ok) {
        console.warn('[OnboardingContext] Failed to cleanup draft:', onboardingDraftId);
      }
    } catch (err) {
      console.warn('[OnboardingContext] Error during cleanup:', err);
    } finally {
      setOnboardingDraftId(null);
    }
  }, [onboardingDraftId]);

  return (
    <OnboardingContext.Provider
      value={{
        onboardingDraftId,
        setOnboardingDraftId,
        cleanupOnboardingDraft,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboardingContext() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboardingContext must be used within OnboardingProvider');
  }
  return context;
}
