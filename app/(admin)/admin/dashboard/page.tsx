'use client';

import { useEffect, useState } from 'react';

interface AdminStats {
  totalUsers: number;
  totalSupporters: number;
  uploadsThisMonth: number;
  activeDrafts: number;
}

interface AdminUser {
  email: string;
  role: 'user' | 'admin';
  isSupporter: boolean;
  createdAt: string;
}

interface UsersResponseData {
  users: AdminUser[];
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

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setStatsLoading(true);
      setUsersLoading(true);
      setStatsError(null);
      setUsersError(null);

      const statsPromise = fetch('/api/admin/stats')
        .then(async (res) => {
          if (!res.ok) {
            const payload = (await res.json().catch(() => ({}))) as { message?: string };
            throw new Error(payload.message ?? 'Failed to load admin stats');
          }
          return res.json() as Promise<{ data: StatsResponseData }>;
        })
        .then((payload) => {
          setStats(payload.data);
        })
        .catch((error: unknown) => {
          setStatsError(error instanceof Error ? error.message : 'Failed to load admin stats');
        })
        .finally(() => setStatsLoading(false));

      const usersPromise = fetch('/api/admin/users?limit=50&offset=0')
        .then(async (res) => {
          if (!res.ok) {
            const payload = (await res.json().catch(() => ({}))) as { message?: string };
            throw new Error(payload.message ?? 'Failed to load users');
          }
          return res.json() as Promise<{ data: UsersResponseData }>;
        })
        .then((payload) => {
          setUsers(payload.data.users);
        })
        .catch((error: unknown) => {
          setUsersError(error instanceof Error ? error.message : 'Failed to load users');
        })
        .finally(() => setUsersLoading(false));

      await Promise.all([statsPromise, usersPromise]);
    };

    void load();
  }, []);

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
          <h2 className="text-xl font-semibold text-foreground">Users</h2>
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
                    <tr key={`${user.email}-${user.createdAt}`} className="border-b border-border">
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
          {usersError ? <p className="mt-4 text-sm text-red-600">{usersError}</p> : null}
        </div>
      </div>
    </div>
  );
}
