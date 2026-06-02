import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InviteSignupClient from '@/app/(auth)/invite/[token]/InviteSignupClient';
import { PasswordStrengthBar, validateRegistrationForm } from '@/components/auth/RegistrationForm';

const mockBuildGoogleOAuthStartSearchParams = vi.hoisted(() => vi.fn(() => '?mock-google-oauth=1'));

vi.mock('@/lib/auth/google-oauth', () => ({
  buildGoogleOAuthStartSearchParams: mockBuildGoogleOAuthStartSearchParams,
}));

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
  (useSearchParams as any).mockReturnValue(new URLSearchParams());
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

describe('InviteSignupClient', () => {
  describe('submit flow', () => {
    it('submits normalized payload fields with invite token to register API', async () => {
      const user = userEvent.setup();
      render(<InviteSignupClient token="invite-token-123" />);

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
        inviteToken: string;
      };

      expect(body).toEqual({
        name: 'Sarah Creator',
        email: 'sarah@example.com',
        password: 'Abcdefg1!',
        inviteToken: 'invite-token-123',
      });
    });

    it('renders server-provided JSON error message on non-2xx response', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Conflict',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Email already registered. Please sign in instead.' }),
      });

      render(<InviteSignupClient token="invite-token-123" />);
      await fillValidSignupForm(user);
      await user.click(screen.getByRole('button', { name: /create account/i }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Email already registered. Please sign in instead.');
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('redirects to dashboard on successful registration', async () => {
      const user = userEvent.setup();
      render(<InviteSignupClient token="invite-token-123" />);

      await fillValidSignupForm(user);
      await user.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
    });
  });

  describe('submit vs Google OAuth footer', () => {
    it('starts Google OAuth when the footer button is clicked directly', async () => {
      const user = userEvent.setup();

      render(<InviteSignupClient token="invite-token-123" />);
      await user.click(screen.getByRole('button', { name: /sign up with google/i }));

      expect(mockBuildGoogleOAuthStartSearchParams).toHaveBeenCalledWith({
        redirectTo: null,
        setupToken: null,
        inviteToken: 'invite-token-123',
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('submits the form without starting Google OAuth on a normal submit click', async () => {
      const user = userEvent.setup();

      render(<InviteSignupClient token="invite-token-123" />);
      await fillValidSignupForm(user);
      await user.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      expect(mockBuildGoogleOAuthStartSearchParams).not.toHaveBeenCalled();
    });

    it('does not start Google OAuth when a click during submit pointer press hits the footer', async () => {
      render(<InviteSignupClient token="invite-token-123" />);
      const user = userEvent.setup();
      await fillValidSignupForm(user);

      const submitBtn = screen.getByRole('button', { name: /create account/i });
      const googleBtn = screen.getByRole('button', { name: /sign up with google/i });
      const form = submitBtn.closest('form');
      expect(form).toBeTruthy();

      await act(async () => {
        fireEvent.pointerDown(submitBtn);
      });

      expect(googleBtn).toBeDisabled();

      fireEvent.click(googleBtn);

      await act(async () => {
        fireEvent.pointerUp(submitBtn);
      });

      fireEvent.submit(form!);

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      expect(mockBuildGoogleOAuthStartSearchParams).not.toHaveBeenCalled();
    });
  });
});

describe('RegistrationForm validation helpers', () => {
  it('requires matching passwords', () => {
    const errors = validateRegistrationForm({
      name: 'Sarah',
      email: 'sarah@example.com',
      password: 'Abcdefg1!',
      confirmPassword: 'different',
    });

    expect(errors.confirmPassword).toBe('Passwords do not match.');
  });

  it('rejects weak passwords', () => {
    const errors = validateRegistrationForm({
      name: 'Sarah',
      email: 'sarah@example.com',
      password: 'password',
      confirmPassword: 'password',
    });

    expect(errors.password).toBe('Password is too common. Choose a stronger password.');
  });

  it('accepts email addresses with surrounding whitespace when password is strong', () => {
    const errors = validateRegistrationForm({
      name: 'Sarah',
      email: '  sarah@example.com  ',
      password: 'Abcdefg1!',
      confirmPassword: 'Abcdefg1!',
    });

    expect(errors).toEqual({});
  });
});

describe('PasswordStrengthBar', () => {
  it('shows Weak for a minimal-strength password (score 1)', () => {
    render(<PasswordStrengthBar password="aaaaaaaa" />);
    expect(screen.getByText('Weak')).toBeInTheDocument();
    expect(getStrengthSegments('Weak')).toHaveLength(5);
  });

  it('shows Very strong for score 5', () => {
    render(<PasswordStrengthBar password="Abcdefghijkl1!" />);
    expect(screen.getByText('Very strong')).toBeInTheDocument();
  });
});
