// =============================================================================
// DASHBOARD PAGE COMPONENT TESTS
// =============================================================================
// Tests for the dashboard page UI, stat cards, quick actions, and sections.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardPage from '@/app/(dashboard)/dashboard/page';

describe('DashboardPage Component', () => {
  describe('Page Header', () => {
    it('should render the dashboard title and subtitle', () => {
      render(<DashboardPage />);

      expect(screen.getByRole('heading', { level: 1, name: /dashboard/i })).toBeInTheDocument();
    });
  });

  describe('Stat Cards', () => {
    it('should render all four stat cards with correct labels', () => {
      render(<DashboardPage />);

      expect(screen.getAllByText(/drafts/i)[0]).toBeInTheDocument();
      expect(screen.getByText(/uploads/i)).toBeInTheDocument();
      expect(screen.getByText(/scheduled/i)).toBeInTheDocument();
      expect(screen.getByText(/completed/i)).toBeInTheDocument();
    });
  });

  describe('Quick Actions Section', () => {
    it('should render the quick actions heading', () => {
      render(<DashboardPage />);

      expect(screen.getByRole('heading', { level: 2, name: /quick actions/i })).toBeInTheDocument();
    });

    it('should render all three action links with correct text', () => {
      render(<DashboardPage />);

      expect(screen.getByRole('link', { name: /new upload/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /new draft/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /view drafts/i })).toBeInTheDocument();
    });

    it('should link "New upload" to /dashboard/upload', () => {
      render(<DashboardPage />);

      const newUploadLink = screen.getByRole('link', { name: /new upload/i });
      expect(newUploadLink).toHaveAttribute('href', '/dashboard/upload');
    });

    it('should link "New draft" to /dashboard/upload', () => {
      render(<DashboardPage />);

      const newDraftLink = screen.getByRole('link', { name: /new draft/i });
      expect(newDraftLink).toHaveAttribute('href', '/dashboard/upload');
    });

    it('should link "View drafts" to /dashboard/drafts', () => {
      render(<DashboardPage />);

      const viewDraftsLink = screen.getByRole('link', { name: /view drafts/i });
      expect(viewDraftsLink).toHaveAttribute('href', '/dashboard/drafts');
    });
  });

  describe('Upload Jobs Section', () => {
    it('should render the upload jobs heading', () => {
      render(<DashboardPage />);

      expect(screen.getByRole('heading', { level: 2, name: /upload jobs/i })).toBeInTheDocument();
    });

    it('should render table with correct column headers', () => {
      render(<DashboardPage />);

      expect(screen.getByText(/video/i)).toBeInTheDocument();
      expect(screen.getByText(/platform/i)).toBeInTheDocument();
      expect(screen.getByText(/status/i)).toBeInTheDocument();
      expect(screen.getByText(/date/i)).toBeInTheDocument();
    });

    it('should display empty state message', () => {
      render(<DashboardPage />);

      expect(screen.getByText(/no jobs yet/i)).toBeInTheDocument();
      expect(screen.getByText(/your upload jobs will appear here/i)).toBeInTheDocument();
    });
  });
});
