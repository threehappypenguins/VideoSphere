import { useSyncExternalStore } from 'react';

const MIN_SM_MEDIA_QUERY = '(min-width: 640px)';

function subscribeToMinSmViewport(onStoreChange: () => void): () => void {
  const mediaQueryList = window.matchMedia(MIN_SM_MEDIA_QUERY);
  mediaQueryList.addEventListener('change', onStoreChange);
  return () => mediaQueryList.removeEventListener('change', onStoreChange);
}

function getMinSmViewportSnapshot(): boolean {
  return window.matchMedia(MIN_SM_MEDIA_QUERY).matches;
}

function getMinSmViewportServerSnapshot(): boolean {
  return true;
}

/**
 * Tracks whether the viewport is at least Tailwind's `sm` breakpoint (640px).
 * @returns `true` when `min-width: 640px` matches.
 */
export function useMinSmViewport(): boolean {
  return useSyncExternalStore(
    subscribeToMinSmViewport,
    getMinSmViewportSnapshot,
    getMinSmViewportServerSnapshot
  );
}
