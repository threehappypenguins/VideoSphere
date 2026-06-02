'use client';

import { useCallback, useEffect, useState } from 'react';
import type { UserRole } from '@/types';

interface AdminInviteRow {
  token: string;
  grantedRole: UserRole;
  createdBy?: string;
  createdAt: string;
  expiresAt?: string;
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function inviteStatus(_invite: AdminInviteRow): string {
  return 'Pending';
}

function roleLabel(role: UserRole): string {
  return role === 'admin' ? 'Admin' : 'User';
}

/**
 * Builds the full invite signup URL for a token.
 * @param token - Invite token id.
 * @returns Absolute invite URL when running in the browser; otherwise a relative path.
 */
function buildInviteUrl(token: string): string {
  const path = `/invite/${encodeURIComponent(token)}`;
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

/**
 * Admin invite management section with role selection when creating links.
 * @returns The rendered invite management UI.
 */
export function InvitesSection() {
  const [invites, setInvites] = useState<AdminInviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latestInviteUrl, setLatestInviteUrl] = useState<string | null>(null);
  const [latestInviteToken, setLatestInviteToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<UserRole>('user');

  const loadInvites = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/invites');
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? 'Failed to load invites');
      }
      const payload = (await res.json()) as { data: { invites: AdminInviteRow[] } };
      setInvites(payload.data.invites);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load invites');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  const handleCreateInvite = async () => {
    setCreating(true);
    setError(null);
    setCopiedToken(null);
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: inviteRole }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        throw new Error(payload.message ?? payload.error ?? 'Failed to create invite');
      }
      const payload = (await res.json()) as { data: { inviteUrl: string; token: string } };
      setLatestInviteUrl(payload.data.inviteUrl);
      setLatestInviteToken(payload.data.token);
      await loadInvites();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (token: string) => {
    setRevokingToken(token);
    setError(null);
    try {
      const res = await fetch(`/api/admin/invites/${encodeURIComponent(token)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(payload.message ?? payload.error ?? 'Failed to revoke invite');
      }
      if (latestInviteToken === token) {
        setLatestInviteUrl(null);
        setLatestInviteToken(null);
      }
      await loadInvites();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to revoke invite');
    } finally {
      setRevokingToken(null);
    }
  };

  const handleCopyInviteUrl = async (token: string, inviteUrl: string) => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedToken(token);
    } catch {
      setError('Could not copy invite link to clipboard.');
    }
  };

  return (
    <section
      id="invites"
      aria-labelledby="users-invites-heading"
      className="mt-8 rounded-xl border border-border bg-background p-6"
    >
      <h2 id="users-invites-heading" className="text-xl font-semibold text-foreground">
        Invite links
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Generate single-use links to invite new users. Used links are removed automatically.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="invite-role" className="block text-sm font-medium text-foreground">
            Role for new user
          </label>
          <select
            id="invite-role"
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value as UserRole)}
            className="mt-2 block rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button
          type="button"
          disabled={creating}
          onClick={() => void handleCreateInvite()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {creating ? 'Generating…' : 'Generate invite link'}
        </button>
      </div>

      {latestInviteUrl ? (
        <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-sm font-medium text-foreground">New invite link</p>
          <p className="mt-2 break-all text-sm text-muted-foreground">{latestInviteUrl}</p>
          {latestInviteToken ? (
            <button
              type="button"
              onClick={() => void handleCopyInviteUrl(latestInviteToken, latestInviteUrl)}
              className="mt-3 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {copiedToken === latestInviteToken ? 'Copied' : 'Copy link'}
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

      <div className="mt-6 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-3 font-medium text-muted-foreground">Invite link</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Role</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Created</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Expires</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-4 text-muted-foreground" colSpan={6}>
                  Loading invites…
                </td>
              </tr>
            ) : invites.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-muted-foreground" colSpan={6}>
                  No pending invites. Generate one to get started.
                </td>
              </tr>
            ) : (
              invites.map((invite) => {
                const status = inviteStatus(invite);
                const canRevoke = status === 'Pending';
                const inviteUrl = buildInviteUrl(invite.token);
                return (
                  <tr key={invite.token} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3">
                      <p className="max-w-md break-all text-muted-foreground">{inviteUrl}</p>
                      <button
                        type="button"
                        onClick={() => void handleCopyInviteUrl(invite.token, inviteUrl)}
                        className="mt-2 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
                      >
                        {copiedToken === invite.token ? 'Copied' : 'Copy link'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-foreground">{status}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {roleLabel(invite.grantedRole)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(invite.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(invite.expiresAt)}
                    </td>
                    <td className="px-4 py-3">
                      {canRevoke ? (
                        <button
                          type="button"
                          disabled={revokingToken === invite.token}
                          onClick={() => void handleRevoke(invite.token)}
                          className="text-sm font-medium text-destructive hover:text-destructive/80 disabled:opacity-50"
                        >
                          {revokingToken === invite.token ? 'Revoking…' : 'Revoke'}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
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
