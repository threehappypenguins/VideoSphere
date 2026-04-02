const BACKGROUND_GRAIN_STORAGE_KEY = 'videosphere.background.grainEnabled';
export const BACKGROUND_GRAIN_EVENT = 'videosphere:background-grain-changed';

/** Default is enabled when no preference has been stored yet. */
export function getBackgroundGrainEnabled(): boolean {
  if (typeof window === 'undefined') return true;

  try {
    const raw = window.localStorage.getItem(BACKGROUND_GRAIN_STORAGE_KEY);
    if (raw === null) return true;
    return raw !== 'false';
  } catch {
    return true;
  }
}

export function setBackgroundGrainEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(BACKGROUND_GRAIN_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage write failures (private mode / blocked storage).
  }

  window.dispatchEvent(
    new CustomEvent(BACKGROUND_GRAIN_EVENT, {
      detail: { enabled },
    })
  );
}

export function isBackgroundGrainStorageKey(key: string | null): boolean {
  return key === BACKGROUND_GRAIN_STORAGE_KEY;
}
