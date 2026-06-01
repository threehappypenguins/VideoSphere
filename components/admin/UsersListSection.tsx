'use client';

import { useCallback, useEffect, useState } from 'react';
import type { UserRole } from '@/types';

interface AdminUserRow {
  userId: string;
  email: string;
  name?: string;
  role: UserRole;
  createdAt: string;
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function displayName(user: AdminUserRow): string {
  if (user.name?.trim()) return user.name.trim();
  return user.email;
}

interface UsersListSectionProps {
  currentUserId: string;
}

/**
 * Admin user list with role management and deletion controls.
 * @param props - Component props.
 * @returns The rendered users list UI.
 */
export function UsersListSection({ currentUserId }: UsersListSectionProps) {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/users?limit=100&offset=0');
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? 'Failed to load users');
      }
      const payload = (await res.json()) as { data: { users: AdminUserRow[] } };
      setUsers(payload.data.users);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleRoleChange = async (userId: string, role: UserRole) => {
    setUpdatingUserId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(payload.error ?? payload.message ?? 'Failed to update role');
      }
      const payload = (await res.json()) as { data: { user: AdminUserRow } };
      setUsers((current) =>
        current.map((user) => (user.userId === userId ? payload.data.user : user))
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
      await loadUsers();
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleDelete = async (userId: string) => {
    if (!window.confirm('Delete this user? This cannot be undone.')) return;

    setDeletingUserId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(payload.error ?? payload.message ?? 'Failed to delete user');
      }
      setUsers((current) => current.filter((user) => user.userId !== userId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setDeletingUserId(null);
    }
  };

  return (
    <section
      aria-labelledby="users-list-heading"
      className="rounded-xl border border-border bg-background p-6"
    >
      <h2 id="users-list-heading" className="text-xl font-semibold text-foreground">
        All users
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Manage roles and remove accounts. You cannot delete your own account.
      </p>

      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

      <div className="mt-6 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-3 font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Email</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Role</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Joined</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-4 text-muted-foreground" colSpan={5}>
                  Loading users…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-muted-foreground" colSpan={5}>
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const isSelf = user.userId === currentUserId;
                return (
                  <tr key={user.userId} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 text-foreground">
                      {displayName(user)}
                      {isSelf ? (
                        <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                    <td className="px-4 py-3">
                      <select
                        value={user.role}
                        disabled={updatingUserId === user.userId}
                        onChange={(event) =>
                          void handleRoleChange(user.userId, event.target.value as UserRole)
                        }
                        aria-label={`Role for ${displayName(user)}`}
                        className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      {isSelf ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <button
                          type="button"
                          disabled={deletingUserId === user.userId}
                          onClick={() => void handleDelete(user.userId)}
                          className="text-sm font-medium text-destructive hover:text-destructive/80 disabled:opacity-50"
                        >
                          {deletingUserId === user.userId ? 'Deleting…' : 'Delete'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
