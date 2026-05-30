// =============================================================================
// DASHBOARD PAGE COMPONENT TESTS
// =============================================================================
// Tests for the dashboard page UI, stat cards, quick actions, and sections.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const {
  mockCookiesGet,
  mockGetCurrentUserIdFromCookies,
  mockCountDraftsByUser,
  mockGetDraftDashboardSummaryByUser,
  mockCountUploadJobsByUserWithStatuses,
} = vi.hoisted(() => ({
  mockCookiesGet: vi.fn(),
  mockGetCurrentUserIdFromCookies: vi.fn(),
  mockCountDraftsByUser: vi.fn(),
  mockGetDraftDashboardSummaryByUser: vi.fn(),
  mockCountUploadJobsByUserWithStatuses: vi.fn(),
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

vi.mock('@/lib/auth/get-current-user-id-from-cookies', () => ({
  getCurrentUserIdFromCookies: (...args: unknown[]) => mockGetCurrentUserIdFromCookies(...args),
}));

vi.mock('@/lib/repositories/drafts', () => ({
  countDraftsByUser: (...args: unknown[]) => mockCountDraftsByUser(...args),
  getDraftDashboardSummaryByUser: (...args: unknown[]) =>
    mockGetDraftDashboardSummaryByUser(...args),
}));

vi.mock('@/lib/repositories/upload-jobs', () => ({
  countUploadJobsByUserWithStatuses: (...args: unknown[]) =>
    mockCountUploadJobsByUserWithStatuses(...args),
}));

import DashboardPage from '@/app/(dashboard)/dashboard/page';

describe('DashboardPage Component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';
    mockCookiesGet.mockReturnValue({ value: 'valid-session-token' });
    mockGetCurrentUserIdFromCookies.mockResolvedValue('user-123');
    mockCountDraftsByUser.mockResolvedValue(0);
    mockGetDraftDashboardSummaryByUser.mockResolvedValue({ readyDraftCount: 0, previewDrafts: [] });
    mockCountUploadJobsByUserWithStatuses.mockResolvedValue(0);
  });

  describe('Page Header', () => {
    it('should render the dashboard title and subtitle', async () => {
      render(await DashboardPage());

      expect(screen.getByRole('heading', { level: 1, name: /dashboard/i })).toBeInTheDocument();
    });
  });

  describe('Stat Cards', () => {
    it('should render real draft and upload job metrics', async () => {
      mockCountDraftsByUser.mockResolvedValue(2);
      mockGetDraftDashboardSummaryByUser.mockResolvedValue({
        readyDraftCount: 1,
        previewDrafts: [
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
        ],
      });
      mockCountUploadJobsByUserWithStatuses
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1);

      render(await DashboardPage());

      expect(screen.getByText(/^drafts$/i)).toBeInTheDocument();
      expect(screen.getByText(/^ready to upload$/i)).toBeInTheDocument();
      expect(screen.getByText(/^in progress$/i)).toBeInTheDocument();
      expect(screen.getByText(/^completed uploads$/i)).toBeInTheDocument();
      expect(screen.getByText(/^failed uploads$/i)).toBeInTheDocument();
      expect(screen.getAllByText(/^2$/)).toHaveLength(2);
      expect(screen.getAllByText(/^1$/)).toHaveLength(3);
      expect(mockCountDraftsByUser).toHaveBeenCalledWith('user-123');
      expect(mockGetDraftDashboardSummaryByUser).toHaveBeenCalledWith('user-123');
      expect(mockCountUploadJobsByUserWithStatuses).toHaveBeenNthCalledWith(1, 'user-123', [
        'pending',
        'uploading',
        'distributing',
      ]);
      expect(mockCountUploadJobsByUserWithStatuses).toHaveBeenNthCalledWith(
        2,
        'user-123',
        'completed'
      );
      expect(mockCountUploadJobsByUserWithStatuses).toHaveBeenNthCalledWith(
        3,
        'user-123',
        'failed'
      );
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
      mockCountDraftsByUser.mockResolvedValue(2);
      mockGetDraftDashboardSummaryByUser.mockResolvedValue({
        readyDraftCount: 1,
        previewDrafts: [
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
        ],
      });

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
