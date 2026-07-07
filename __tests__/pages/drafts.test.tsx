// =============================================================================
// DRAFTS PAGE COMPONENT TESTS
// =============================================================================
// Basic UI rendering tests for the Drafts page: verify header, empty state,
// and primary CTA link render correctly. Initial load uses four GETs (drafts,
// connections, ai-access, labels); edit-from-query also GETs /api/drafts/:id after openEditDraft.
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
  usePathname: () => '/dashboard/uploads',
}));

vi.mock('@/components/drafts/DraftMetadataModal', () => ({
  DraftMetadataModal: ({ mode, value, onClose }: any) => {
    if (!value) return null;
    return (
      <div data-testid={`${mode}-modal-open`}>
        <div data-testid={`${mode}-modal-targets`}>{value.targets.join(',')}</div>
        <button type="button" aria-label={`close-${mode}`} onClick={onClose}>
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

import UploadsPage from '@/app/(dashboard)/dashboard/uploads/page';

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

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

function labelsJsonResponse(labels: unknown[] = []): Response {
  return jsonResponse({ data: labels });
}

function youtubeConnectionPayload() {
  return {
    id: 'conn-yt',
    userId: 'user-1',
    platform: 'youtube',
    tokenExpiry: new Date(Date.now() + 3_600_000).toISOString(),
    hasRefreshToken: true,
    hasYoutubeMainStreamKey: false,
    hasYoutubeTempStreamKey: false,
    platformUserId: 'yt-1',
    platformName: 'Channel',
    connectionStatus: 'connected',
    $createdAt: '2000-01-01T00:00:00.000Z',
    $updatedAt: '2000-01-02T00:00:00.000Z',
  };
}

/** Mocks the four parallel GETs issued by loadDrafts (call order matters). */
function mockInitialPageLoadFetch(options?: {
  drafts?: unknown[];
  connections?: unknown;
  canUseAiMetadata?: boolean;
  labels?: unknown[];
}) {
  return vi
    .spyOn(global, 'fetch')
    .mockResolvedValueOnce(jsonResponse({ data: options?.drafts ?? [] }))
    .mockResolvedValueOnce(
      jsonResponse({
        data: options?.connections ?? [youtubeConnectionPayload()],
      })
    )
    .mockResolvedValueOnce(jsonResponse({ canUseAiMetadata: options?.canUseAiMetadata ?? true }))
    .mockResolvedValueOnce(labelsJsonResponse(options?.labels ?? []));
}

/** Route-aware fetch mock for editDraft query tests (survives remount / repeated loadDrafts). */
function mockEditDraftQueryFetch() {
  const draftListItem = {
    id: 'draft-1',
    title: 'Test Draft',
    description: '',
    tags: [],
    visibility: 'public',
    targets: ['youtube'],
    $updatedAt: new Date().toISOString(),
  };

  return vi.spyOn(global, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/api/drafts/draft-1')) {
      return Promise.resolve(jsonResponse(draft1DetailPayload()));
    }
    if (url.includes('/api/drafts/labels')) {
      return Promise.resolve(labelsJsonResponse());
    }
    if (url.includes('/api/drafts')) {
      return Promise.resolve(jsonResponse({ data: [draftListItem] }));
    }
    if (url.includes('/api/platforms/connections')) {
      return Promise.resolve(jsonResponse({ data: [youtubeConnectionPayload()] }));
    }
    if (url.includes('/api/auth/ai-access')) {
      return Promise.resolve(jsonResponse({ canUseAiMetadata: true }));
    }

    return Promise.reject(new Error(`Unexpected fetch in editDraft test: ${url}`));
  });
}

describe('UploadsPage', () => {
  it('renders the Uploads page heading', async () => {
    mockInitialPageLoadFetch();

    render(<UploadsPage />);

    expect(screen.getByRole('heading', { level: 1, name: /uploads/i })).toBeInTheDocument();
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/drafts', expect.any(Object))
    );
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/platforms/connections', expect.any(Object))
    );
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/ai-access', expect.any(Object))
    );
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/drafts/labels', expect.any(Object))
    );
  });

  it('renders the empty state message when there are no drafts', async () => {
    mockInitialPageLoadFetch();

    render(<UploadsPage />);

    expect(await screen.findByText(/no drafts yet/i)).toBeInTheDocument();
    expect(await screen.findByText(/create a draft to get started/i)).toBeInTheDocument();
  });

  it('renders a Create draft button', async () => {
    mockInitialPageLoadFetch();

    render(<UploadsPage />);

    expect(screen.getByRole('button', { name: /create draft/i })).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));
  });

  it('opens create modal from createDraftId query param', async () => {
    mockSearchParams = new URLSearchParams('createDraftId=draft-from-dashboard');

    mockInitialPageLoadFetch().mockResolvedValueOnce(
      jsonResponse({
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
      })
    );

    render(<UploadsPage />);

    expect(await screen.findByTestId('create-modal-open')).toBeInTheDocument();
    expect(mockRouterReplace).toHaveBeenCalledWith('/dashboard/uploads');
  });

  it('does not delete a non-minimal existing draft opened via createDraftId and preserves targets', async () => {
    mockSearchParams = new URLSearchParams('createDraftId=existing-draft');

    const fetchSpy = mockInitialPageLoadFetch({
      connections: [{ platform: 'vimeo' }],
    }).mockResolvedValueOnce(
      jsonResponse({
        data: {
          id: 'existing-draft',
          userId: 'user-1',
          title: 'Already saved',
          description: '',
          tags: [],
          visibility: 'private',
          targets: ['youtube'],
          platforms: {},
          $createdAt: '2000-01-01T00:00:00.000Z',
          $updatedAt: '2000-01-01T00:00:00.000Z',
        },
      })
    );

    render(<UploadsPage />);

    expect(await screen.findByTestId('create-modal-open')).toBeInTheDocument();
    expect(screen.getByTestId('create-modal-targets')).toHaveTextContent('youtube');

    fireEvent.click(screen.getByRole('button', { name: 'close-create' }));

    await waitFor(() => {
      expect(screen.queryByTestId('create-modal-open')).not.toBeInTheDocument();
    });
    expect(fetchSpy).not.toHaveBeenCalledWith('/api/drafts/existing-draft', { method: 'DELETE' });
  });

  it('opens edit modal from editDraft query param', async () => {
    mockSearchParams = new URLSearchParams('editDraft=draft-1');

    mockEditDraftQueryFetch();

    render(<UploadsPage />);

    expect(await screen.findByTestId('edit-modal-open')).toBeInTheDocument();
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/drafts/draft-1', expect.any(Object))
    );
  });

  it('clears editDraft query param when edit modal closes', async () => {
    mockSearchParams = new URLSearchParams('editDraft=draft-1');

    mockEditDraftQueryFetch();

    render(<UploadsPage />);

    expect(await screen.findByTestId('edit-modal-open')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'close-edit' }));

    expect(mockRouterReplace).toHaveBeenCalledWith('/dashboard/uploads');
  });
});
