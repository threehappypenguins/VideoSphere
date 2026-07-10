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

/** Non-secret SermonAudio settings used to prefill the connect/edit form. */
export interface SermonAudioExistingConnection {
  broadcasterID: string;
  label: string;
}

interface SermonAudioConnectButtonProps {
  label: string;
  className?: string;
  /** When set, opens the form in edit mode with these values prefilled. */
  existingConnection?: SermonAudioExistingConnection;
}

/**
 * Opens an inline modal form to connect or edit a SermonAudio account.
 * @param props - Button label, optional className, and optional existing connection settings.
 * @returns Connect / Edit button with modal form.
 */
export function SermonAudioConnectButton({
  label,
  className,
  existingConnection,
}: SermonAudioConnectButtonProps) {
  const router = useRouter();
  const isEditing = existingConnection != null;
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [apiKey, setApiKey] = useState('');
  const [broadcasterID, setBroadcasterID] = useState('');
  const [connectionLabel, setConnectionLabel] = useState('');

  const resetForm = () => {
    setApiKey('');
    setBroadcasterID('');
    setConnectionLabel('');
    setError(null);
  };

  const loadExistingConnection = (connection: SermonAudioExistingConnection) => {
    setApiKey('');
    setBroadcasterID(connection.broadcasterID);
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
      const trimmedBroadcasterID = broadcasterID.trim();
      const trimmedLabel = connectionLabel.trim();
      const response = await fetch('/api/platforms/connect/sermon-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          broadcasterID: trimmedBroadcasterID,
          ...(trimmedLabel ? { label: trimmedLabel } : {}),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: { message?: string; details?: string };
      };

      if (!response.ok || !payload.ok) {
        const message = payload.error?.message ?? 'Failed to save SermonAudio connection.';
        const details = payload.error?.details?.trim();
        setError(details ? `${message} ${details}` : message);
        return;
      }

      setOpen(false);
      resetForm();
      router.refresh();
    } catch {
      setError('Failed to save SermonAudio connection. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const dialogTitle = isEditing ? 'Edit SermonAudio Account' : 'Connect SermonAudio Account';
  const dialogDescription = isEditing
    ? 'Update your SermonAudio API key and broadcaster settings. Re-enter your API key to save changes.'
    : 'Enter your SermonAudio API key and broadcaster ID. Credentials are stored encrypted and used only for server-side uploads.';
  const submitLabel = submitting ? 'Saving…' : isEditing ? 'Save changes' : 'Connect';
  const labelPlaceholder = broadcasterID.trim() || 'Broadcaster ID';

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={
          className ??
          'inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90'
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
              <label
                htmlFor="sermon-audio-api-key"
                className="block text-sm font-medium text-foreground"
              >
                API Key
              </label>
              <input
                id="sermon-audio-api-key"
                type="password"
                required
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                autoComplete="off"
              />
            </div>

            <div>
              <label
                htmlFor="sermon-audio-broadcaster-id"
                className="block text-sm font-medium text-foreground"
              >
                Broadcaster ID
              </label>
              <input
                id="sermon-audio-broadcaster-id"
                type="text"
                required
                value={broadcasterID}
                onChange={(e) => setBroadcasterID(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                autoComplete="off"
              />
            </div>

            <div>
              <label
                htmlFor="sermon-audio-label"
                className="block text-sm font-medium text-foreground"
              >
                Label
              </label>
              <input
                id="sermon-audio-label"
                type="text"
                placeholder={labelPlaceholder}
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
