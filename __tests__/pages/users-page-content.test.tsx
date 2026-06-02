import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UsersPageContent } from '@/app/(dashboard)/dashboard/users/UsersPageContent';

vi.mock('@/components/admin/UsersListSection', () => ({
  UsersListSection: ({ currentUserId }: { currentUserId: string }) => (
    <div>Users list for {currentUserId}</div>
  ),
}));

vi.mock('@/components/admin/InvitesSection', () => ({
  InvitesSection: () => <div>Invites section</div>,
}));

describe('UsersPageContent', () => {
  it('renders user management sections with the server-provided user id', () => {
    render(<UsersPageContent currentUserId="admin-user-1" />);

    expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByText('Users list for admin-user-1')).toBeInTheDocument();
    expect(screen.getByText('Invites section')).toBeInTheDocument();
  });
});
