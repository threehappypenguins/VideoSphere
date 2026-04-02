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

  it('shows Admin links for admin users', async () => {
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
      const adminLink = screen.getByRole('link', { name: 'Admin' });
      expect(adminLink).toHaveAttribute('href', '/admin/dashboard');
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

  it('does not show Admin links for non-admin users', async () => {
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

    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('shows Admin in mobile menu and closes menu on click', async () => {
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
      expect(screen.getAllByRole('link', { name: 'Admin' })).toHaveLength(2);
    });

    const adminLinks = screen.getAllByRole('link', { name: 'Admin' });
    await user.click(adminLinks[1]);

    await waitFor(() => {
      expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getAllByRole('link', { name: 'Admin' })).toHaveLength(1);
    });
  });
});
