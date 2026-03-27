// =============================================================================
// PROFILE PAGE COMPONENT TESTS
// =============================================================================
// Lightweight UI tests for the Profile page: Free badge, Upgrade CTA, and
// Manage connected accounts link to prevent regressions.
//
// The profile page now uses a client component (ProfileContent) that fetches
// session + profile data from API routes. These tests mock the fetch calls
// to verify rendered output for a free-tier user.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ProfilePage from '@/app/profile/page';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
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
    // Mock fetch to return a free-tier authenticated user
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ $id: 'user_1', name: 'Test', email: 'test@test.com' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ userId: 'user_1', email: 'test@test.com', isSupporter: false }),
      } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the Free plan badge', async () => {
    render(<ProfilePage />);
    await waitFor(() => {
      expect(screen.getByText('Free')).toBeInTheDocument();
    });
  });

  it('renders Upgrade to Supporter CTA linking to /pricing', async () => {
    render(<ProfilePage />);
    await waitFor(() => {
      const upgradeLink = screen.getByRole('link', { name: /upgrade to supporter/i });
      expect(upgradeLink).toBeInTheDocument();
      expect(upgradeLink).toHaveAttribute('href', '/pricing');
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
