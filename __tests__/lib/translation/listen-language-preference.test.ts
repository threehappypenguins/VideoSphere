import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  clearListenLanguagePreference,
  listenLanguageCookieName,
  normalizeListenLanguagePreferenceValue,
  readListenLanguagePreference,
  writeListenLanguagePreference,
} from '@/lib/translation/listen-language-preference';

describe('listen language preference', () => {
  const store = new Map<string, string>();
  let cookieJar = '';

  beforeEach(() => {
    store.clear();
    cookieJar = '';
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
    vi.stubGlobal('document', {
      get cookie() {
        return cookieJar;
      },
      set cookie(value: string) {
        const [pair] = value.split(';');
        const eq = pair!.indexOf('=');
        const name = pair!.slice(0, eq);
        const raw = pair!.slice(eq + 1);
        if (value.includes('Max-Age=0')) {
          cookieJar = cookieJar
            .split('; ')
            .filter((part) => part && !part.startsWith(`${name}=`))
            .join('; ');
          return;
        }
        const next = `${name}=${raw}`;
        const parts = cookieJar.split('; ').filter((part) => part && !part.startsWith(`${name}=`));
        parts.push(next);
        cookieJar = parts.join('; ');
      },
    });
    vi.stubGlobal('window', {
      location: { protocol: 'http:' },
      localStorage: globalThis.localStorage,
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

  it('mirrors the preference into a SameSite cookie for SSR', () => {
    writeListenLanguagePreference('demo-church', 'zh');
    expect(cookieJar).toContain(`${listenLanguageCookieName('demo-church')}=zh`);
  });

  it('normalizes saved codes to lowercase', () => {
    writeListenLanguagePreference('demo', ' ES ');
    expect(readListenLanguagePreference('demo')).toBe('es');
  });

  it('ignores null or empty language without clearing an existing preference', () => {
    writeListenLanguagePreference('demo', 'tl');
    writeListenLanguagePreference('demo', null);
    writeListenLanguagePreference('demo', undefined);
    writeListenLanguagePreference('demo', '  ');
    expect(readListenLanguagePreference('demo')).toBe('tl');
  });

  it('clears a stored preference and cookie', () => {
    writeListenLanguagePreference('demo', 'tl');
    clearListenLanguagePreference('demo');
    expect(readListenLanguagePreference('demo')).toBeNull();
    expect(cookieJar).not.toContain(`${listenLanguageCookieName('demo')}=tl`);
  });

  it('normalizes cookie values the same way as storage values', () => {
    expect(normalizeListenLanguagePreferenceValue(' ZH ')).toBe('zh');
    expect(normalizeListenLanguagePreferenceValue('')).toBeNull();
    expect(normalizeListenLanguagePreferenceValue(undefined)).toBeNull();
  });
});
