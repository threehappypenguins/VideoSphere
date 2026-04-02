import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
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
  toast: {
    error: toastErrorMock,
  },
}));

import { DashboardQuickActions } from '@/components/dashboard/DashboardQuickActions';

describe('DashboardQuickActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a minimal draft and routes to Drafts create mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            id: 'draft-new-123',
          },
        }),
      } as Response)
    );

    render(<DashboardQuickActions />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /new draft/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minimal: true }),
      });
    });

    expect(pushMock).toHaveBeenCalledWith('/dashboard/drafts?createDraftId=draft-new-123');
  });

  it('shows an error toast when draft creation fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Failed to create draft' }),
      } as Response)
    );

    render(<DashboardQuickActions />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /new draft/i }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Failed to create draft');
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('re-enables the button if navigation throws after draft creation succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            id: 'draft-new-456',
          },
        }),
      } as Response)
    );
    pushMock.mockImplementationOnce(() => {
      throw new Error('Navigation blocked');
    });

    render(<DashboardQuickActions />);

    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: /new draft/i });
    await user.click(button);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Navigation blocked');
    });
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent('New draft');
  });
});
