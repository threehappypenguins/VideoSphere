// =============================================================================
// DASHBOARD PAGE COMPONENT TESTS
// =============================================================================
// Tests for the dashboard page UI, stat cards, quick actions, and sections.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { mockCookiesGet, mockAccountGet, mockListDraftsByUser, mockListUploadJobsByUser } =
  vi.hoisted(() => ({
    mockCookiesGet: vi.fn(),
    mockAccountGet: vi.fn(),
    mockListDraftsByUser: vi.fn(),
    mockListUploadJobsByUser: vi.fn(),
  }));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: mockCookiesGet })),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock('node-appwrite', () => {
  const mockClient = {
    setEndpoint: vi.fn(function () {
      return this;
    }),
    setProject: vi.fn(function () {
      return this;
    }),
    setSession: vi.fn(function () {
      return this;
    }),
  };

  function MockClient() {
    return mockClient;
  }

  function MockAccount() {
    this.get = mockAccountGet;
  }

  return { Client: MockClient, Account: MockAccount };
});

vi.mock('@/lib/repositories/drafts', () => ({
  listDraftsByUser: (...args: unknown[]) => mockListDraftsByUser(...args),
}));

vi.mock('@/lib/repositories/upload-jobs', () => ({
  listUploadJobsByUser: (...args: unknown[]) => mockListUploadJobsByUser(...args),
}));

import DashboardPage from '@/app/(dashboard)/dashboard/page';

describe('DashboardPage Component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';
    mockCookiesGet.mockReturnValue({ value: 'valid-session-token' });
    mockAccountGet.mockResolvedValue({ $id: 'user-123' });
    mockListDraftsByUser.mockResolvedValue([]);
    mockListUploadJobsByUser.mockResolvedValue([]);
  });

  describe('Page Header', () => {
    it('should render the dashboard title and subtitle', async () => {
      render(await DashboardPage());

      expect(screen.getByRole('heading', { level: 1, name: /dashboard/i })).toBeInTheDocument();
    });
  });

  describe('Stat Cards', () => {
    it('should render real draft and upload job metrics', async () => {
      mockListDraftsByUser.mockResolvedValue([
        {
          id: 'draft-1',
          userId: 'user-123',
          title: 'Unused draft',
          description: '',
          tags: [],
          visibility: 'private',
          targets: ['youtube'],
          platforms: {},
          $createdAt: '2026-04-01T10:00:00.000Z',
          $updatedAt: '2026-04-02T10:00:00.000Z',
        },
        {
          id: 'draft-2',
          userId: 'user-123',
          title: 'Used draft',
          description: '',
          tags: [],
          visibility: 'private',
          targets: ['vimeo'],
          platforms: {},
          usedInUploadAt: '2026-04-02T12:00:00.000Z',
          $createdAt: '2026-04-01T11:00:00.000Z',
          $updatedAt: '2026-04-02T11:00:00.000Z',
        },
      ]);
      mockListUploadJobsByUser.mockResolvedValue([
        {
          id: 'job-1',
          userId: 'user-123',
          draftId: 'draft-2',
          r2Key: 'videos/job-1.mp4',
          status: 'pending',
          errorMessage: null,
          quotaClaimMonth: '2026-04',
          $createdAt: '2026-04-02T12:00:00.000Z',
          $updatedAt: '2026-04-02T12:00:00.000Z',
        },
        {
          id: 'job-2',
          userId: 'user-123',
          draftId: 'draft-2',
          r2Key: 'videos/job-2.mp4',
          status: 'distributing',
          errorMessage: null,
          quotaClaimMonth: '2026-04',
          $createdAt: '2026-04-02T13:00:00.000Z',
          $updatedAt: '2026-04-02T13:05:00.000Z',
        },
        {
          id: 'job-3',
          userId: 'user-123',
          draftId: 'draft-2',
          r2Key: 'videos/job-3.mp4',
          status: 'completed',
          errorMessage: null,
          quotaClaimMonth: '2026-04',
          $createdAt: '2026-04-02T14:00:00.000Z',
          $updatedAt: '2026-04-02T14:05:00.000Z',
        },
        {
          id: 'job-4',
          userId: 'user-123',
          draftId: 'draft-2',
          r2Key: 'videos/job-4.mp4',
          status: 'failed',
          errorMessage: 'Upload failed',
          quotaClaimMonth: '2026-04',
          $createdAt: '2026-04-02T15:00:00.000Z',
          $updatedAt: '2026-04-02T15:05:00.000Z',
        },
        {
          id: 'job-5',
          userId: 'user-123',
          draftId: 'draft-2',
          r2Key: 'videos/job-5.mp4',
          status: 'cancelled',
          errorMessage: null,
          quotaClaimMonth: '2026-04',
          $createdAt: '2026-04-02T16:00:00.000Z',
          $updatedAt: '2026-04-02T16:05:00.000Z',
        },
      ]);

      render(await DashboardPage());

      expect(screen.getByText(/^drafts$/i)).toBeInTheDocument();
      expect(screen.getByText(/^ready to upload$/i)).toBeInTheDocument();
      expect(screen.getByText(/^in progress$/i)).toBeInTheDocument();
      expect(screen.getByText(/^completed uploads$/i)).toBeInTheDocument();
      expect(screen.getByText(/^failed uploads$/i)).toBeInTheDocument();
      expect(screen.getAllByText(/^2$/)).toHaveLength(2);
      expect(screen.getAllByText(/^1$/)).toHaveLength(3);
    });
  });

  describe('Quick Actions Section', () => {
    it('should render the quick actions heading', async () => {
      render(await DashboardPage());

      expect(screen.getByRole('heading', { level: 2, name: /quick actions/i })).toBeInTheDocument();
    });

    it('should render action links with correct text', async () => {
      render(await DashboardPage());

      expect(screen.getByRole('button', { name: /new draft/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /view drafts/i })).toBeInTheDocument();
    });

    it('should render "New draft" as an action button', async () => {
      render(await DashboardPage());

      expect(screen.getByRole('button', { name: /new draft/i })).toBeInTheDocument();
    });

    it('should link "View drafts" to /dashboard/drafts', async () => {
      render(await DashboardPage());

      const viewDraftsLink = screen.getByRole('link', { name: /view drafts/i });
      expect(viewDraftsLink).toHaveAttribute('href', '/dashboard/drafts');
    });
  });

  describe('Ready Drafts Section', () => {
    it('should render the ready drafts heading', async () => {
      render(await DashboardPage());

      expect(
        screen.getByRole('heading', { level: 2, name: /drafts ready to upload/i })
      ).toBeInTheDocument();
    });

    it('should render table with correct column headers', async () => {
      render(await DashboardPage());

      expect(screen.getByRole('columnheader', { name: /^draft$/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /^targets$/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /^last edited$/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /^next step$/i })).toBeInTheDocument();
    });

    it('should display empty state message when there are no unused drafts', async () => {
      render(await DashboardPage());

      expect(screen.getByText(/no drafts ready yet/i)).toBeInTheDocument();
      expect(screen.getByText(/create a draft to start your next upload/i)).toBeInTheDocument();
    });

    it('should list drafts that have not been used in uploads yet', async () => {
      mockListDraftsByUser.mockResolvedValue([
        {
          id: 'draft-ready',
          userId: 'user-123',
          title: 'Ready draft',
          description: '',
          tags: [],
          visibility: 'private',
          targets: ['youtube', 'vimeo'],
          platforms: {},
          $createdAt: '2026-04-01T10:00:00.000Z',
          $updatedAt: '2026-04-02T10:00:00.000Z',
        },
        {
          id: 'draft-used',
          userId: 'user-123',
          title: 'Already uploaded draft',
          description: '',
          tags: [],
          visibility: 'private',
          targets: ['youtube'],
          platforms: {},
          usedInUploadAt: '2026-04-02T12:00:00.000Z',
          $createdAt: '2026-04-01T11:00:00.000Z',
          $updatedAt: '2026-04-02T11:00:00.000Z',
        },
      ]);

      render(await DashboardPage());

      expect(screen.getByText('Ready draft')).toBeInTheDocument();
      expect(screen.getByText('YouTube, Vimeo')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /open draft/i })).toHaveAttribute(
        'href',
        '/dashboard/drafts/draft-ready'
      );
      expect(screen.queryByText('Already uploaded draft')).not.toBeInTheDocument();
    });
  });
});
