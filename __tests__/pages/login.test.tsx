// =============================================================================
// LOGIN PAGE COMPONENT TESTS
// =============================================================================
// Tests for the login page UI and user interactions. The page uses
// fetch('/api/auth/login'), not loginWithEmail, so we mock global fetch.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '@/app/(auth)/login/page';

// Mock Next.js router and search params (login page uses useSearchParams for ?error=)
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

import { useRouter, useSearchParams } from 'next/navigation';

const mockPush = vi.fn();
const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (useRouter as any).mockReturnValue({
    push: mockPush,
  });
  (useSearchParams as any).mockReturnValue({
    get: vi.fn(() => null),
  });
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoginPage Component', () => {
  describe('Form Rendering', () => {
    it('should render login form with email and password inputs', () => {
      render(<LoginPage />);

      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
    });

    it('should render form title and description', () => {
      render(<LoginPage />);

      expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
      expect(screen.getByText(/log in to your videosphere account/i)).toBeInTheDocument();
    });

    it('should have correct input types and attributes', () => {
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i) as HTMLInputElement;
      const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;

      expect(emailInput.type).toBe('email');
      expect(emailInput.required).toBe(true);
      expect(passwordInput.type).toBe('password');
      expect(passwordInput.required).toBe(true);
    });

    it('should have sign up link', () => {
      render(<LoginPage />);

      const signupLink = screen.getByRole('link', { name: /sign up/i });
      expect(signupLink).toHaveAttribute('href', '/signup');
    });
  });

  describe('Form State Management', () => {
    it('should update email field when user types', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i) as HTMLInputElement;
      await user.type(emailInput, 'test@example.com');

      expect(emailInput.value).toBe('test@example.com');
    });

    it('should update password field when user types', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;
      await user.type(passwordInput, 'password123');

      expect(passwordInput.value).toBe('password123');
    });

    it('should update both fields independently', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i) as HTMLInputElement;
      const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;

      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');

      expect(emailInput.value).toBe('test@example.com');
      expect(passwordInput.value).toBe('password123');
    });
  });

  describe('Form Submission', () => {
    it('should call login API with form data on submit', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/auth/login',
          expect.objectContaining({
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
          })
        );
      });
    });

    it('should show success message on successful login', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        expect(screen.getAllByText(/login successful/i).length).toBeGreaterThan(0);
      });
    });

    it('should redirect to dashboard after successful login', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(
        () => {
          expect(mockPush).toHaveBeenCalledWith('/dashboard');
        },
        { timeout: 2000 }
      );
    });
  });

  describe('Error Handling', () => {
    it('should display error message on login failure', async () => {
      const user = userEvent.setup();
      const errorMessage = 'Invalid email or password';
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ error: errorMessage }),
      });

      render(<LoginPage />);

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        expect(screen.getAllByText(errorMessage).length).toBeGreaterThan(0);
      });
    });

    it('should display generic error message when fetch throws', async () => {
      const user = userEvent.setup();
      mockFetch.mockImplementationOnce(() => Promise.reject(new Error('Network error')));

      render(<LoginPage />);

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        const alerts = screen.getAllByText(/an error occurred during login/i);
        expect(alerts.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Loading State', () => {
    it('should show loading text on button during submission', async () => {
      const user = userEvent.setup();
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ ok: true, json: async () => ({}) }), 100)
          )
      );

      render(<LoginPage />);

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');

      const submitButton = screen.getByRole('button', { name: /log in/i });
      await user.click(submitButton);

      expect(screen.getByRole('button', { name: /logging in/i })).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /logging in/i })).not.toBeInTheDocument();
      });
    });

    it('should disable form inputs during submission', async () => {
      const user = userEvent.setup();
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ ok: true, json: async () => ({}) }), 100)
          )
      );

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i) as HTMLInputElement;
      const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;

      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        expect(emailInput.disabled).toBe(true);
        expect(passwordInput.disabled).toBe(true);
      });
    });

    it('should disable submit button during submission', async () => {
      const user = userEvent.setup();
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ ok: true, json: async () => ({}) }), 100)
          )
      );

      render(<LoginPage />);

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');

      const submitButton = screen.getByRole('button', { name: /log in/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(submitButton).toBeDisabled();
      });
    });
  });

  describe('Error Message Styling', () => {
    it('should display error message with error styling', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Login failed' }),
      });

      render(<LoginPage />);

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        const alerts = screen.getAllByText('Login failed');
        expect(alerts[0].closest('[role="alert"]')).toHaveClass('bg-red-50');
      });
    });

    it('should display success message with success styling', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        const alerts = screen.getAllByText(/login successful/i);
        expect(alerts[0].closest('[role="alert"]')).toHaveClass('bg-green-50');
      });
    });
  });

  describe('Form Reset', () => {
    it('should clear error message on new submission attempt', async () => {
      const user = userEvent.setup();
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: 'Login failed' }),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      render(<LoginPage />);

      // First failed attempt
      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        expect(screen.getAllByText('Login failed').length).toBeGreaterThan(0);
      });

      // Change password and try again
      const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;
      await user.clear(passwordInput);
      await user.type(passwordInput, 'correctpassword');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        expect(screen.queryAllByText('Login failed').length).toBe(0);
        expect(screen.getAllByText(/login successful/i).length).toBeGreaterThan(0);
      });
    });
  });
});
