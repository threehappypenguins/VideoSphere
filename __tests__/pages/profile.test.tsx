// =============================================================================
// PROFILE PAGE COMPONENT TESTS
// =============================================================================
// Lightweight UI tests for the Profile page: account status and
// Manage connected accounts link to prevent regressions.
//
// The profile page now uses a client component (ProfileContent) that fetches
// session + profile data from API routes. These tests mock the fetch calls
// to verify rendered output for a standard user.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ProfilePage from '@/app/(dashboard)/profile/page';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock fetch to return an authenticated user
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ $id: 'user_1', name: 'Test', email: 'test@test.com' }),
      } as Response)
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the account settings heading', async () => {
    render(<ProfilePage />);
    await waitFor(() => {
      expect(screen.getByText('Account Settings')).toBeInTheDocument();
    });
  });

  it('does not render legacy subscription copy', async () => {
    render(<ProfilePage />);
    await waitFor(() => {
      expect(screen.queryByText('Subscription')).not.toBeInTheDocument();
      expect(screen.queryByText('Standard')).not.toBeInTheDocument();
      expect(screen.queryByText('Your account is active.')).not.toBeInTheDocument();
    });
  });

  it('renders Manage connected accounts link targeting /profile/connections', async () => {
    render(<ProfilePage />);
    await waitFor(() => {
      const connectionsLink = screen.getByRole('link', { name: /manage connected accounts/i });
      expect(connectionsLink).toBeInTheDocument();
      expect(connectionsLink).toHaveAttribute('href', '/profile/connections');
    });
  });
});
