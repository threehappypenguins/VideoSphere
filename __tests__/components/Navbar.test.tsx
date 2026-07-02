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

function mockSessionFetch(user: Record<string, unknown> | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: user !== null,
      status: user !== null ? 200 : 401,
      json: async () => user,
    } as Response)
  );
}

describe('Navbar admin link visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue('/dashboard');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not show a separate Invites nav link for admin users', async () => {
    mockSessionFetch({ $id: 'user_admin_1', name: 'Admin User', email: 'admin@test.com' });

    render(<Navbar />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Profile' })).toBeInTheDocument();
    });

    expect(screen.queryByRole('link', { name: 'Invites' })).not.toBeInTheDocument();
  });

  it('does not show Invites links for non-admin users', async () => {
    mockSessionFetch({
      $id: 'user_regular_1',
      name: 'Regular User',
      email: 'user@test.com',
    });

    render(<Navbar />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Profile' })).toBeInTheDocument();
    });

    expect(screen.queryByRole('link', { name: 'Invites' })).not.toBeInTheDocument();
  });

  it('shows Profile in mobile menu and closes menu on click', async () => {
    mockSessionFetch({ $id: 'user_admin_2', name: 'Admin User', email: 'admin@test.com' });

    render(<Navbar />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    const menuToggle = screen.getByRole('button', { name: 'Toggle navigation menu' });
    await user.click(menuToggle);

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: 'Profile' })).toHaveLength(2);
    });

    const profileLinks = screen.getAllByRole('link', { name: 'Profile' });
    await user.click(profileLinks[1]);

    await waitFor(() => {
      expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getAllByRole('link', { name: 'Profile' })).toHaveLength(1);
    });
  });

  it('marks Profile links as current on profile routes', async () => {
    mockPathname.mockReturnValue('/profile');
    mockSessionFetch({ $id: 'user_admin_3', name: 'Admin User', email: 'admin@test.com' });

    render(<Navbar />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
    });
  });

  it('hides Log in links while first-run setup is pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );

    render(<Navbar initialSessionUser={null} initialFirstRunPending />);

    expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
  });

  it('does not render a signed-out Home nav link while waiting for session fetch', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );
    mockPathname.mockReturnValue('/');

    render(<Navbar initialSessionUser={null} />);

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
      />
    );

    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Profile' })).toBeInTheDocument();
  });
});
