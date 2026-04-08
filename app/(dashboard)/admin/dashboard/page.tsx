'use client';

import { useCallback, useEffect, useState } from 'react';

const USERS_PAGE_SIZE = 50;

interface AdminStats {
  totalUsers: number;
  totalSupporters: number;
  uploadsThisMonth: number;
  activeDrafts: number;
}

interface AdminUser {
  userId: string;
  email: string;
  role: 'user' | 'admin';
  isSupporter: boolean;
  createdAt: string;
}

interface UsersResponseData {
  users: AdminUser[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

interface StatsResponseData {
  totalUsers: number;
  totalSupporters: number;
  uploadsThisMonth: number;
  activeDrafts: number;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

/**
 * Renders the admin dashboard page component.
 * @returns The rendered UI output.
 */
export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersOffset, setUsersOffset] = useState(0);
  const [statsLoading, setStatsLoading] = useState(true);
  const [usersInitialLoading, setUsersInitialLoading] = useState(true);
  const [usersPageLoading, setUsersPageLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);

  const fetchUsersPage = useCallback(async (offset: number, mode: 'initial' | 'page') => {
    const isInitial = mode === 'initial';
    if (isInitial) {
      setUsersInitialLoading(true);
    } else {
      setUsersPageLoading(true);
    }
    setUsersError(null);
    try {
      const res = await fetch(`/api/admin/users?limit=${USERS_PAGE_SIZE}&offset=${offset}`);
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? 'Failed to load users');
      }
      const payload = (await res.json()) as { data: UsersResponseData };
      setUsers(payload.data.users);
      setUsersTotal(payload.data.pagination.total);
      setUsersOffset(payload.data.pagination.offset);
    } catch (error: unknown) {
      setUsersError(error instanceof Error ? error.message : 'Failed to load users');
    } finally {
      if (isInitial) {
        setUsersInitialLoading(false);
      } else {
        setUsersPageLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const loadStats = async () => {
      setStatsLoading(true);
      setStatsError(null);
      try {
        const res = await fetch('/api/admin/stats');
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(payload.message ?? 'Failed to load admin stats');
        }
        const payload = (await res.json()) as { data: StatsResponseData };
        setStats(payload.data);
      } catch (error: unknown) {
        setStatsError(error instanceof Error ? error.message : 'Failed to load admin stats');
      } finally {
        setStatsLoading(false);
      }
    };

    void loadStats();
    void fetchUsersPage(0, 'initial');
  }, [fetchUsersPage]);

  const usersLoading = usersInitialLoading;
  const rangeStart = usersTotal === 0 ? 0 : usersOffset + 1;
  const rangeEnd = usersOffset + users.length;
  const canGoPrev = usersOffset > 0 && !usersPageLoading && !usersInitialLoading;
  const canGoNext =
    usersOffset + users.length < usersTotal && !usersPageLoading && !usersInitialLoading;

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Admin Dashboard</h1>
          <p className="mt-2 text-muted-foreground">Application overview and management tools.</p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">Total Users</p>
            <p className="mt-2 text-3xl font-bold text-foreground">
              {statsLoading ? '...' : (stats?.totalUsers ?? 0)}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">Total Supporters</p>
            <p className="mt-2 text-3xl font-bold text-foreground">
              {statsLoading ? '...' : (stats?.totalSupporters ?? 0)}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">Uploads This Month</p>
            <p className="mt-2 text-3xl font-bold text-foreground">
              {statsLoading ? '...' : (stats?.uploadsThisMonth ?? 0)}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">Active Drafts</p>
            <p className="mt-2 text-3xl font-bold text-foreground">
              {statsLoading ? '...' : (stats?.activeDrafts ?? 0)}
            </p>
          </div>
        </div>

        {statsError ? <p className="mt-4 text-sm text-red-600">{statsError}</p> : null}

        <div className="mt-8 rounded-xl border border-border bg-background p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-semibold text-foreground">Users</h2>
            {!usersInitialLoading && users.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                Showing {rangeStart}–{rangeEnd} of {usersTotal}
              </p>
            ) : null}
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="pb-3 font-medium text-muted-foreground">Email</th>
                  <th className="pb-3 font-medium text-muted-foreground">Role</th>
                  <th className="pb-3 font-medium text-muted-foreground">Supporter</th>
                  <th className="pb-3 font-medium text-muted-foreground">Created</th>
                </tr>
              </thead>
              <tbody>
                {usersLoading ? (
                  <tr>
                    <td className="py-4 text-muted-foreground" colSpan={4}>
                      Loading users...
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td className="py-4 text-muted-foreground" colSpan={4}>
                      No users found.
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr
                      key={user.userId}
                      className={`border-b border-border ${usersPageLoading ? 'opacity-60' : ''}`}
                    >
                      <td className="py-3 text-foreground">{user.email}</td>
                      <td className="py-3 text-muted-foreground">{user.role}</td>
                      <td className="py-3">
                        {user.isSupporter ? (
                          <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                            Supporter
                          </span>
                        ) : (
                          <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                            Free
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-muted-foreground">{formatDate(user.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {!usersInitialLoading && usersTotal > USERS_PAGE_SIZE ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!canGoPrev}
                onClick={() =>
                  void fetchUsersPage(Math.max(0, usersOffset - USERS_PAGE_SIZE), 'page')
                }
                className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!canGoNext}
                onClick={() => void fetchUsersPage(usersOffset + USERS_PAGE_SIZE, 'page')}
                className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
              >
                Next
              </button>
              {usersPageLoading ? (
                <span className="text-sm text-muted-foreground">Loading…</span>
              ) : null}
            </div>
          ) : null}
          {usersError ? <p className="mt-4 text-sm text-red-600">{usersError}</p> : null}
        </div>
      </div>
    </div>
  );
}
