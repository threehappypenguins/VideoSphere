// =============================================================================
// PROFILE CONTENT COMPONENT TESTS
// =============================================================================
// Lightweight UI tests for ProfileContent: account status and
// Manage connected accounts link to prevent regressions.
//
// The profile page now uses a client component (ProfileContent) that fetches
// session + profile data from API routes. These tests mock the fetch calls
// to verify rendered output for a standard user.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ProfileContent } from '@/app/(dashboard)/profile/ProfileContent';

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

function renderProfile(oauthError: string | null = null) {
  return render(<ProfileContent oauthSuccess={null} oauthError={oauthError} />);
}

describe('ProfileContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (String(url).includes('/api/auth/session-role')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ role: 'user' }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            $id: 'user_1',
            name: 'Test',
            email: 'test@test.com',
            authProvider: 'password',
          }),
        } as Response);
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows OAuth connect error feedback at the top of the page', async () => {
    renderProfile('oauth_connect_email_mismatch');
    await waitFor(() => {
      expect(
        screen.getByText(/google account email does not match your videosphere account email/i)
      ).toBeInTheDocument();
    });
  });

  it('renders the account settings heading', async () => {
    renderProfile();
    await waitFor(() => {
      expect(screen.getByText('Account Settings')).toBeInTheDocument();
    });
  });

  it('does not render legacy subscription copy', async () => {
    renderProfile();
    await waitFor(() => {
      expect(screen.queryByText('Subscription')).not.toBeInTheDocument();
      expect(screen.queryByText('Standard')).not.toBeInTheDocument();
      expect(screen.queryByText('Your account is active.')).not.toBeInTheDocument();
    });
  });

  it('renders Manage connected accounts link targeting /profile/connections', async () => {
    renderProfile();
    await waitFor(() => {
      const connectionsLink = screen.getByRole('link', { name: /manage connected accounts/i });
      expect(connectionsLink).toBeInTheDocument();
      expect(connectionsLink).toHaveAttribute('href', '/profile/connections');
    });
  });
});
