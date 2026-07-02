// =============================================================================
// DASHBOARD SHELL COMPONENT TESTS
// =============================================================================
// Tests for the responsive dashboard shell (sidebar + mobile drawer).
// Verifies all nav links are present, active states are correct, and
// the isActive helper function works as expected.
// =============================================================================

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import DashboardShell from '@/components/dashboard/DashboardShell';
import { DashboardNavProvider } from '@/components/dashboard/DashboardNavProvider';
import Navbar from '@/components/layout/Navbar';

// Mock next/navigation for usePathname hook
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock next/link to avoid routing complexity in tests
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
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

// Mock Sonner Toaster to avoid window.matchMedia dependency in tests
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));

import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Uploads', href: '/dashboard/uploads' },
  { label: 'History', href: '/dashboard/uploads/history' },
  { label: 'Livestreams', href: '/dashboard/livestreams' },
  { label: 'History', href: '/dashboard/livestreams/history' },
] as const;

function mockSessionFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ $id: 'user-1', name: 'Test User', email: 'test@example.com' }),
    } as Response)
  );
}

function renderDashboardLayout(children: React.ReactNode, { isAdmin = false } = {}) {
  return render(
    <DashboardNavProvider isAdmin={isAdmin}>
      <Navbar initialSessionUser={{ $id: 'user-1', name: 'Test User' }} />
      <DashboardShell isAdmin={isAdmin}>{children}</DashboardShell>
    </DashboardNavProvider>
  );
}

function openMobileDrawer() {
  fireEvent.click(screen.getByRole('button', { name: 'Open dashboard sections' }));
}

describe('DashboardShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Navigation Items Rendering', () => {
    it('should render top-level navigation links on desktop', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      renderDashboardLayout(<div>Test Content</div>);

      expect(screen.getAllByRole('link', { name: 'Dashboard' }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole('link', { name: 'Uploads' }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole('link', { name: 'Livestreams' }).length).toBeGreaterThan(0);
    });

    it('should hide nested History links in the mobile drawer until expanded', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      renderDashboardLayout(<div>Test Content</div>);

      openMobileDrawer();

      const drawer = screen.getByRole('dialog');
      expect(within(drawer).queryByRole('link', { name: 'History' })).not.toBeInTheDocument();

      fireEvent.click(within(drawer).getByRole('button', { name: 'Show Uploads submenu' }));
      expect(
        within(drawer)
          .getAllByRole('link', { name: 'History' })
          .some((link) => link.getAttribute('href') === '/dashboard/uploads/history')
      ).toBe(true);
    });

    it('should have correct href attributes for all nav items when the mobile drawer is expanded', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      renderDashboardLayout(<div>Test Content</div>);

      openMobileDrawer();
      const drawer = screen.getByRole('dialog');

      fireEvent.click(within(drawer).getByRole('button', { name: 'Show Uploads submenu' }));
      fireEvent.click(within(drawer).getByRole('button', { name: 'Show Livestreams submenu' }));

      NAV_ITEMS.forEach(({ label, href }) => {
        const links = within(drawer).getAllByRole('link', { name: label });
        expect(links.some((link) => link.getAttribute('href') === href)).toBe(true);
      });
    });

    it('should render children content', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      renderDashboardLayout(<div data-testid="page-content">Dashboard Page Content</div>);

      expect(screen.getByTestId('page-content')).toBeInTheDocument();
      expect(screen.getByText('Dashboard Page Content')).toBeInTheDocument();
    });

    it('should not render a mobile sections bar above page content', () => {
      (usePathname as any).mockReturnValue('/dashboard/uploads');

      renderDashboardLayout(<div>Test Content</div>);

      expect(screen.queryByText('Uploads · History')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Sections' })).not.toBeInTheDocument();
    });
  });

  describe('Active Link Highlighting', () => {
    it('should mark Dashboard as active when pathname is exactly /dashboard', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      renderDashboardLayout(<div>Test</div>);

      const dashboardLinks = screen.getAllByText('Dashboard');
      const activeLink = dashboardLinks.find((el) => {
        const link = el.closest('a');
        return link && link.getAttribute('aria-current') === 'page';
      });

      expect(activeLink).toBeDefined();
    });

    it('should NOT mark Dashboard sidebar link as active when pathname is /dashboard/uploads', () => {
      (usePathname as any).mockReturnValue('/dashboard/uploads');

      renderDashboardLayout(<div>Test</div>);

      const sidebarNav = screen.getAllByLabelText('Dashboard navigation')[0]!;
      const dashboardSidebarLinks = within(sidebarNav).getAllByRole('link', { name: 'Dashboard' });
      const activeSidebarLink = dashboardSidebarLinks.find(
        (link) => link.getAttribute('aria-current') === 'page'
      );

      expect(activeSidebarLink).toBeUndefined();
    });

    it('should mark Uploads as active when pathname is /dashboard/uploads', () => {
      (usePathname as any).mockReturnValue('/dashboard/uploads');

      renderDashboardLayout(<div>Test</div>);

      const uploadsLinks = screen.getAllByText('Uploads');
      const activeLink = uploadsLinks.find((el) => {
        const link = el.closest('a');
        return link && link.getAttribute('aria-current') === 'page';
      });

      expect(activeLink).toBeDefined();
    });

    it('should mark Uploads as active when pathname is /dashboard/uploads/[id]/upload', () => {
      (usePathname as any).mockReturnValue('/dashboard/uploads/video-123/upload');

      renderDashboardLayout(<div>Test</div>);

      const uploadsLinks = screen.getAllByText('Uploads');
      const activeLink = uploadsLinks.find((el) => {
        const link = el.closest('a');
        return link && link.getAttribute('aria-current') === 'page';
      });

      expect(activeLink).toBeDefined();
    });

    it('should auto-expand the parent section when a nested history route is active', () => {
      (usePathname as any).mockReturnValue('/dashboard/uploads/history');

      renderDashboardLayout(<div>Test</div>);

      openMobileDrawer();
      const drawer = screen.getByRole('dialog');
      const historyLinks = within(drawer).getAllByRole('link', { name: 'History' });
      expect(
        historyLinks.some(
          (link) =>
            link.getAttribute('href') === '/dashboard/uploads/history' &&
            link.getAttribute('aria-current') === 'page'
        )
      ).toBe(true);
    });

    it('should only mark Uploads sidebar links as active for /dashboard/uploads', () => {
      (usePathname as any).mockReturnValue('/dashboard/uploads');

      renderDashboardLayout(<div>Test</div>);

      const sidebarNav = screen.getAllByLabelText('Dashboard navigation')[0]!;
      const activeSidebarLinks = within(sidebarNav)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page');

      expect(activeSidebarLinks.length).toBeGreaterThan(0);
      activeSidebarLinks.forEach((link) => {
        expect(link).toHaveTextContent('Uploads');
      });
    });
  });

  describe('Responsive Layout Structure', () => {
    it('should render the dashboard drawer trigger on profile routes', () => {
      (usePathname as any).mockReturnValue('/profile/connections');

      renderDashboardLayout(<div>Test</div>);

      expect(screen.getByRole('button', { name: 'Open dashboard sections' })).toBeInTheDocument();
    });

    it('should render the dashboard drawer trigger in the navbar on mobile routes', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      renderDashboardLayout(<div>Test</div>);

      expect(screen.getByRole('button', { name: 'Open dashboard sections' })).toBeInTheDocument();
      expect(screen.getAllByLabelText('Dashboard navigation').length).toBeGreaterThanOrEqual(1);
    });

    it('should render desktop sidebar navigation', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      renderDashboardLayout(<div>Test</div>);

      expect(screen.getAllByLabelText('Dashboard navigation').length).toBeGreaterThanOrEqual(1);
    });

    it('should render child content inside the layout shell', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      renderDashboardLayout(<div data-testid="dashboard-content">Test</div>);

      expect(screen.getByTestId('dashboard-content')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should not match unrelated routes', () => {
      (usePathname as any).mockReturnValue('/profile');

      render(
        <DashboardNavProvider>
          <DashboardShell>
            <div>Test</div>
          </DashboardShell>
        </DashboardNavProvider>
      );

      const allLinks = screen.getAllByRole('link');
      const activeLinks = allLinks.filter((link) => link.getAttribute('aria-current') === 'page');

      expect(activeLinks.length).toBe(0);
    });

    it('should handle root dashboard route correctly', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      renderDashboardLayout(<div>Test</div>);

      const allLinks = screen.getAllByRole('link');
      const activeLinks = allLinks.filter((link) => link.getAttribute('aria-current') === 'page');

      expect(activeLinks.length).toBeGreaterThan(0);
      activeLinks.forEach((link) => {
        expect(link).toHaveTextContent('Dashboard');
      });
    });

    it('shows Users nav link for admin users', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      renderDashboardLayout(<div>Test</div>, { isAdmin: true });

      expect(screen.getAllByRole('link', { name: 'Users' }).length).toBeGreaterThan(0);
    });

    it('hides Users nav link for non-admin users', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      renderDashboardLayout(<div>Test</div>);

      expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    });
  });
});
