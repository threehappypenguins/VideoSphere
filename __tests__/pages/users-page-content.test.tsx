import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsersPageContent } from '@/app/(dashboard)/dashboard/users/UsersPageContent';

const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/admin/UsersListSection', () => ({
  UsersListSection: () => <div>Users list section</div>,
}));

vi.mock('@/components/admin/InvitesSection', () => ({
  InvitesSection: () => <div>Invites section</div>,
}));

describe('UsersPageContent session handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redirects to login when the session endpoint returns 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({}),
      } as Response)
    );

    render(<UsersPageContent />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login?redirect=%2Fdashboard%2Fusers');
    });
  });

  it('shows a retryable error when the session fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    render(<UsersPageContent />);

    expect(await screen.findByText(/unable to load users page/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?redirect=%2Fdashboard%2Fusers'
    );
  });

  it('renders the admin sections when session loads successfully', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ $id: 'admin-user-1' }),
      } as Response)
    );

    render(<UsersPageContent />);

    expect(await screen.findByText('Users list section')).toBeInTheDocument();
    expect(screen.getByText('Invites section')).toBeInTheDocument();
  });

  it('retries loading the session from the error state', async () => {
    let shouldFail = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (shouldFail) {
          throw new Error('network down');
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ $id: 'admin-user-1' }),
        } as Response;
      })
    );

    render(<UsersPageContent />);

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();

    shouldFail = false;
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(screen.getByText('Users list section')).toBeInTheDocument();
    });
  });
});
