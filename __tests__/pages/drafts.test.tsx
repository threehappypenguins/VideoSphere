// =============================================================================
// DRAFTS PAGE COMPONENT TESTS
// =============================================================================
// Basic UI rendering tests for the Drafts page: verify header, empty state,
// and primary CTA link render correctly.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock Next.js Link component for testing environment
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock Next.js navigation hooks
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
}));

// Mock DraftWizard and its hook — the wizard is tested separately
vi.mock('@/components/DraftWizard', () => ({ DraftWizard: () => null }));
vi.mock('@/hooks/use-draft-wizard', () => ({
  useDraftWizard: () => ({ isOpen: false, openWizard: vi.fn(), closeWizard: vi.fn() }),
}));

import DraftsPage from '@/app/(dashboard)/dashboard/drafts/page';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DraftsPage', () => {
  it('renders the Drafts page heading', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ canUseAiMetadata: true }),
      } as Response);

    render(<DraftsPage />);

    expect(screen.getByRole('heading', { level: 1, name: /drafts/i })).toBeInTheDocument();
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/drafts', expect.any(Object))
    );
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/platforms/connections', expect.any(Object))
    );
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/ai-access', expect.any(Object))
    );
  });

  it('renders the empty state message when there are no drafts', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ canUseAiMetadata: true }),
      } as Response);

    render(<DraftsPage />);

    expect(await screen.findByText(/no drafts yet/i)).toBeInTheDocument();
    expect(await screen.findByText(/create a draft to get started/i)).toBeInTheDocument();
  });

  it('renders a Create draft button that opens the wizard', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ canUseAiMetadata: true }),
      } as Response);

    render(<DraftsPage />);

    expect(screen.getByRole('button', { name: /create draft/i })).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
  });
});
