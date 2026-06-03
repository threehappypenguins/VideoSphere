/**
 * Tests for ProfileContent component.
 *
 * Verifies:
 * - Hides legacy subscription status UI
 * - Keeps account tools and profile form fields visible
 *
 * Note: Route protection (unauthenticated → login redirect) is handled by
 * proxy.ts middleware, not the component. See __tests__/middleware/proxy.test.ts.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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

import { ProfileContent } from '@/app/(dashboard)/profile/ProfileContent';

const defaultOAuthFlash = { oauthSuccess: null, oauthError: null } as const;

function renderProfile(
  props: Partial<{ oauthSuccess: string | null; oauthError: string | null }> = {}
) {
  return render(<ProfileContent {...defaultOAuthFlash} {...props} />);
}

function mockFetchResponses(responses: Array<{ ok: boolean; data?: unknown }>) {
  const iter = responses[Symbol.iterator]();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      const next = iter.next();
      if (next.done) return Promise.reject(new Error('No more mocked responses'));
      const { ok, data } = next.value;
      return Promise.resolve({
        ok,
        status: ok ? 200 : 401,
        json: () => Promise.resolve(data ?? {}),
      } as Response);
    })
  );
}

describe('ProfileContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders gracefully when session fetch fails (proxy handles redirect)', async () => {
    mockFetchResponses([{ ok: false }]);

    renderProfile();

    // Loading spinner should appear then disappear
    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
    });
  });

  it('shows loading spinner initially', () => {
    // Never resolve fetch
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));

    renderProfile();

    // The spinner has the animate-spin class
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('does not display legacy subscription copy', async () => {
    mockFetchResponses([
      {
        ok: true,
        data: {
          $id: 'user_123',
          name: 'Test User',
          email: 'test@example.com',
          authProvider: 'password',
        },
      },
      { ok: true, data: { role: 'user' } },
    ]);

    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Account Settings')).toBeInTheDocument();
    });

    expect(screen.queryByText('Subscription')).not.toBeInTheDocument();
    expect(screen.queryByText('Standard')).not.toBeInTheDocument();
    expect(screen.queryByText('Your account is active.')).not.toBeInTheDocument();
  });

  it('populates form fields with session user data', async () => {
    mockFetchResponses([
      {
        ok: true,
        data: {
          $id: 'user_123',
          name: 'Jane Doe',
          email: 'jane@example.com',
          authProvider: 'password',
        },
      },
      { ok: true, data: { role: 'user' } },
    ]);

    renderProfile();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Jane Doe')).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('jane@example.com')).toBeInTheDocument();
  });

  it('shows connected accounts link', async () => {
    mockFetchResponses([
      {
        ok: true,
        data: {
          $id: 'user_123',
          name: 'Test',
          email: 'test@example.com',
          authProvider: 'password',
        },
      },
      { ok: true, data: { role: 'user' } },
    ]);

    renderProfile();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Manage connected accounts' })).toHaveAttribute(
        'href',
        '/profile/connections'
      );
    });
  });

  it('renders account tools for any authenticated user', async () => {
    mockFetchResponses([
      {
        ok: true,
        data: {
          $id: 'user_123',
          name: 'User',
          email: 'user@example.com',
          authProvider: 'password',
        },
      },
      { ok: true, data: { role: 'user' } },
    ]);

    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Account Tools')).toBeInTheDocument();
    });
  });

  it('shows user management card for admin users', async () => {
    mockFetchResponses([
      {
        ok: true,
        data: {
          $id: 'admin_123',
          name: 'Admin',
          email: 'admin@example.com',
          authProvider: 'password',
        },
      },
      { ok: true, data: { role: 'admin' } },
    ]);

    renderProfile();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'User management' })).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'Open user management' })).toHaveAttribute(
      'href',
      '/dashboard/users'
    );
  });

  it('hides user management card for non-admin users', async () => {
    mockFetchResponses([
      {
        ok: true,
        data: {
          $id: 'user_123',
          name: 'User',
          email: 'user@example.com',
          authProvider: 'password',
        },
      },
      { ok: true, data: { role: 'user' } },
    ]);

    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Account Settings')).toBeInTheDocument();
    });

    expect(screen.queryByRole('heading', { name: 'User management' })).not.toBeInTheDocument();
  });
});
