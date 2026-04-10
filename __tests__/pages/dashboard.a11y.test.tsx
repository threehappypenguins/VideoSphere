import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardPage from '@/app/(dashboard)/dashboard/page';
import { expectNoAxeViolations } from '@/__tests__/utils/a11y';

const {
  mockCookiesGet,
  mockAccountGet,
  mockCountDraftsByUser,
  mockGetDraftDashboardSummaryByUser,
  mockCountUploadJobsByUserWithStatuses,
} = vi.hoisted(() => ({
  mockCookiesGet: vi.fn(),
  mockAccountGet: vi.fn(),
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

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
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
  countDraftsByUser: (...args: unknown[]) => mockCountDraftsByUser(...args),
  getDraftDashboardSummaryByUser: (...args: unknown[]) =>
    mockGetDraftDashboardSummaryByUser(...args),
}));

vi.mock('@/lib/repositories/upload-jobs', () => ({
  countUploadJobsByUserWithStatuses: (...args: unknown[]) =>
    mockCountUploadJobsByUserWithStatuses(...args),
}));

describe('Dashboard accessibility', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';
    mockCookiesGet.mockReturnValue({ value: 'valid-session-token' });
    mockAccountGet.mockResolvedValue({ $id: 'user-123' });
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
          targets: ['youtube'],
          platforms: {},
          $createdAt: '2026-04-01T10:00:00.000Z',
          $updatedAt: '2026-04-02T10:00:00.000Z',
        },
      ],
    });
    mockCountUploadJobsByUserWithStatuses
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
  });

  it('renders accessible dashboard table and live status messaging without axe violations', async () => {
    const { baseElement } = render(<main>{await DashboardPage()}</main>);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open draft/i })).toHaveAttribute(
      'href',
      '/dashboard/drafts/draft-ready'
    );

    await expectNoAxeViolations(baseElement);
  });
});
