import { useState, useCallback } from 'react';

export function useDraftWizard() {
  const [isOpen, setIsOpen] = useState(false);

  const openWizard = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeWizard = useCallback(() => {
    setIsOpen(false);
  }, []);

  return {
    isOpen,
    openWizard,
    closeWizard,
  };
}
