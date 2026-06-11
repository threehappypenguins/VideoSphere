'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { FacebookSetupSessionPublic } from '@/lib/platforms/facebook-setup-session';

/** Non-secret Facebook target settings used to prefill the setup form. */
export interface FacebookExistingConnection {
  targetType: 'page' | 'profile';
  pageId?: string;
  label: string;
}

interface FacebookConnectButtonProps {
  label: string;
  className?: string;
  /** When set, opens the target picker in edit mode with these values prefilled. */
  existingConnection?: FacebookExistingConnection;
  /** Setup metadata from the post-OAuth session (facebook-setup page). */
  setupSession?: FacebookSetupSessionPublic;
  /** When true, the target picker dialog opens immediately (facebook-setup page). */
  defaultOpen?: boolean;
}

type TargetSelection = `page:${string}`;

/**
 * Connects or edits a Facebook Page target.
 * On the setup page, renders a modal picker after OAuth. On the connections page,
 * "Edit" starts a fresh OAuth flow so Page tokens can be re-fetched.
 * @param props - Button label, styling, and optional setup or existing connection data.
 * @returns Connect / Edit button with optional target picker modal.
 */
export function FacebookConnectButton({
  label,
  className,
  existingConnection,
  setupSession,
  defaultOpen = false,
}: FacebookConnectButtonProps) {
  const router = useRouter();
  const isSetupFlow = setupSession != null;
  const isEditing = existingConnection != null;
  const [open, setOpen] = useState(defaultOpen && isSetupFlow);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialSelection = useMemo<TargetSelection | null>(() => {
    if (existingConnection?.targetType === 'page' && existingConnection.pageId) {
      return `page:${existingConnection.pageId}`;
    }
    const firstPage = setupSession?.pages[0];
    return firstPage ? (`page:${firstPage.id}` as TargetSelection) : null;
  }, [existingConnection, setupSession]);

  const [selection, setSelection] = useState<TargetSelection | null>(initialSelection);
  const hasPages = (setupSession?.pages.length ?? 0) > 0;

  const handleOpen = () => {
    if (isSetupFlow) {
      setSelection(initialSelection);
      setError(null);
      setOpen(true);
      return;
    }
    window.location.assign('/api/platforms/connect/facebook');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (submitting) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setError(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isSetupFlow || !selection) return;

    setSubmitting(true);
    setError(null);

    const pageId = selection.slice('page:'.length);

    try {
      const response = await fetch('/api/platforms/connect/facebook/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: 'page',
          pageId,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: { message?: string };
      };

      if (!response.ok || !payload.ok) {
        setError(payload.error?.message ?? 'Failed to save Facebook connection.');
        return;
      }

      setOpen(false);
      router.push('/profile/connections?success=facebook');
      router.refresh();
    } catch {
      setError('Failed to save Facebook connection. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const dialogTitle = isEditing ? 'Edit Facebook Connection' : 'Choose Facebook Page';
  const dialogDescription = isSetupFlow
    ? 'Select the Facebook Page VideoSphere should publish videos to.'
    : 'Reconnect Facebook to choose a different Page.';
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

      {isSetupFlow ? (
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
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-foreground">Facebook Page</legend>

                {setupSession.pages.length > 0 ? (
                  setupSession.pages.map((page) => {
                    const value = `page:${page.id}` as TargetSelection;
                    return (
                      <label
                        key={page.id}
                        aria-label={`Facebook Page — ${page.name}`}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/50"
                      >
                        <input
                          type="radio"
                          name="facebook-target"
                          value={value}
                          checked={selection === value}
                          onChange={() => setSelection(value)}
                          className="mt-1"
                        />
                        <span>
                          <span className="block text-sm font-medium text-foreground">
                            {page.name}
                          </span>
                          <span className="block text-sm text-muted-foreground">
                            Page ID: {page.id}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            Page access tokens do not expire.
                          </span>
                        </span>
                      </label>
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No managed Facebook Pages were returned for this account. Ensure you have admin
                    access to a Page, then try connecting again.
                  </p>
                )}
              </fieldset>

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
                  disabled={submitting || !hasPages || selection == null}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  {submitLabel}
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
