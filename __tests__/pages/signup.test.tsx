// =============================================================================
// SIGNUP PAGE COMPONENT TESTS
// =============================================================================
// Covers registration UI and password strength behavior.
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

    it('shows Weak for a minimal-strength password (score 1)', async () => {
      const user = userEvent.setup();
      render(<SignUpPage />);

      await user.type(getPasswordInput(), 'aaaaaaaa');

      expect(screen.getByText('Weak')).toBeInTheDocument();

      const segments = getStrengthSegments('Weak');
      expect(segments).toHaveLength(5);
    });

    it('shows Fair for score 2', async () => {
      const user = userEvent.setup();
      render(<SignUpPage />);

      await user.type(getPasswordInput(), 'aaaaaaaaaaaa');

      expect(screen.getByText('Fair')).toBeInTheDocument();

      const segments = getStrengthSegments('Fair');
      expect(segments).toHaveLength(5);
    });

    it('shows Good for score 3', async () => {
      const user = userEvent.setup();
      render(<SignUpPage />);

      await user.type(getPasswordInput(), 'Abcdefgh1');

      expect(screen.getByText('Good')).toBeInTheDocument();

      const segments = getStrengthSegments('Good');
      expect(segments).toHaveLength(5);
    });

    it('shows Strong for score 4', async () => {
      const user = userEvent.setup();
      render(<SignUpPage />);

      await user.type(getPasswordInput(), 'Abcdefg1!');

      expect(screen.getByText('Strong')).toBeInTheDocument();

      const segments = getStrengthSegments('Strong');
      expect(segments).toHaveLength(5);
    });

    it('shows Very strong for score 5', async () => {
      const user = userEvent.setup();
      render(<SignUpPage />);

      await user.type(getPasswordInput(), 'Abcdefghijkl1!');

      expect(screen.getByText('Very strong')).toBeInTheDocument();

      const segments = getStrengthSegments('Very strong');
      expect(segments).toHaveLength(5);
    });

    it('updates and hides strength feedback as password changes', async () => {
      const user = userEvent.setup();
      render(<SignUpPage />);

      const input = getPasswordInput();

      await user.type(input, 'aaaaaaaa');
      expect(screen.getByText('Weak')).toBeInTheDocument();

      await user.clear(input);
      await user.type(input, 'Abcdefgh1');
      expect(screen.getByText('Good')).toBeInTheDocument();

      await user.clear(input);
      expect(screen.queryByText(/weak|fair|good|strong|very strong/i)).not.toBeInTheDocument();
    });
  });
});
