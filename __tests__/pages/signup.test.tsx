// =============================================================================
// SIGNUP PAGE COMPONENT TESTS
// =============================================================================
// Covers registration submit flow and password strength behavior.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

async function fillValidSignupForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/full name/i), '  Sarah Creator  ');
  await user.type(screen.getByLabelText(/^email$/i), '  SARAH@Example.COM  ');
  await user.type(screen.getByLabelText(/^password$/i), 'Abcdefg1!');
  await user.type(screen.getByLabelText(/confirm password/i), 'Abcdefg1!');
}

describe('SignUpPage', () => {
  describe('submit flow', () => {
    it('submits normalized payload fields used by register API', async () => {
      const user = userEvent.setup();
      render(<SignUpPage />);

      await fillValidSignupForm(user);
      await user.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/auth/register');
      expect(options.method).toBe('POST');

      const body = JSON.parse(String(options.body)) as {
        name: string;
        email: string;
        password: string;
        confirmPassword?: string;
      };

      expect(body).toEqual({
        name: 'Sarah Creator',
        email: 'sarah@example.com',
        password: 'Abcdefg1!',
      });
      expect(body.confirmPassword).toBeUndefined();
    });

    it('renders server-provided JSON error message on non-2xx response', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Conflict',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Email already registered. Please sign in instead.' }),
      });

      render(<SignUpPage />);
      await fillValidSignupForm(user);
      await user.click(screen.getByRole('button', { name: /create account/i }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Email already registered. Please sign in instead.');
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('redirects to dashboard on successful registration', async () => {
      const user = userEvent.setup();
      render(<SignUpPage />);

      await fillValidSignupForm(user);
      await user.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
    });
  });

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
