// =============================================================================
// DRAFTWIZARD COMPONENT TESTS
// =============================================================================
// Core behaviour: dialog open/close, platform selection, step navigation,
// title validation, save-draft API call, and the discard-changes guard.
// =============================================================================

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DraftWizard } from '@/components/DraftWizard';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const CONNECTED_ACCOUNTS = [
  { platform: 'youtube', platformName: 'My Channel', platformUserId: 'yt-123' },
];

function mockFetch(data: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(data),
  });
}

describe('DraftWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: /api/platforms/connections returns one YouTube account
    global.fetch = mockFetch({ data: CONNECTED_ACCOUNTS });
  });

  it('does not render dialog content when closed', () => {
    render(<DraftWizard isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Create New Draft')).not.toBeInTheDocument();
  });

  it('shows platform selection step when opened', async () => {
    render(<DraftWizard isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('Select Target Platforms')).toBeInTheDocument();
    });
  });

  it('shows YouTube platform card after connected accounts load', async () => {
    render(<DraftWizard isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('My Channel')).toBeInTheDocument();
    });
  });

  it('Next button is disabled when no platform is selected', async () => {
    render(<DraftWizard isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('My Channel')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('advances to step 2 (metadata) after selecting a platform and clicking Next', async () => {
    const user = userEvent.setup();
    render(<DraftWizard isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('My Channel')).toBeInTheDocument());

    // Select the YouTube card
    await user.click(screen.getByText('YouTube'));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('textbox', { name: /title/i })).toBeInTheDocument();
  });

  it('shows title required error when saving on step 2 without a title', async () => {
    const user = userEvent.setup();
    render(<DraftWizard isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('My Channel')).toBeInTheDocument());

    await user.click(screen.getByText('YouTube'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));

    expect(screen.getByText('Title is required')).toBeInTheDocument();
  });

  it('calls POST /api/drafts when saving a draft with a title', async () => {
    const user = userEvent.setup();

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: CONNECTED_ACCOUNTS }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: 'draft-new' } }),
      });

    render(<DraftWizard isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('My Channel')).toBeInTheDocument());

    await user.click(screen.getByText('YouTube'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByRole('textbox', { name: /title/i }), 'My Test Video');
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/drafts',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('shows discard confirmation dialog when closing with unsaved changes', async () => {
    const user = userEvent.setup();
    render(<DraftWizard isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('My Channel')).toBeInTheDocument());

    // Selecting a platform marks state as dirty
    await user.click(screen.getByText('YouTube'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('Discard Changes?')).toBeInTheDocument();
  });
});
