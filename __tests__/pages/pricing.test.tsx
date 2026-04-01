import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PricingPage, { metadata } from '@/app/(marketing)/pricing/page';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const toastErrorMock = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: toastErrorMock,
    loading: vi.fn(),
  },
}));

function mockFetchResponses(responses: Array<{ ok: boolean; data?: unknown; status?: number }>) {
  const iter = responses[Symbol.iterator]();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      const next = iter.next();
      if (next.done) return Promise.reject(new Error('No more mocked responses'));
      const { ok, data, status } = next.value;
      return Promise.resolve({
        ok,
        status: status ?? (ok ? 200 : 401),
        json: () => Promise.resolve(data ?? {}),
      } as Response);
    })
  );
}

describe('PricingPage', () => {
  let originalLocation: Location;

  beforeEach(() => {
    vi.clearAllMocks();
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('exports route metadata for SEO consistency', () => {
    expect(metadata.title).toBe('Pricing — VideoSphere');
    expect(metadata.description).toContain('VideoSphere pricing');
  });

  it('shows default CTAs and no plan badges for logged-out visitors', async () => {
    mockFetchResponses([{ ok: false }]);

    render(<PricingPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Get Started Free' })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /upgrade to supporter tier/i })).toBeInTheDocument();
    expect(screen.queryByText('Current Plan')).not.toBeInTheDocument();
    expect(screen.queryByText('Your Plan')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /upgrade to supporter tier/i }));
    expect(pushMock).toHaveBeenCalledWith('/login?redirect=/pricing');
  });

  it('shows Current Plan on Free tier for authenticated free users', async () => {
    mockFetchResponses([
      { ok: true, data: { $id: 'user_123', email: 'free@test.com' } },
      { ok: true, data: { isSupporter: false } },
    ]);

    render(<PricingPage />);

    await waitFor(() => {
      expect(screen.getByText('Current Plan')).toBeInTheDocument();
    });

    expect(screen.queryByText('Your Plan')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upgrade to supporter tier/i })).toBeInTheDocument();
  });

  it('shows Your Plan on Supporter tier for authenticated supporters', async () => {
    mockFetchResponses([
      { ok: true, data: { $id: 'user_123', email: 'supporter@test.com' } },
      { ok: true, data: { isSupporter: true } },
    ]);

    render(<PricingPage />);

    await waitFor(() => {
      expect(screen.getByText('Your Plan')).toBeInTheDocument();
      expect(screen.getByText('✓ Supporter Active')).toBeInTheDocument();
    });

    expect(
      screen.queryByRole('button', { name: /upgrade to supporter tier/i })
    ).not.toBeInTheDocument();
  });
});
