import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  clearListenLanguagePreference,
  readListenLanguagePreference,
  writeListenLanguagePreference,
} from '@/lib/translation/listen-language-preference';

describe('listen language preference', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips a language preference per slug', () => {
    writeListenLanguagePreference('sunday-service', 'tl');
    expect(readListenLanguagePreference('sunday-service')).toBe('tl');
    expect(readListenLanguagePreference('other-slug')).toBeNull();
  });

  it('normalizes saved codes to lowercase', () => {
    writeListenLanguagePreference('demo', ' ES ');
    expect(readListenLanguagePreference('demo')).toBe('es');
  });

  it('clears a stored preference', () => {
    writeListenLanguagePreference('demo', 'tl');
    clearListenLanguagePreference('demo');
    expect(readListenLanguagePreference('demo')).toBeNull();
  });
});
