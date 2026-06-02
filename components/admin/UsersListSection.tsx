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

/** Matches GET /api/admin/users default page size. */
const USERS_PAGE_SIZE = 25;

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
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  const loadUsers = useCallback(
    async (options: { resetError?: boolean } = {}) => {
      if (options.resetError !== false) {
        setError(null);
      }
      try {
        const res = await fetch(`/api/admin/users?limit=${USERS_PAGE_SIZE}&offset=${offset}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(payload.message ?? 'Failed to load users');
        }
        const payload = (await res.json()) as {
          data: {
            users: AdminUserRow[];
            pagination: { limit: number; offset: number; total: number };
          };
        };
        const { users: pageUsers, pagination } = payload.data;
        const totalCount = pagination.total;

        if (totalCount === 0) {
          setUsers([]);
          setTotal(0);
          if (offset > 0) setOffset(0);
          return;
        }

        setTotal(totalCount);

        const lastPageOffset = Math.max(
          0,
          Math.floor((totalCount - 1) / USERS_PAGE_SIZE) * USERS_PAGE_SIZE
        );
        if (offset > lastPageOffset) {
          setOffset(lastPageOffset);
          return;
        }

        setUsers(pageUsers);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load users');
      } finally {
        setLoading(false);
      }
    },
    [offset]
  );

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleRoleChange = async (userId: string, role: UserRole) => {
    setUpdatingUserId(userId);
    setError(null);
    setUsers((current) =>
      current.map((user) => (user.userId === userId ? { ...user, role } : user))
    );

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
      await loadUsers({ resetError: false });
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
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(payload.error ?? payload.message ?? 'Failed to delete user');
      }
      await loadUsers({ resetError: false });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setDeletingUserId(null);
    }
  };

  const canPrev = offset > 0;
  const canNext = offset + users.length < total;
  const showPagination = total > USERS_PAGE_SIZE;

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

      {!loading && total > 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Showing {users.length === 0 ? '—' : `${offset + 1}-${offset + users.length}`} of {total}
        </p>
      ) : null}

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

      {showPagination ? (
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setOffset((prev) => Math.max(0, prev - USERS_PAGE_SIZE))}
            disabled={!canPrev}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setOffset((prev) => prev + USERS_PAGE_SIZE)}
            disabled={!canNext}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60"
          >
            Next
          </button>
        </div>
      ) : null}
    </section>
  );
}
