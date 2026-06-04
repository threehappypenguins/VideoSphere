'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Non-secret SMB settings used to prefill the connect/edit form. */
export interface SmbExistingConnection {
  host: string;
  share: string;
  domain: string;
  username: string;
  remotePath: string;
  label: string;
}

interface SmbConnectButtonProps {
  label: string;
  className?: string;
  /** When set, opens the form in edit mode with these values prefilled. */
  existingConnection?: SmbExistingConnection;
}

/**
 * Opens an inline modal form to connect or edit an SMB/CIFS backup destination.
 * @param props - Button label, optional className, and optional existing connection settings.
 * @returns Connect / Edit button with modal form.
 */
export function SmbConnectButton({ label, className, existingConnection }: SmbConnectButtonProps) {
  const router = useRouter();
  const isEditing = existingConnection != null;
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [host, setHost] = useState('');
  const [share, setShare] = useState('');
  const [domain, setDomain] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remotePath, setRemotePath] = useState('/');
  const [connectionLabel, setConnectionLabel] = useState('');

  const resetForm = () => {
    setHost('');
    setShare('');
    setDomain('');
    setUsername('');
    setPassword('');
    setShowPassword(false);
    setRemotePath('/');
    setConnectionLabel('');
    setError(null);
  };

  const loadExistingConnection = (connection: SmbExistingConnection) => {
    setHost(connection.host);
    setShare(connection.share);
    setDomain(connection.domain);
    setUsername(connection.username);
    setRemotePath(connection.remotePath);
    setPassword('');
    setShowPassword(false);
    setConnectionLabel(connection.label);
    setError(null);
  };

  const handleOpen = () => {
    if (existingConnection) {
      loadExistingConnection(existingConnection);
    } else {
      resetForm();
    }
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (submitting) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      resetForm();
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const passwordProvided = password.trim().length > 0;
      const response = await fetch('/api/platforms/connect/smb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: host.trim(),
          share: share.trim(),
          ...(domain.trim() ? { domain: domain.trim() } : {}),
          username: username.trim(),
          remotePath: remotePath.trim(),
          ...(passwordProvided ? { password } : {}),
          label: connectionLabel.trim(),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: { message?: string; details?: string };
      };

      if (!response.ok || !payload.ok) {
        const message = payload.error?.message ?? 'Failed to save SMB connection.';
        const rawDetails = payload.error?.details;
        const details =
          typeof rawDetails === 'string'
            ? rawDetails.trim()
            : rawDetails != null
              ? JSON.stringify(rawDetails)
              : '';
        setError(details ? `${message} (${details})` : message);
        return;
      }

      setOpen(false);
      resetForm();
      router.refresh();
    } catch {
      setError('Failed to save SMB connection. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const dialogTitle = isEditing ? 'Edit SMB Share' : 'Connect SMB Share';
  const dialogDescription = isEditing
    ? 'Update your SMB share settings. Leave the password blank to keep the stored credential.'
    : 'Enter your NAS or Windows share details. Credentials are stored encrypted and used only for server-side backups.';
  const submitLabel = submitting ? 'Saving…' : isEditing ? 'Save changes' : 'Connect';

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={
          className ??
          'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90'
        }
      >
        {label}
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="max-h-[90vh] max-w-lg overflow-y-auto"
          onPointerDownOutside={(event) => {
            if (submitting) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (submitting) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="smb-label" className="block text-sm font-medium text-foreground">
                Label
              </label>
              <input
                id="smb-label"
                type="text"
                required
                placeholder="My NAS Backups"
                value={connectionLabel}
                onChange={(e) => setConnectionLabel(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="smb-host" className="block text-sm font-medium text-foreground">
                Host
              </label>
              <input
                id="smb-host"
                type="text"
                required
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.10"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                autoComplete="off"
              />
            </div>

            <div>
              <label htmlFor="smb-share" className="block text-sm font-medium text-foreground">
                Share
              </label>
              <input
                id="smb-share"
                type="text"
                required
                placeholder="Storage"
                value={share}
                onChange={(e) => setShare(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                autoComplete="off"
              />
            </div>

            <div>
              <label htmlFor="smb-domain" className="block text-sm font-medium text-foreground">
                Domain / workgroup (optional)
              </label>
              <input
                id="smb-domain"
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="WORKGROUP (used when blank on Samba)"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Leave blank for the usual Samba default (<code className="text-xs">WORKGROUP</code>
                ), as shown by smbclient. Use your AD domain name on Windows domains.
              </p>
            </div>

            <div>
              <label htmlFor="smb-username" className="block text-sm font-medium text-foreground">
                Username
              </label>
              <input
                id="smb-username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                autoComplete="username"
              />
            </div>

            <div>
              <label htmlFor="smb-password" className="block text-sm font-medium text-foreground">
                Password
              </label>
              <div className="relative mt-1">
                <input
                  id="smb-password"
                  type={showPassword ? 'text' : 'password'}
                  required={!isEditing}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 pr-11 text-sm"
                  placeholder={isEditing ? 'Leave blank to keep the stored password' : undefined}
                  autoComplete="current-password"
                  disabled={submitting}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  aria-controls="smb-password"
                  disabled={submitting}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="smb-remote-path"
                className="block text-sm font-medium text-foreground"
              >
                Remote path
              </label>
              <input
                id="smb-remote-path"
                type="text"
                required
                placeholder="/VideoSphere"
                value={remotePath}
                onChange={(e) => setRemotePath(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>

            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <DialogFooter className="gap-2 pt-2">
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
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
                {submitLabel}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
