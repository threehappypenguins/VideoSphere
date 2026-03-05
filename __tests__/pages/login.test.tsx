// =============================================================================
// LOGIN PAGE COMPONENT TESTS
// =============================================================================
// Tests for the login page UI and user interactions.
// Focus on form handling, state management, and important user workflows.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '@/app/(auth)/login/page';

// Mock the auth client
vi.mock('@/lib/auth-client', () => ({
  loginWithEmail: vi.fn(),
}));

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}));

import { loginWithEmail } from '@/lib/auth-client';
import { useRouter } from 'next/navigation';

const mockPush = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (useRouter as any).mockReturnValue({
    push: mockPush,
  });
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
    it('should call loginWithEmail with form data on submit', async () => {
      const user = userEvent.setup();
      (loginWithEmail as any).mockResolvedValue({ $id: 'session123' });

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /log in/i });

      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);

      expect(loginWithEmail).toHaveBeenCalledWith('test@example.com', 'password123');
    });

    it('should show success message on successful login', async () => {
      const user = userEvent.setup();
      (loginWithEmail as any).mockResolvedValue({ $id: 'session123' });

      render(<LoginPage />);

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        expect(screen.getByText(/login successful/i)).toBeInTheDocument();
      });
    });

    it('should redirect to dashboard after successful login', async () => {
      const user = userEvent.setup();
      (loginWithEmail as any).mockResolvedValue({ $id: 'session123' });

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
      (loginWithEmail as any).mockRejectedValue(new Error(errorMessage));

      render(<LoginPage />);

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        expect(screen.getByText(errorMessage)).toBeInTheDocument();
      });
    });

    it('should display generic error message for non-Error objects', async () => {
      const user = userEvent.setup();
      (loginWithEmail as any).mockRejectedValue({ error: 'unknown' });

      render(<LoginPage />);

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        expect(screen.getByText(/an error occurred during login/i)).toBeInTheDocument();
      });
    });
  });

  describe('Loading State', () => {
    it('should show loading text on button during submission', async () => {
      const user = userEvent.setup();
      (loginWithEmail as any).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
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
      (loginWithEmail as any).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i) as HTMLInputElement;
      const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;

      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      expect(emailInput.disabled).toBe(true);
      expect(passwordInput.disabled).toBe(true);
    });

    it('should disable submit button during submission', async () => {
      const user = userEvent.setup();
      (loginWithEmail as any).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      render(<LoginPage />);

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');

      const submitButton = screen.getByRole('button', { name: /log in/i });
      await user.click(submitButton);

      expect(submitButton).toBeDisabled();
    });
  });

  describe('Error Message Styling', () => {
    it('should display error message with error styling', async () => {
      const user = userEvent.setup();
      (loginWithEmail as any).mockRejectedValue(new Error('Login failed'));

      render(<LoginPage />);

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        const errorElement = screen.getByRole('alert');
        expect(errorElement).toHaveClass('bg-red-50');
      });
    });

    it('should display success message with success styling', async () => {
      const user = userEvent.setup();
      (loginWithEmail as any).mockResolvedValue({ $id: 'session123' });

      render(<LoginPage />);

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password123');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        const successElement = screen.getByRole('alert');
        expect(successElement).toHaveClass('bg-green-50');
      });
    });
  });

  describe('Form Reset', () => {
    it('should clear error message on new submission attempt', async () => {
      const user = userEvent.setup();
      (loginWithEmail as any).mockRejectedValueOnce(new Error('Login failed'));
      (loginWithEmail as any).mockResolvedValueOnce({ $id: 'session123' });

      render(<LoginPage />);

      // First failed attempt
      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        expect(screen.getByText('Login failed')).toBeInTheDocument();
      });

      // Change password and try again
      const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;
      await user.clear(passwordInput);
      await user.type(passwordInput, 'correctpassword');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        expect(screen.queryByText('Login failed')).not.toBeInTheDocument();
        expect(screen.getByText(/login successful/i)).toBeInTheDocument();
      });
    });
  });
});
