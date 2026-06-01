// =============================================================================
// DASHBOARD SHELL COMPONENT TESTS
// =============================================================================
// Tests for the responsive dashboard shell (sidebar + mobile nav).
// Verifies all nav links are present, active states are correct, and
// the isActive helper function works as expected.
// =============================================================================

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardShell from '@/components/dashboard/DashboardShell';

// Mock next/navigation for usePathname hook
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}));

// Mock next/link to avoid routing complexity in tests
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock Sonner Toaster to avoid window.matchMedia dependency in tests
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));

import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Drafts', href: '/dashboard/drafts' },
  { label: 'History', href: '/dashboard/history' },
] as const;

describe('DashboardShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Navigation Items Rendering', () => {
    it('should render all 3 navigation links', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      render(
        <DashboardShell>
          <div>Test Content</div>
        </DashboardShell>
      );

      NAV_ITEMS.forEach(({ label }) => {
        expect(screen.getAllByRole('link', { name: label }).length).toBeGreaterThan(0);
      });
    });

    it('should have correct href attributes for all nav items', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      render(
        <DashboardShell>
          <div>Test Content</div>
        </DashboardShell>
      );

      // Verify each navigation label points to the expected route.
      NAV_ITEMS.forEach(({ label, href }) => {
        const links = screen.getAllByRole('link', { name: label });
        expect(links.length).toBeGreaterThan(0);
        links.forEach((link) => {
          expect(link).toHaveAttribute('href', href);
        });
      });
    });

    it('should render children content', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      render(
        <DashboardShell>
          <div data-testid="page-content">Dashboard Page Content</div>
        </DashboardShell>
      );

      expect(screen.getByTestId('page-content')).toBeInTheDocument();
      expect(screen.getByText('Dashboard Page Content')).toBeInTheDocument();
    });
  });

  describe('Active Link Highlighting', () => {
    it('should mark Dashboard as active when pathname is exactly /dashboard', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      render(
        <DashboardShell>
          <div>Test</div>
        </DashboardShell>
      );

      const dashboardLinks = screen.getAllByText('Dashboard');
      const activeLink = dashboardLinks.find((el) => {
        const link = el.closest('a');
        return link && link.getAttribute('aria-current') === 'page';
      });

      expect(activeLink).toBeDefined();
    });

    it('should NOT mark Dashboard as active when pathname is /dashboard/drafts', () => {
      (usePathname as any).mockReturnValue('/dashboard/drafts');

      render(
        <DashboardShell>
          <div>Test</div>
        </DashboardShell>
      );

      const dashboardLinks = screen.getAllByText('Dashboard');
      const activeLink = dashboardLinks.find((el) => {
        const link = el.closest('a');
        return link && link.getAttribute('aria-current') === 'page';
      });

      expect(activeLink).toBeUndefined();
    });

    it('should mark Drafts as active when pathname is /dashboard/drafts', () => {
      (usePathname as any).mockReturnValue('/dashboard/drafts');

      render(
        <DashboardShell>
          <div>Test</div>
        </DashboardShell>
      );

      const draftLinks = screen.getAllByText('Drafts');
      const activeLink = draftLinks.find((el) => {
        const link = el.closest('a');
        return link && link.getAttribute('aria-current') === 'page';
      });

      expect(activeLink).toBeDefined();
    });

    it('should mark Drafts as active when pathname is /dashboard/drafts/[id] (startsWith match)', () => {
      (usePathname as any).mockReturnValue('/dashboard/drafts/video-123');

      render(
        <DashboardShell>
          <div>Test</div>
        </DashboardShell>
      );

      const draftLinks = screen.getAllByText('Drafts');
      const activeLink = draftLinks.find((el) => {
        const link = el.closest('a');
        return link && link.getAttribute('aria-current') === 'page';
      });

      expect(activeLink).toBeDefined();
    });

    it('should mark History as active when pathname is /dashboard/history', () => {
      (usePathname as any).mockReturnValue('/dashboard/history');

      render(
        <DashboardShell>
          <div>Test</div>
        </DashboardShell>
      );

      const historyLinks = screen.getAllByText('History');
      const activeLink = historyLinks.find((el) => {
        const link = el.closest('a');
        return link && link.getAttribute('aria-current') === 'page';
      });

      expect(activeLink).toBeDefined();
    });

    it('should only mark Drafts links as active for /dashboard/drafts', () => {
      (usePathname as any).mockReturnValue('/dashboard/drafts');

      render(
        <DashboardShell>
          <div>Test</div>
        </DashboardShell>
      );

      const allLinks = screen.getAllByRole('link');
      const activeLinks = allLinks.filter((link) => link.getAttribute('aria-current') === 'page');

      expect(activeLinks.length).toBeGreaterThan(0);
      activeLinks.forEach((link) => {
        expect(link).toHaveTextContent('Drafts');
      });
    });
  });

  describe('Responsive Layout Structure', () => {
    it('should render sidebar', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      render(
        <DashboardShell>
          <div>Test</div>
        </DashboardShell>
      );

      const navs = screen.getAllByLabelText('Dashboard navigation');
      expect(navs.length).toBeGreaterThanOrEqual(2);
    });

    it('should render both dashboard navigation regions (sidebar + mobile tabs)', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      render(
        <DashboardShell>
          <div>Test</div>
        </DashboardShell>
      );

      expect(screen.getAllByRole('navigation', { name: 'Dashboard navigation' })).toHaveLength(2);
    });

    it('should render child content inside the layout shell', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      render(
        <DashboardShell>
          <div data-testid="dashboard-content">Test</div>
        </DashboardShell>
      );

      expect(screen.getByTestId('dashboard-content')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should not match unrelated routes', () => {
      (usePathname as any).mockReturnValue('/profile');

      render(
        <DashboardShell>
          <div>Test</div>
        </DashboardShell>
      );

      const allLinks = screen.getAllByRole('link');
      const activeLinks = allLinks.filter((link) => link.getAttribute('aria-current') === 'page');

      expect(activeLinks.length).toBe(0);
    });

    it('should handle root dashboard route correctly', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      render(
        <DashboardShell>
          <div>Test</div>
        </DashboardShell>
      );

      const allLinks = screen.getAllByRole('link');
      const activeLinks = allLinks.filter((link) => link.getAttribute('aria-current') === 'page');

      expect(activeLinks.length).toBeGreaterThan(0);
      activeLinks.forEach((link) => {
        expect(link).toHaveTextContent('Dashboard');
      });
    });

    it('should render each nav label as a link', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      render(
        <DashboardShell>
          <div>Test</div>
        </DashboardShell>
      );

      NAV_ITEMS.forEach(({ label }) => {
        const elements = screen.getAllByRole('link', { name: label });
        expect(elements.length).toBeGreaterThan(0);
      });
    });

    it('shows Users nav link for admin users', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      render(
        <DashboardShell isAdmin>
          <div>Test</div>
        </DashboardShell>
      );

      expect(screen.getAllByRole('link', { name: 'Users' }).length).toBeGreaterThan(0);
    });

    it('hides Users nav link for non-admin users', () => {
      (usePathname as any).mockReturnValue('/dashboard');

      render(
        <DashboardShell>
          <div>Test</div>
        </DashboardShell>
      );

      expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    });
  });
});
