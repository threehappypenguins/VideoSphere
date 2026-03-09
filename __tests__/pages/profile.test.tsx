// =============================================================================
// PROFILE PAGE COMPONENT TESTS
// =============================================================================
// Lightweight UI tests for the Profile page: Free badge, Upgrade CTA, and
// Manage connected accounts link to prevent regressions.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProfilePage from '@/app/profile/page';

describe('ProfilePage', () => {
  it('renders the Free plan badge', () => {
    render(<ProfilePage />);
    expect(screen.getByText('Free')).toBeInTheDocument();
  });

  it('renders Upgrade to Supporter CTA linking to /pricing', () => {
    render(<ProfilePage />);
    const upgradeLink = screen.getByRole('link', { name: /upgrade to supporter/i });
    expect(upgradeLink).toBeInTheDocument();
    expect(upgradeLink).toHaveAttribute('href', '/pricing');
  });

  it('renders Manage connected accounts link targeting /profile/connections', () => {
    render(<ProfilePage />);
    const connectionsLink = screen.getByRole('link', { name: /manage connected accounts/i });
    expect(connectionsLink).toBeInTheDocument();
    expect(connectionsLink).toHaveAttribute('href', '/profile/connections');
  });
});
