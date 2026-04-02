// =============================================================================
// DRAFTS PAGE COMPONENT TESTS
// =============================================================================
// Basic UI rendering tests for the Drafts page: verify header, empty state,
// and primary CTA link render correctly. Initial load uses three GETs (drafts,
// connections, ai-access); edit-from-query also GETs /api/drafts/:id after openEditDraft.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Mock Next.js Link component for testing environment
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let mockSearchParams = new URLSearchParams();
const mockRouterReplace = vi.fn();

// Mock Next.js navigation hooks
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: vi.fn(), replace: mockRouterReplace }),
  usePathname: () => '/dashboard/drafts',
}));

vi.mock('@/components/drafts/DraftMetadataModal', () => ({
  DraftMetadataModal: ({ mode, value, onClose }: any) => {
    if (!value) return null;
    return (
      <div data-testid={`${mode}-modal-open`}>
        <button type="button" onClick={onClose}>
          close-{mode}
        </button>
      </div>
    );
  },
}));

vi.mock('@/components/onboarding/OnboardingContext', () => ({
  useOnboardingContext: () => ({
    onboardingDraftId: null,
    setOnboardingDraftId: vi.fn(),
    cleanupOnboardingDraft: vi.fn().mockResolvedValue(undefined),
  }),
}));

import DraftsPage from '@/app/(dashboard)/dashboard/drafts/page';

afterEach(() => {
  vi.restoreAllMocks();
  mockSearchParams = new URLSearchParams();
  mockRouterReplace.mockReset();
});

/** Full draft body returned by GET /api/drafts/:id (used when openEditDraft refetches). */
function draft1DetailPayload() {
  return {
    data: {
      id: 'draft-1',
      userId: 'user-1',
      title: 'Test Draft',
      description: '',
      tags: [],
      visibility: 'public' as const,
      targets: ['youtube'],
      platforms: {},
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-02T00:00:00.000Z',
    },
  };
}

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

  it('renders a Create draft button', async () => {
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

  it('opens create modal from openCreateDraft query param', async () => {
    mockSearchParams = new URLSearchParams('openCreateDraft=true');

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
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: 'draft-from-minimal',
            userId: 'user-1',
            title: '',
            description: '',
            tags: [],
            visibility: 'private',
            targets: [],
            platforms: {},
            $createdAt: '2000-01-01T00:00:00.000Z',
            $updatedAt: '2000-01-01T00:00:00.000Z',
          },
        }),
      } as Response);

    render(<DraftsPage />);

    expect(await screen.findByTestId('create-modal-open')).toBeInTheDocument();
  });

  it('opens create modal from createDraftId query param', async () => {
    mockSearchParams = new URLSearchParams('createDraftId=draft-from-dashboard');

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
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: 'draft-from-dashboard',
            userId: 'user-1',
            title: '',
            description: '',
            tags: [],
            visibility: 'private',
            targets: [],
            platforms: {},
            $createdAt: '2000-01-01T00:00:00.000Z',
            $updatedAt: '2000-01-01T00:00:00.000Z',
          },
        }),
      } as Response);

    render(<DraftsPage />);

    expect(await screen.findByTestId('create-modal-open')).toBeInTheDocument();
    expect(mockRouterReplace).toHaveBeenCalledWith('/dashboard/drafts');
  });

  it('opens edit modal from editDraft query param', async () => {
    mockSearchParams = new URLSearchParams('editDraft=draft-1');

    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'draft-1',
              title: 'Test Draft',
              description: '',
              tags: [],
              visibility: 'public',
              targets: ['youtube'],
              $updatedAt: new Date().toISOString(),
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: ['youtube'] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ canUseAiMetadata: true }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => draft1DetailPayload(),
      } as Response);

    render(<DraftsPage />);

    expect(await screen.findByTestId('edit-modal-open')).toBeInTheDocument();
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/drafts/draft-1', expect.any(Object))
    );
  });

  it('clears editDraft query param when edit modal closes', async () => {
    mockSearchParams = new URLSearchParams('editDraft=draft-1');

    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'draft-1',
              title: 'Test Draft',
              description: '',
              tags: [],
              visibility: 'public',
              targets: ['youtube'],
              $updatedAt: new Date().toISOString(),
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: ['youtube'] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ canUseAiMetadata: true }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => draft1DetailPayload(),
      } as Response);

    render(<DraftsPage />);

    const closeButton = await screen.findByRole('button', { name: 'close-edit' });
    fireEvent.click(closeButton);

    expect(mockRouterReplace).toHaveBeenCalledWith('/dashboard/drafts');
  });
});
