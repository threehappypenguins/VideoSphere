/**
 * Tests for ProfileContent component.
 *
 * Verifies:
 * - Displays subscription status from API
 * - Shows success banner on ?upgrade=success
 * - Shows upgrade link for free-tier users
 * - Shows supporter badge for upgraded users
 *
 * Note: Route protection (unauthenticated → login redirect) is handled by
 * proxy.ts middleware, not the component. See __tests__/middleware/proxy.test.ts.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock next/navigation
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
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
const toastSuccessMock = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: vi.fn(),
  },
}));

// Mock window.history.replaceState
const replaceStateMock = vi.fn();
Object.defineProperty(window, 'history', {
  writable: true,
  value: { replaceState: replaceStateMock },
});

import { ProfileContent } from '@/app/profile/ProfileContent';

function mockFetchResponses(responses: Array<{ ok: boolean; data?: unknown }>) {
  const iter = responses[Symbol.iterator]();
  global.fetch = vi.fn(() => {
    const next = iter.next();
    if (next.done) return Promise.reject(new Error('No more mocked responses'));
    const { ok, data } = next.value;
    return Promise.resolve({
      ok,
      status: ok ? 200 : 401,
      json: () => Promise.resolve(data ?? {}),
    } as Response);
  });
}

describe('ProfileContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders gracefully when session fetch fails (proxy handles redirect)', async () => {
    mockFetchResponses([{ ok: false }, { ok: false }]);

    render(<ProfileContent />);

    // Loading spinner should appear then disappear
    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
    });
  });

  it('shows loading spinner initially', () => {
    // Never resolve fetch
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));

    render(<ProfileContent />);

    // The spinner has the animate-spin class
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('displays free-tier subscription status', async () => {
    mockFetchResponses([
      // Session
      { ok: true, data: { $id: 'user_123', name: 'Test User', email: 'test@example.com' } },
      // Profile
      { ok: true, data: { userId: 'user_123', email: 'test@example.com', isSupporter: false } },
    ]);

    render(<ProfileContent />);

    await waitFor(() => {
      expect(screen.getByText('Free')).toBeInTheDocument();
    });

    expect(
      screen.getByText('You are currently on the Free plan. Upgrade to unlock premium features.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upgrade to Supporter' })).toHaveAttribute(
      'href',
      '/pricing'
    );
  });

  it('displays supporter subscription status', async () => {
    mockFetchResponses([
      // Session
      { ok: true, data: { $id: 'user_123', name: 'Test User', email: 'test@example.com' } },
      // Profile
      { ok: true, data: { userId: 'user_123', email: 'test@example.com', isSupporter: true } },
    ]);

    render(<ProfileContent />);

    await waitFor(() => {
      expect(screen.getByText('Supporter')).toBeInTheDocument();
    });

    expect(screen.getByText(/You're a Supporter!/)).toBeInTheDocument();
    // Should not show upgrade link
    expect(screen.queryByRole('link', { name: 'Upgrade to Supporter' })).not.toBeInTheDocument();
  });

  it('shows success banner on ?upgrade=success', async () => {
    mockSearchParams = new URLSearchParams('upgrade=success');

    mockFetchResponses([
      // Session
      { ok: true, data: { $id: 'user_123', name: 'Test User', email: 'test@example.com' } },
      // Profile
      { ok: true, data: { userId: 'user_123', email: 'test@example.com', isSupporter: true } },
    ]);

    render(<ProfileContent />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText(/Welcome to Supporter!/)).toBeInTheDocument();
    expect(toastSuccessMock).toHaveBeenCalledWith(
      'Welcome to Supporter! Your account has been upgraded.'
    );
    expect(replaceStateMock).toHaveBeenCalledWith({}, '', '/profile');
  });

  it('populates form fields with session user data', async () => {
    mockFetchResponses([
      // Session
      { ok: true, data: { $id: 'user_123', name: 'Jane Doe', email: 'jane@example.com' } },
      // Profile
      { ok: true, data: { userId: 'user_123', email: 'jane@example.com', isSupporter: false } },
    ]);

    render(<ProfileContent />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Jane Doe')).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('jane@example.com')).toBeInTheDocument();
  });

  it('shows connected accounts link', async () => {
    mockFetchResponses([
      { ok: true, data: { $id: 'user_123', name: 'Test', email: 'test@example.com' } },
      { ok: true, data: { userId: 'user_123', email: 'test@example.com', isSupporter: false } },
    ]);

    render(<ProfileContent />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Manage connected accounts' })).toHaveAttribute(
        'href',
        '/profile/connections'
      );
    });
  });
});
