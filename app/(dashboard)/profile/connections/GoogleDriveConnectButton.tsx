'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Non-secret Google Drive settings used to prefill the edit form. */
export interface GoogleDriveExistingConnection {
  backupFolderPath: string;
  label: string;
}

interface GoogleDriveConnectButtonProps {
  label: string;
  className?: string;
  /** Required for edit mode; opens the backup folder settings form. */
  existingConnection: GoogleDriveExistingConnection;
  /** When true, opens the backup folder dialog once on mount (after OAuth connect). */
  autoOpen?: boolean;
}

/**
 * Opens an inline modal to edit Google Drive backup folder settings.
 * @param props - Button label, optional className, and existing connection settings.
 * @returns Edit button with modal form.
 */
export function GoogleDriveConnectButton({
  label,
  className,
  existingConnection,
  autoOpen = false,
}: GoogleDriveConnectButtonProps) {
  const router = useRouter();
  const didAutoOpenRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupFolderPath, setBackupFolderPath] = useState('');

  const resetForm = () => {
    setBackupFolderPath('');
    setError(null);
  };

  const loadExistingConnection = (connection: GoogleDriveExistingConnection) => {
    setBackupFolderPath(connection.backupFolderPath);
    setError(null);
  };

  const handleOpen = () => {
    loadExistingConnection(existingConnection);
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (submitting) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      resetForm();
    }
  };

  useEffect(() => {
    if (!autoOpen || didAutoOpenRef.current) return;
    didAutoOpenRef.current = true;
    loadExistingConnection(existingConnection);
    setOpen(true);

    const url = new URL(window.location.href);
    url.searchParams.delete('setup');
    window.history.replaceState(null, '', url.pathname + (url.search || ''));
  }, [autoOpen, existingConnection]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/platforms/connect/drive/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backupFolderPath: backupFolderPath.trim(),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: { message?: string };
        message?: string;
      };

      if (!response.ok || !payload.ok) {
        setError(
          payload.error?.message ?? payload.message ?? 'Failed to save Google Drive settings.'
        );
        return;
      }

      setOpen(false);
      resetForm();
      router.refresh();
    } catch {
      setError('Failed to save Google Drive settings. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button type="button" onClick={handleOpen} className={className}>
        {label}
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Google Drive backup folder</DialogTitle>
            <DialogDescription>
              Choose where VideoSphere stores backup uploads in{' '}
              <span className="font-medium text-foreground">{existingConnection.label}</span>. Leave
              empty to use My Drive root. Year subfolders from draft settings are created inside
              this folder.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="google-drive-backup-folder-path"
                className="text-sm font-medium text-foreground"
              >
                Backup folder path
              </label>
              <input
                id="google-drive-backup-folder-path"
                value={backupFolderPath}
                placeholder="Leave empty for My Drive root"
                onChange={(event) => setBackupFolderPath(event.target.value)}
                className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Optional path within My Drive, for example{' '}
                <span className="font-mono text-foreground">Backups</span> or{' '}
                <span className="font-mono text-foreground">Backups/Subfolder</span>. Folders are
                created if they do not exist yet.
              </p>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <DialogFooter>
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? 'Saving…' : 'Save'}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
