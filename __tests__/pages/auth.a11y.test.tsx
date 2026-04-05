import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '@/app/(auth)/login/page';
import SignUpPage from '@/app/(auth)/signup/page';
import { expectNoAxeViolations, renderWithMain } from '@/__tests__/utils/a11y';

const mockPush = vi.hoisted(() => vi.fn());
const mockSearchParamsGet = vi.hoisted(() => vi.fn(() => null));
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: mockSearchParamsGet }),
}));

describe('Auth pages accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('renders the login form accessibly and announces authentication errors', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Invalid email or password' }),
    });

    const { baseElement } = renderWithMain(<LoginPage />);

    await user.type(screen.getByLabelText(/email address/i), 'creator@example.com');
    await user.type(screen.getByLabelText(/password/i), 'bad-password');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/invalid email or password/i);

    await expectNoAxeViolations(baseElement);
  });

  it('renders the signup form accessibly with described validation errors', async () => {
    const user = userEvent.setup();
    const { baseElement } = renderWithMain(<SignUpPage />);

    await user.click(screen.getByRole('button', { name: /create account/i }));

    const nameInput = screen.getByLabelText(/full name/i);
    const emailInput = screen.getByLabelText(/^email$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const confirmPasswordInput = screen.getByLabelText(/confirm password/i);

    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput).toHaveAttribute('aria-describedby', 'name-error');
    expect(emailInput).toHaveAttribute('aria-describedby', 'email-error');
    expect(passwordInput).toHaveAttribute('aria-describedby', 'password-error');
    expect(confirmPasswordInput).toHaveAttribute('aria-describedby', 'confirmPassword-error');

    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    expect(screen.getByText(/please confirm your password/i)).toBeInTheDocument();

    await expectNoAxeViolations(baseElement);
  });
});
