/**
 * Tests for ProfileInformationSection component.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { ProfileInformationSection } from '@/app/(dashboard)/profile/ProfileInformationSection';

describe('ProfileInformationSection', () => {
  const onProfileUpdated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows read-only email with disconnect guidance for Google accounts', () => {
    render(
      <ProfileInformationSection
        authProvider="google"
        initialName="Jane Doe"
        initialEmail="jane@gmail.com"
        onProfileUpdated={onProfileUpdated}
      />
    );

    expect(screen.getByDisplayValue('jane@gmail.com')).toBeInTheDocument();
    expect(screen.getByText(/Your email is managed by your Google sign-in/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign-in method' })).toHaveAttribute(
      'href',
      '#profile-sign-in-method'
    );
    expect(screen.queryByLabelText('New email address')).not.toBeInTheDocument();
  });

  it('shows editable email flow after authProvider switches from Google to password', () => {
    const { rerender } = render(
      <ProfileInformationSection
        authProvider="google"
        initialName="Jane Doe"
        initialEmail="jane@gmail.com"
        onProfileUpdated={onProfileUpdated}
      />
    );

    expect(screen.queryByLabelText('New email address')).not.toBeInTheDocument();

    rerender(
      <ProfileInformationSection
        authProvider="password"
        initialName="Jane Doe"
        initialEmail="jane@gmail.com"
        onProfileUpdated={onProfileUpdated}
      />
    );

    expect(screen.getByText('jane@gmail.com')).toBeInTheDocument();
    expect(screen.getByLabelText('New email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm new email address')).toBeInTheDocument();
  });

  it('shows change email fields for password accounts', () => {
    render(
      <ProfileInformationSection
        authProvider="password"
        initialName="Jane Doe"
        initialEmail="jane@example.com"
        onProfileUpdated={onProfileUpdated}
      />
    );

    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByLabelText('New email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm new email address')).toBeInTheDocument();
  });

  it('shows client-side error when email fields do not match', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ProfileInformationSection
        authProvider="password"
        initialName="Jane Doe"
        initialEmail="jane@example.com"
        onProfileUpdated={onProfileUpdated}
      />
    );

    await user.type(screen.getByLabelText('New email address'), 'new@example.com');
    await user.type(screen.getByLabelText('Confirm new email address'), 'other@example.com');
    await user.click(screen.getByRole('button', { name: 'Change email' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email addresses do not match.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits name update via PATCH /api/auth/profile', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'Updated Name', email: 'jane@example.com' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ProfileInformationSection
        authProvider="password"
        initialName="Jane Doe"
        initialEmail="jane@example.com"
        onProfileUpdated={onProfileUpdated}
      />
    );

    const nameInput = screen.getByLabelText('Full name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Name');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: 'Updated Name' }),
      });
    });

    expect(onProfileUpdated).toHaveBeenCalledWith({ name: 'Updated Name' });
  });
});
