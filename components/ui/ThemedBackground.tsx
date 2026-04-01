'use client';

import { usePathname } from 'next/navigation';
import { GaussianNoiseBackground, PAGE_SEEDS } from './GaussianNoiseBackground';

export function ThemedBackground() {
  const pathname = usePathname();
  const seed = PAGE_SEEDS[pathname] ?? 42;
  return <GaussianNoiseBackground seed={seed} />;
}
