'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { SftpAuthMethod } from '@/types';

interface SftpConnectButtonProps {
  label: string;
  className?: string;
}

/**
 * Opens an inline modal form to connect an SFTP backup destination.
 * @param props - Button label and optional className.
 * @returns Connect / Reconnect button with modal form.
 */
export function SftpConnectButton({ label, className }: SftpConnectButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [remotePath, setRemotePath] = useState('');
  const [authMethod, setAuthMethod] = useState<SftpAuthMethod>('key');
  const [credential, setCredential] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [connectionLabel, setConnectionLabel] = useState('');

  const resetForm = () => {
    setHost('');
    setPort('22');
    setUsername('');
    setRemotePath('');
    setAuthMethod('key');
    setCredential('');
    setPassphrase('');
    setConnectionLabel('');
    setError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    setOpen(false);
    resetForm();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const parsedPort = port.trim() === '' ? 22 : Number.parseInt(port, 10);
      const response = await fetch('/api/platforms/connect/sftp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: host.trim(),
          port: Number.isNaN(parsedPort) ? 22 : parsedPort,
          username: username.trim(),
          remotePath: remotePath.trim(),
          authMethod,
          credential,
          ...(authMethod === 'key' && passphrase.trim() ? { passphrase } : {}),
          label: connectionLabel.trim(),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: { message?: string; details?: string };
      };

      if (!response.ok || !payload.ok) {
        const message = payload.error?.message ?? 'Failed to connect SFTP server.';
        const details = payload.error?.details?.trim();
        setError(details ? `${message} ${details}` : message);
        return;
      }

      setOpen(false);
      resetForm();
      router.refresh();
    } catch {
      setError('Failed to connect SFTP server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90'
        }
      >
        {label}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close dialog"
            disabled={submitting}
            className="absolute inset-0 bg-black/50"
            onClick={handleClose}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sftp-connect-title"
            className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-lg"
          >
            <h2 id="sftp-connect-title" className="text-lg font-semibold text-foreground">
              Connect SFTP Server
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your SFTP server details. Credentials are stored encrypted and used only for
              server-side backups.
            </p>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="sftp-host" className="block text-sm font-medium text-foreground">
                  Host
                </label>
                <input
                  id="sftp-host"
                  type="text"
                  required
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  autoComplete="off"
                />
              </div>

              <div>
                <label htmlFor="sftp-port" className="block text-sm font-medium text-foreground">
                  Port
                </label>
                <input
                  id="sftp-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label
                  htmlFor="sftp-username"
                  className="block text-sm font-medium text-foreground"
                >
                  Username
                </label>
                <input
                  id="sftp-username"
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  autoComplete="username"
                />
              </div>

              <div>
                <label
                  htmlFor="sftp-remote-path"
                  className="block text-sm font-medium text-foreground"
                >
                  Remote path
                </label>
                <input
                  id="sftp-remote-path"
                  type="text"
                  required
                  placeholder="/backups"
                  value={remotePath}
                  onChange={(e) => setRemotePath(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>

              <div>
                <span className="block text-sm font-medium text-foreground">Auth method</span>
                <div className="mt-2 flex gap-4">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="sftp-auth-method"
                      value="key"
                      checked={authMethod === 'key'}
                      onChange={() => setAuthMethod('key')}
                    />
                    Key
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="sftp-auth-method"
                      value="password"
                      checked={authMethod === 'password'}
                      onChange={() => setAuthMethod('password')}
                    />
                    Password
                  </label>
                </div>
              </div>

              <div>
                <label
                  htmlFor="sftp-credential"
                  className="block text-sm font-medium text-foreground"
                >
                  {authMethod === 'key' ? 'Private key' : 'Password'}
                </label>
                {authMethod === 'key' ? (
                  <textarea
                    id="sftp-credential"
                    required
                    rows={6}
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    autoComplete="off"
                  />
                ) : (
                  <input
                    id="sftp-credential"
                    type="password"
                    required
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    autoComplete="current-password"
                  />
                )}
              </div>

              {authMethod === 'key' ? (
                <div>
                  <label
                    htmlFor="sftp-passphrase"
                    className="block text-sm font-medium text-foreground"
                  >
                    Passphrase (optional)
                  </label>
                  <input
                    id="sftp-passphrase"
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    autoComplete="off"
                  />
                </div>
              ) : null}

              <div>
                <label htmlFor="sftp-label" className="block text-sm font-medium text-foreground">
                  Label
                </label>
                <input
                  id="sftp-label"
                  type="text"
                  required
                  placeholder="My Home Server"
                  value={connectionLabel}
                  onChange={(e) => setConnectionLabel(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>

              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={submitting}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  {submitting ? 'Connecting…' : 'Connect'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
