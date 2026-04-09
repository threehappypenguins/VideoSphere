// =============================================================================
// LIVE REGION ANNOUNCEMENTS TEST
// =============================================================================
// This test verifies that:
// 1. Sonner Toaster automatically provides ARIA live regions
// 2. Toast announcements are properly announced at the right times
// 3. No duplicate toaster mounts exist (no duplicate announcements)
//
// Reference: Issue #174 - Verify Live Region Announcements
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

// Mock the theme hook
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

describe('Live Region Announcements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Dismiss all pending toasts so state does not leak between tests.
    // React DOM cleanup is handled automatically by Testing Library.
    toast.dismiss();
  });

  describe('Toaster ARIA Live Region Setup', () => {
    it('should render single Toaster with ARIA live region', async () => {
      const { container } = render(
        <div>
          <Toaster />
        </div>
      );

      // Sonner renders an element with aria-live="polite", aria-relevant="additions text",
      // and aria-atomic="false" as its live region. Assert on those exact attributes so
      // the test fails if the live region is absent, even if the toaster list container
      // is still present.
      await waitFor(() => {
        const liveRegion = container.querySelector('[aria-live="polite"]');
        expect(liveRegion).toBeInTheDocument();
        expect(liveRegion).toHaveAttribute('aria-relevant', 'additions text');
        expect(liveRegion).toHaveAttribute('aria-atomic', 'false');
      });
    });

    it('should only render one Toaster instance in root layout', async () => {
      render(
        <div>
          <Toaster />
          <div>Main content</div>
        </div>
      );

      toast.success('Root layout toaster mount check');

      await waitFor(() => {
        // Sonner mounts the root container lazily when a toast is created.
        const toasters = document.querySelectorAll('[data-sonner-toaster="true"]');
        expect(toasters.length).toBe(1);
      });
    });

    it('should NOT have duplicate toaster mounts', async () => {
      // This simulates the root layout only having Toaster once
      const { container } = render(
        <div>
          <Toaster />
          <div>Dashboard content</div>
          {/* No second Toaster here - dashboard layout shouldn't have one */}
        </div>
      );

      toast.success('Duplicate mount check');

      await waitFor(() => {
        // Only one Sonner root should be present to avoid duplicate announcements.
        const toasterContainers = container.querySelectorAll('[data-sonner-toaster="true"]');
        expect(toasterContainers.length).toBe(1);
      });
    });
  });

  describe('Toast Announcement Content', () => {
    it('should announce success toast message', async () => {
      render(<Toaster />);

      const successMessage = 'Operation completed successfully';
      toast.success(successMessage);

      // Sonner announces toast messages through live region
      // The message should be rendered in the DOM for screen reader announcement
      await waitFor(() => {
        expect(screen.queryByText(successMessage)).toBeInTheDocument();
      });
    });

    it('should announce error toast message', async () => {
      render(<Toaster />);

      const errorMessage = 'An error occurred';
      toast.error(errorMessage);

      await waitFor(() => {
        expect(screen.queryByText(errorMessage)).toBeInTheDocument();
      });
    });

    it('should announce loading toast message', async () => {
      render(<Toaster />);

      const loadingMessage = 'Processing your request...';
      toast.loading(loadingMessage);

      await waitFor(() => {
        expect(screen.queryByText(loadingMessage)).toBeInTheDocument();
      });
    });
  });

  describe('Announcement Timing', () => {
    it('should announce toast immediately after creation', async () => {
      render(<Toaster />);

      const message = 'Quick notification';
      toast.success(message);

      await waitFor(() => {
        expect(screen.queryByText(message)).toBeInTheDocument();
      });
    });
  });

  describe('No Duplicate Announcements', () => {
    it('should render message in toast without excessive duplication', async () => {
      const { container } = render(
        <div>
          <Toaster />
          <div id="test-content">Test</div>
        </div>
      );

      const message = 'Unique notification message for duplicate test';
      toast.success(message);

      await waitFor(() => {
        // Verify message appears in the toast element
        expect(screen.queryByText(message)).toBeInTheDocument();

        // Verify there's only one toaster container
        const toasterContainers = container.querySelectorAll('[data-sonner-toaster="true"]');
        expect(toasterContainers.length).toBe(1);
      });
    });

    it('should not duplicate toaster when multiple pages are visited', async () => {
      const { rerender, container } = render(
        <div>
          <Toaster />
          <div>Dashboard Page</div>
        </div>
      );

      toast.success('Navigation baseline toaster check');

      let toastersBefore = 0;
      await waitFor(() => {
        toastersBefore = container.querySelectorAll('[data-sonner-toaster="true"]').length;
        expect(toastersBefore).toBe(1);
      });

      // Simulate navigation to another page (Toaster persists across pages)
      rerender(
        <div>
          <Toaster />
          <div>Drafts Page</div>
        </div>
      );

      const toastersAfter = container.querySelectorAll('[data-sonner-toaster="true"]').length;

      // Navigation should not create an additional toaster container.
      expect(toastersAfter).toBe(toastersBefore);
    });
  });

  describe('Integration: Dashboard Toast Flows', () => {
    it('should announce form validation error', async () => {
      render(<Toaster />);

      const validationError = 'Please fill in all required fields';
      toast.error(validationError);

      await waitFor(() => {
        expect(screen.queryByText(validationError)).toBeInTheDocument();
      });
    });

    it('should announce upload status updates', async () => {
      render(<Toaster />);

      toast.loading('Starting upload...');
      await waitFor(() => {
        expect(screen.queryByText('Starting upload...')).toBeInTheDocument();
      });

      // Simulate status update
      toast.success('Upload complete');
      await waitFor(() => {
        expect(screen.queryByText('Upload complete')).toBeInTheDocument();
      });
    });

    it('should announce platform connection success', async () => {
      render(<Toaster />);

      const successMsg = 'YouTube connected successfully';
      toast.success(successMsg);

      await waitFor(() => {
        expect(screen.queryByText(successMsg)).toBeInTheDocument();
      });
    });
  });
});
