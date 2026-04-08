'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { GaussianNoiseBackground, PAGE_SEEDS } from './GaussianNoiseBackground';
import {
  BACKGROUND_GRAIN_EVENT,
  getBackgroundGrainEnabled,
  isBackgroundGrainStorageKey,
} from '@/lib/ui/background-preference';

/**
 * Renders the themed background component.
 * @returns The rendered UI output.
 */
export function ThemedBackground() {
  const pathname = usePathname();
  const [grainEnabled, setGrainEnabled] = useState(() => getBackgroundGrainEnabled());

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (!isBackgroundGrainStorageKey(event.key)) return;
      setGrainEnabled(getBackgroundGrainEnabled());
    };

    const handleSameTabChange = () => {
      setGrainEnabled(getBackgroundGrainEnabled());
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(BACKGROUND_GRAIN_EVENT, handleSameTabChange);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(BACKGROUND_GRAIN_EVENT, handleSameTabChange);
    };
  }, []);

  if (!grainEnabled) return null;

  const seed = PAGE_SEEDS[pathname] ?? 42;
  return <GaussianNoiseBackground seed={seed} />;
}
