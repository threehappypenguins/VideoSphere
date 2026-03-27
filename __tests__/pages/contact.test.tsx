import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContactPage from '@/app/(marketing)/contact/page';

describe('ContactPage', () => {
  it('shows per-field errors when submitting an empty form', async () => {
    const user = userEvent.setup();
    render(<ContactPage />);

    await user.click(screen.getByRole('button', { name: /send message/i }));

    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Message must be at least 10 characters')).toBeInTheDocument();
  });

  it('shows an email error when email is invalid', async () => {
    const user = userEvent.setup();
    render(<ContactPage />);

    await user.type(screen.getByLabelText(/name/i), 'Sarah');
    await user.type(screen.getByLabelText(/email/i), 'sarah@localhost');
    await user.type(screen.getByLabelText(/message/i), 'This message is definitely long enough.');
    await user.click(screen.getByRole('button', { name: /send message/i }));

    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
  });

  it('shows a message error when message is too short', async () => {
    const user = userEvent.setup();
    render(<ContactPage />);

    await user.type(screen.getByLabelText(/name/i), 'Sarah');
    await user.type(screen.getByLabelText(/email/i), 'sarah@example.com');
    await user.type(screen.getByLabelText(/message/i), 'Too short');
    await user.click(screen.getByRole('button', { name: /send message/i }));

    expect(screen.getByText('Message must be at least 10 characters')).toBeInTheDocument();
  });

  it('swaps form for thank-you state after a valid submit', async () => {
    const user = userEvent.setup();
    render(<ContactPage />);

    await user.type(screen.getByLabelText(/name/i), 'Sarah');
    await user.type(screen.getByLabelText(/email/i), 'sarah@example.com');
    await user.type(screen.getByLabelText(/message/i), 'This message is definitely long enough.');
    await user.click(screen.getByRole('button', { name: /send message/i }));

    expect(screen.getByText(/thanks for reaching out/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send message/i })).not.toBeInTheDocument();
  });

  it('resets to an empty form when clicking "Send another message"', async () => {
    const user = userEvent.setup();
    render(<ContactPage />);

    const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement;
    const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
    const messageInput = screen.getByLabelText(/message/i) as HTMLTextAreaElement;

    await user.type(nameInput, 'Sarah');
    await user.type(emailInput, 'sarah@example.com');
    await user.type(messageInput, 'This message is definitely long enough.');
    await user.click(screen.getByRole('button', { name: /send message/i }));

    await user.click(screen.getByRole('button', { name: /send another message/i }));

    expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument();
    expect(screen.queryByText(/thanks for reaching out/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toHaveValue('');
    expect(screen.getByLabelText(/email/i)).toHaveValue('');
    expect(screen.getByLabelText(/message/i)).toHaveValue('');
  });
});
