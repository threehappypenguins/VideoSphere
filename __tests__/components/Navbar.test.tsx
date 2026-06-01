import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Navbar from '@/components/layout/Navbar';

const mockPush = vi.fn();
const mockPathname = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockPathname(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/image', () => ({
  default: ({ alt, priority: _priority, ...rest }: any) => (
    <span role="img" aria-label={alt} {...rest} />
  ),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'system',
    setTheme: vi.fn(),
    resolvedTheme: 'light',
  }),
}));

vi.mock('@/lib/auth-client', () => ({
  logout: vi.fn(),
}));

describe('Navbar admin link visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue('/dashboard');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows Invites links for admin users', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ $id: 'user_admin_1', name: 'Admin User', email: 'admin@test.com' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ role: 'admin' }),
        } as Response)
    );

    render(<Navbar />);

    await waitFor(() => {
      const invitesLink = screen.getByRole('link', { name: 'Invites' });
      expect(invitesLink).toHaveAttribute('href', '/settings/invites');
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/session',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/session-role',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('does not show Invites links for non-admin users', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            $id: 'user_regular_1',
            name: 'Regular User',
            email: 'user@test.com',
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ role: 'user' }),
        } as Response)
    );

    render(<Navbar />);

    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    expect(screen.queryByRole('link', { name: 'Invites' })).not.toBeInTheDocument();
  });

  it('shows Invites in mobile menu and closes menu on click', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ $id: 'user_admin_2', name: 'Admin User', email: 'admin@test.com' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ role: 'admin' }),
        } as Response)
    );

    render(<Navbar />);

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    const menuToggle = screen.getByRole('button', { name: 'Toggle navigation menu' });
    expect(menuToggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(menuToggle);
    expect(menuToggle).toHaveAttribute('aria-expanded', 'true');

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: 'Invites' })).toHaveLength(2);
    });

    expect(screen.getAllByRole('link', { name: 'Invites' })[0]).not.toHaveAttribute('aria-current');

    const invitesLinks = screen.getAllByRole('link', { name: 'Invites' });
    await user.click(invitesLinks[1]);

    await waitFor(() => {
      expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getAllByRole('link', { name: 'Invites' })).toHaveLength(1);
    });
  });

  it('marks Invites links as current on invite settings routes', async () => {
    mockPathname.mockReturnValue('/settings/invites');

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ $id: 'user_admin_3', name: 'Admin User', email: 'admin@test.com' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ role: 'admin' }),
        } as Response)
    );

    render(<Navbar />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Invites' })).toHaveAttribute('aria-current', 'page');
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Toggle navigation menu' }));

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: 'Invites' })).toHaveLength(2);
    });

    for (const invitesLink of screen.getAllByRole('link', { name: 'Invites' })) {
      expect(invitesLink).toHaveAttribute('aria-current', 'page');
    }
  });

  it('does not render a signed-out Home nav link while waiting for session fetch', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );
    mockPathname.mockReturnValue('/');

    render(<Navbar initialSessionUser={null} initialHasAdminRole={false} />);

    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
  });

  it('does not flash marketing links for authenticated server state before client fetch resolves', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );

    render(
      <Navbar
        initialSessionUser={{ $id: 'user-auth-1', name: 'Auth User', email: 'auth@test.com' }}
        initialHasAdminRole={false}
      />
    );

    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Profile' })).toBeInTheDocument();
  });
});
