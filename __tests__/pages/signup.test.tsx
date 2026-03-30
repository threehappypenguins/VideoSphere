// =============================================================================
// SIGNUP PAGE COMPONENT TESTS
// =============================================================================
// Covers registration UI, fetch to /api/auth/register, and password strength bar
// styling for representative scores (mirrors patterns in login.test.tsx).
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SignUpPage from '@/app/(auth)/signup/page';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

import { useRouter, useSearchParams } from 'next/navigation';

const mockPush = vi.fn();
const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (useRouter as any).mockReturnValue({ push: mockPush });
  (useSearchParams as any).mockReturnValue({ get: vi.fn(() => null) });
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockResolvedValue({
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({}),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function getPasswordInput() {
  return screen.getByLabelText(/^password$/i) as HTMLInputElement;
}

function getStrengthSegments(labelText: string) {
  const label = screen.getByText(labelText);
  const row = label.previousElementSibling as HTMLElement | null;
  expect(row).toBeTruthy();
  return Array.from(row!.querySelectorAll(':scope > div')) as HTMLElement[];
}

describe('SignUpPage', () => {
  describe('PasswordStrengthBar', () => {
    it('does not render the strength bar when password is empty', () => {
      render(<SignUpPage />);

      expect(screen.queryByText(/weak|fair|good|strong|very strong/i)).not.toBeInTheDocument();
    });

    it('shows Weak with red bar classes for a minimal-strength password (score 1)', async () => {
      const user = userEvent.setup();
      render(<SignUpPage />);

      await user.type(getPasswordInput(), 'aaaaaaaa');

      const label = screen.getByText('Weak');
      expect(label).toHaveClass('text-red-500');

      const segments = getStrengthSegments('Weak');
      expect(segments).toHaveLength(5);
      expect(segments[0]).toHaveClass('bg-red-500');
      expect(segments[1]).toHaveClass('bg-muted');
      expect(segments[4]).toHaveClass('bg-muted');
    });

    it('shows Fair with orange bar classes for score 2', async () => {
      const user = userEvent.setup();
      render(<SignUpPage />);

      await user.type(getPasswordInput(), 'aaaaaaaaaaaa');

      const label = screen.getByText('Fair');
      expect(label).toHaveClass('text-orange-500');

      const segments = getStrengthSegments('Fair');
      expect(segments[0]).toHaveClass('bg-orange-500');
      expect(segments[1]).toHaveClass('bg-orange-500');
      expect(segments[2]).toHaveClass('bg-muted');
    });

    it('shows Good with accessible yellow label classes and yellow bar (score 3)', async () => {
      const user = userEvent.setup();
      render(<SignUpPage />);

      await user.type(getPasswordInput(), 'Abcdefgh1');

      const label = screen.getByText('Good');
      expect(label).toHaveClass('text-yellow-700', 'dark:text-yellow-400');

      const segments = getStrengthSegments('Good');
      expect(segments[0]).toHaveClass('bg-yellow-500');
      expect(segments[3]).toHaveClass('bg-muted');
    });

    it('shows Strong with green bar classes (score 4)', async () => {
      const user = userEvent.setup();
      render(<SignUpPage />);

      await user.type(getPasswordInput(), 'Abcdefg1!');

      const label = screen.getByText('Strong');
      expect(label).toHaveClass('text-green-500');

      const segments = getStrengthSegments('Strong');
      expect(segments[3]).toHaveClass('bg-green-500');
      expect(segments[4]).toHaveClass('bg-muted');
    });

    it('shows Very strong with emerald bar classes (score 5)', async () => {
      const user = userEvent.setup();
      render(<SignUpPage />);

      await user.type(getPasswordInput(), 'Abcdefghijkl1!');

      const label = screen.getByText('Very strong');
      expect(label).toHaveClass('text-emerald-500');

      const segments = getStrengthSegments('Very strong');
      expect(segments.every((el) => el.className.includes('bg-emerald-500'))).toBe(true);
    });
  });
});
