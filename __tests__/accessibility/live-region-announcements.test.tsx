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
    it('should provide a custom ARIA live region and disable Sonner built-in one', async () => {
      const { container } = render(
        <div>
          <Toaster />
        </div>
      );

      toast.success('Live region setup test');

      await waitFor(() => {
        // Our custom live region: role="status", aria-live="polite", aria-atomic="true"
        const customLive = container.querySelector('div[role="status"][aria-live="polite"]');
        expect(customLive).toBeInTheDocument();
        expect(customLive).toHaveAttribute('aria-atomic', 'true');

        // Sonner's built-in section should have aria-live="off" so it doesn't
        // also announce, which caused duplicate/triple readouts.
        const sonnerSection = container.querySelector('section[aria-label]');
        if (sonnerSection) {
          expect(sonnerSection).toHaveAttribute('aria-live', 'off');
        }
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
    it('should strip list semantics and disable Sonner live region to prevent positional readouts', async () => {
      const { container } = render(
        <div>
          <Toaster />
        </div>
      );

      toast.success('List semantics test');

      await waitFor(() => {
        // The <ol> rendered by Sonner must have role="presentation" so screen
        // readers do not announce list-item positions (e.g. "1 of 1").
        const ol = container.querySelector('ol[data-sonner-toaster]');
        expect(ol).toBeInTheDocument();
        expect(ol).toHaveAttribute('role', 'presentation');

        // Each toast <li> should also have role="presentation".
        const li = container.querySelector('li[data-sonner-toast]');
        expect(li).toBeInTheDocument();
        expect(li).toHaveAttribute('role', 'presentation');

        // Sonner's section aria-live must be "off".
        const section = container.querySelector('section[aria-label]');
        if (section) {
          expect(section).toHaveAttribute('aria-live', 'off');
        }

        // The custom live region should contain the toast text.
        const customLive = container.querySelector('div[role="status"][aria-live="polite"]');
        expect(customLive).toBeInTheDocument();
        expect(customLive?.textContent).toBe('List semantics test');
      });
    });

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
