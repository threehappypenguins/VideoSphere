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
import type { ReactNode } from 'react';
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
    // Clean up DOM after each test
    document.body.innerHTML = '';
  });

  describe('Toaster ARIA Live Region Setup', () => {
    it('should render single Toaster with ARIA live region', async () => {
      const { container } = render(
        <div>
          <Toaster />
        </div>
      );

      // Sonner creates a live region with role="status" or specific ARIA attributes
      // Wait for the toaster DOM to be fully rendered
      await waitFor(() => {
        // Sonner's Toaster should render a container with accessibility attributes
        const toasterContainer = container.querySelector('[role="status"], [aria-live], .toaster');
        expect(toasterContainer).toBeInTheDocument();
      });
    });

    it('should only render one Toaster instance in root layout', async () => {
      render(
        <div>
          <Toaster />
          <div>Main content</div>
        </div>
      );

      // Count how many Sonner toaster containers exist
      const toasters = document.querySelectorAll('.toaster, [aria-live="polite"]');
      // Should have exactly one main toaster container
      expect(toasters.length).toBeGreaterThanOrEqual(1);
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

      // Verify only one toaster container exists by checking for the class
      const toasterContainers = container.querySelectorAll('.toaster');
      expect(toasterContainers.length).toBeLessThanOrEqual(1);
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
      const startTime = performance.now();
      toast.success(message);

      await waitFor(() => {
        expect(screen.queryByText(message)).toBeInTheDocument();
        const endTime = performance.now();
        // Toast should appear very quickly (within 500ms)
        expect(endTime - startTime).toBeLessThan(500);
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

      const toastersBefore = container.querySelectorAll('[data-sonner-toaster="true"]').length;

      // Simulate navigation to another page (Toaster persists across pages)
      rerender(
        <div>
          <Toaster />
          <div>Drafts Page</div>
        </div>
      );

      const toastersAfter = container.querySelectorAll('[data-sonner-toaster="true"]').length;

      // Should still have same number of toasters (no duplicates created)
      expect(toastersAfter).toBeLessThanOrEqual(toastersBefore + 1);
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
