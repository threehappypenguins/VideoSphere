'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Non-secret YouTube stream key presence flags used to prefill the edit form. */
export interface YouTubeStreamKeysExistingConnection {
  hasMainStreamKey: boolean;
  hasTempStreamKey: boolean;
}

interface YouTubeStreamKeysButtonProps {
  label: string;
  className?: string;
  /** Required for edit mode; opens the stream key settings form. */
  existingConnection: YouTubeStreamKeysExistingConnection;
}

/**
 * Opens an inline modal to edit YouTube main and temporary stream keys.
 * @param props - Button label, optional className, and existing key presence flags.
 * @returns Edit button with modal form.
 */
export function YouTubeStreamKeysButton({
  label,
  className,
  existingConnection,
}: YouTubeStreamKeysButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mainStreamKey, setMainStreamKey] = useState('');
  const [tempStreamKey, setTempStreamKey] = useState('');
  const [clearMainStreamKey, setClearMainStreamKey] = useState(false);
  const [clearTempStreamKey, setClearTempStreamKey] = useState(false);

  const resetForm = () => {
    setMainStreamKey('');
    setTempStreamKey('');
    setClearMainStreamKey(false);
    setClearTempStreamKey(false);
    setError(null);
  };

  const handleOpen = () => {
    resetForm();
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

    const body: { mainStreamKey?: string; tempStreamKey?: string } = {};
    const trimmedMain = mainStreamKey.trim();
    const trimmedTemp = tempStreamKey.trim();

    if (trimmedMain !== '') {
      body.mainStreamKey = trimmedMain;
    } else if (clearMainStreamKey) {
      body.mainStreamKey = '';
    }

    if (trimmedTemp !== '') {
      body.tempStreamKey = trimmedTemp;
    } else if (clearTempStreamKey) {
      body.tempStreamKey = '';
    }

    if (!('mainStreamKey' in body) && !('tempStreamKey' in body)) {
      setError('Enter a new key or clear a stored key before saving.');
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch('/api/platforms/connect/youtube/stream-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: { message?: string };
        message?: string;
      };

      if (!response.ok || !payload.ok) {
        setError(
          payload.error?.message ?? payload.message ?? 'Failed to save YouTube stream keys.'
        );
        return;
      }

      setOpen(false);
      resetForm();
      router.refresh();
    } catch {
      setError('Failed to save YouTube stream keys. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const hasPendingChanges =
    mainStreamKey.trim() !== '' ||
    tempStreamKey.trim() !== '' ||
    clearMainStreamKey ||
    clearTempStreamKey;

  return (
    <>
      <button type="button" onClick={handleOpen} className={className}>
        {label}
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>YouTube stream keys</DialogTitle>
            <DialogDescription>
              Optional — only needed if you livestream to YouTube. Uploading videos does not require
              stream keys. The first scheduled livestream uses your main key. Every livestream after
              that uses the temporary key until the previous one ends.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="youtube-main-stream-key"
                  className="text-sm font-medium text-foreground"
                >
                  Main stream key
                </label>
                {existingConnection.hasMainStreamKey && !clearMainStreamKey ? (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setClearMainStreamKey(true);
                      setMainStreamKey('');
                    }}
                    className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                  >
                    Clear stored key
                  </button>
                ) : null}
              </div>
              <input
                id="youtube-main-stream-key"
                type="password"
                value={mainStreamKey}
                autoComplete="off"
                disabled={submitting}
                placeholder={
                  clearMainStreamKey
                    ? 'Stored key will be removed on save'
                    : existingConnection.hasMainStreamKey
                      ? 'Leave blank to keep the stored key'
                      : 'Enter your main stream key'
                }
                onChange={(event) => {
                  setMainStreamKey(event.target.value);
                  if (event.target.value.trim() !== '') {
                    setClearMainStreamKey(false);
                  }
                }}
                className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
              />
              {clearMainStreamKey ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  The stored main key will be removed when you save.{' '}
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setClearMainStreamKey(false)}
                    className="font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    Undo
                  </button>
                </p>
              ) : null}
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="youtube-temp-stream-key"
                  className="text-sm font-medium text-foreground"
                >
                  Temporary stream key
                </label>
                {existingConnection.hasTempStreamKey && !clearTempStreamKey ? (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setClearTempStreamKey(true);
                      setTempStreamKey('');
                    }}
                    className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                  >
                    Clear stored key
                  </button>
                ) : null}
              </div>
              <input
                id="youtube-temp-stream-key"
                type="password"
                value={tempStreamKey}
                autoComplete="off"
                disabled={submitting}
                placeholder={
                  clearTempStreamKey
                    ? 'Stored key will be removed on save'
                    : existingConnection.hasTempStreamKey
                      ? 'Leave blank to keep the stored key'
                      : 'Enter your temporary stream key'
                }
                onChange={(event) => {
                  setTempStreamKey(event.target.value);
                  if (event.target.value.trim() !== '') {
                    setClearTempStreamKey(false);
                  }
                }}
                className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
              />
              {clearTempStreamKey ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  The stored temporary key will be removed when you save.{' '}
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setClearTempStreamKey(false)}
                    className="font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    Undo
                  </button>
                </p>
              ) : null}
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
                disabled={submitting || !hasPendingChanges}
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
