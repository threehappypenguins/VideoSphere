import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMinSmViewport } from '@/lib/use-min-sm-viewport';

function ViewportProbe() {
  const isMinSmViewport = useMinSmViewport();
  return createElement('span', {
    'data-viewport': isMinSmViewport ? 'desktop' : 'mobile',
  });
}

describe('useMinSmViewport', () => {
  let listeners: Set<() => void>;
  let matches = false;

  beforeEach(() => {
    listeners = new Set();
    matches = false;

    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      onchange: null,
      addEventListener: (_event: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_event: string, listener: () => void) => {
        listeners.delete(listener);
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the mobile branch during SSR so hydration matches narrow viewports', () => {
    matches = true;
    const html = renderToString(createElement(ViewportProbe));
    expect(html).toContain('data-viewport="mobile"');
  });

  it('syncs to the current viewport after mount', async () => {
    matches = true;
    const { result } = renderHook(() => useMinSmViewport());

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it('updates when the viewport media query changes', async () => {
    matches = false;
    const { result } = renderHook(() => useMinSmViewport());

    await waitFor(() => {
      expect(result.current).toBe(false);
    });

    matches = true;
    act(() => {
      for (const listener of listeners) {
        listener();
      }
    });

    expect(result.current).toBe(true);
  });
});
