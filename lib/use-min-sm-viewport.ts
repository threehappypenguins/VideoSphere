import { useEffect, useState } from 'react';

const MIN_SM_MEDIA_QUERY = '(min-width: 640px)';

/**
 * Tracks whether the viewport is at least Tailwind's `sm` breakpoint (640px).
 * Defaults to `false` during SSR and the first client paint so server markup
 * matches hydration; syncs to `matchMedia` after mount.
 * @returns `true` when `min-width: 640px` matches.
 */
export function useMinSmViewport(): boolean {
  const [isMinSmViewport, setIsMinSmViewport] = useState(false);

  useEffect(() => {
    const mediaQueryList = window.matchMedia(MIN_SM_MEDIA_QUERY);
    const syncViewport = () => setIsMinSmViewport(mediaQueryList.matches);
    syncViewport();
    mediaQueryList.addEventListener('change', syncViewport);
    return () => mediaQueryList.removeEventListener('change', syncViewport);
  }, []);

  return isMinSmViewport;
}
