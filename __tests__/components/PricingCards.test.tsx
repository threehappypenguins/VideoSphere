/**
 * Tests for PricingCards component.
 *
 * Verifies:
 * - Renders both tier cards
 * - Shows "Get Started Free" link for unauthenticated users
 * - Shows "Become a Supporter" checkout button for authenticated free-tier users
 * - Shows "Supporter Active" badge for supporters
 * - Calls checkout API and redirects on click
 * - Shows error toast on checkout failure
 * - Redirects unauthenticated users to login when clicking upgrade
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock next/navigation
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// Mock next/link
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

// Mock sonner
const toastErrorMock = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: toastErrorMock,
    loading: vi.fn(),
  },
}));

import { PricingCards } from '@/app/(marketing)/pricing/PricingCards';

// Helper to mock fetch responses
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

describe('PricingCards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset window.location mock
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders both tier cards with feature lists', async () => {
    // Unauthenticated: session returns 401
    mockFetchResponses([{ ok: false }]);

    render(<PricingCards />);

    await waitFor(() => {
      expect(screen.getByText('Free')).toBeInTheDocument();
      expect(screen.getByText('Supporter')).toBeInTheDocument();
    });

    expect(screen.getByText('10 uploads per month')).toBeInTheDocument();
    expect(screen.getByText('Unlimited uploads')).toBeInTheDocument();
  });

  it('shows signup link for unauthenticated visitors', async () => {
    mockFetchResponses([{ ok: false }]);

    render(<PricingCards />);

    await waitFor(() => {
      expect(screen.getByText('Get Started Free')).toBeInTheDocument();
    });

    const freeLink = screen.getByRole('link', { name: 'Get Started Free' });
    expect(freeLink).toHaveAttribute('href', '/signup');
  });

  it('redirects unauthenticated user to login when clicking Supporter CTA', async () => {
    mockFetchResponses([{ ok: false }]);

    render(<PricingCards />);

    await waitFor(() => {
      expect(screen.getByText('Become a Supporter')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /upgrade to supporter/i }));

    expect(pushMock).toHaveBeenCalledWith('/login?redirect=/pricing');
  });

  it('shows dashboard link and checkout button for authenticated free user', async () => {
    mockFetchResponses([
      // Session: authenticated
      { ok: true, data: { $id: 'user_123', email: 'test@test.com' } },
      // Profile: free tier
      { ok: true, data: { isSupporter: false } },
    ]);

    render(<PricingCards />);

    await waitFor(() => {
      expect(screen.getByText('Go to Dashboard')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /upgrade to supporter/i })).toBeInTheDocument();
  });

  it('calls checkout API and redirects to Stripe on success', async () => {
    mockFetchResponses([
      // Session
      { ok: true, data: { $id: 'user_123', email: 'test@test.com' } },
      // Profile
      { ok: true, data: { isSupporter: false } },
    ]);

    render(<PricingCards />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /upgrade to supporter/i })).toBeInTheDocument();
    });

    // Mock the checkout API call
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ checkoutUrl: 'https://checkout.stripe.com/pay/test' }),
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /upgrade to supporter/i }));

    await waitFor(() => {
      expect(window.location.href).toBe('https://checkout.stripe.com/pay/test');
    });
  });

  it('shows error toast when checkout API fails', async () => {
    mockFetchResponses([
      // Session
      { ok: true, data: { $id: 'user_123', email: 'test@test.com' } },
      // Profile
      { ok: true, data: { isSupporter: false } },
    ]);

    render(<PricingCards />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /upgrade to supporter/i })).toBeInTheDocument();
    });

    // Mock checkout API failure
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Payment service not configured' }),
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /upgrade to supporter/i }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Payment service not configured');
    });
  });

  it('shows supporter badge for upgraded users', async () => {
    mockFetchResponses([
      // Session
      { ok: true, data: { $id: 'user_123', email: 'test@test.com' } },
      // Profile: supporter
      { ok: true, data: { isSupporter: true } },
    ]);

    render(<PricingCards />);

    await waitFor(() => {
      expect(screen.getByText("You're a Supporter!")).toBeInTheDocument();
      expect(screen.getByText('✓ Supporter Active')).toBeInTheDocument();
    });

    // Should not show a checkout button
    expect(screen.queryByRole('button', { name: /upgrade to supporter/i })).not.toBeInTheDocument();
  });
});
