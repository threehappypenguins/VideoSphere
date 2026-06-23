'use client';

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { formatAutoPromoteToMainKeyMinutesLabel } from '@/lib/livestreams/auto-promote-main-key';
import { splitFacebookRtmpIngestUrl } from '@/lib/livestreams/facebook-rtmp-ingest';
import type { ApiResponse, Livestream, LivestreamStatus } from '@/types';

interface FacebookStreamKeyButtonProps {
  /** Livestream row id for arm/end API calls. */
  livestreamId: string;
  /** Current livestream lifecycle status. */
  status: LivestreamStatus;
  /** Facebook `LiveVideo` id when armed. */
  facebookLiveVideoId?: string;
  /** Stored RTMPS ingest URL when armed. */
  facebookStreamUrl?: string;
  /** True when this livestream is queued and waiting for automatic preparation. */
  isDeferredPending?: boolean;
  /** Minutes before start when automatic preparation runs. */
  preparationMinutes?: number;
  /** Called after arm/end succeeds with the updated livestream row. */
  onLivestreamUpdated: (livestream: Livestream) => void;
  /** Optional wrapper class name. */
  className?: string;
}

interface CopyableIngestFieldProps {
  /** Field label shown above the value. */
  label: string;
  /** Value copied to the clipboard. */
  value: string;
  /** DOM id for the read-only input. */
  inputId: string;
}

/**
 * Read-only ingest field with a copy-to-clipboard action.
 * @param props - Label, value, and input id.
 * @returns Labeled copy field for encoder setup.
 */
function CopyableIngestField({ label, value, inputId }: CopyableIngestFieldProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy to clipboard.');
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {label}
        </label>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <input
        id={inputId}
        type="text"
        readOnly
        value={value}
        className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
      />
    </div>
  );
}

/**
 * Per-livestream Facebook RTMPS ingest controls: copy server URL/key, and end stream.
 * The first scheduled Facebook livestream is armed automatically; queued streams wait for
 * automatic preparation before their ingest URL appears here.
 * @param props - Livestream identity, arm state, and update callback.
 * @returns Facebook stream key UI for a scheduled or live livestream row.
 */
export function FacebookStreamKeyButton({
  livestreamId,
  status,
  facebookLiveVideoId,
  facebookStreamUrl,
  isDeferredPending = false,
  preparationMinutes = 30,
  onLivestreamUpdated,
  className,
}: FacebookStreamKeyButtonProps) {
  const [arming, setArming] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [localIngest, setLocalIngest] = useState<{ serverUrl: string; streamKey: string } | null>(
    null
  );

  const storedIngest = useMemo(() => {
    if (!facebookStreamUrl?.trim()) {
      return null;
    }
    return splitFacebookRtmpIngestUrl(facebookStreamUrl);
  }, [facebookStreamUrl]);

  const ingest = localIngest ?? storedIngest;
  const isArmed = Boolean(facebookLiveVideoId?.trim());
  const showEndedBadge = status === 'ended' && isArmed;
  const preparationLabel = formatAutoPromoteToMainKeyMinutesLabel(preparationMinutes);

  const handleArm = useCallback(async () => {
    setArming(true);
    setError(null);
    setConflictWarning(null);

    try {
      const response = await fetch(`/api/livestreams/${livestreamId}/facebook-arm`, {
        method: 'POST',
      });
      const payload = (await response.json().catch(() => ({}))) as ApiResponse<Livestream> & {
        meta?: { conflictWarning?: string; serverUrl?: string; streamKey?: string };
        message?: string;
      };

      if (!response.ok) {
        setError(payload.message ?? 'Failed to prepare Facebook stream.');
        return;
      }

      if (payload.data) {
        onLivestreamUpdated(payload.data);
      }

      if (payload.meta?.serverUrl && payload.meta?.streamKey) {
        setLocalIngest({
          serverUrl: payload.meta.serverUrl,
          streamKey: payload.meta.streamKey,
        });
      }

      if (payload.meta?.conflictWarning) {
        setConflictWarning(payload.meta.conflictWarning);
      }

      toast.success(payload.message ?? 'Facebook stream prepared');
    } catch {
      setError('Failed to prepare Facebook stream. Please try again.');
    } finally {
      setArming(false);
    }
  }, [livestreamId, onLivestreamUpdated]);

  const handleEnd = useCallback(async () => {
    setEnding(true);
    setError(null);

    try {
      const response = await fetch(`/api/livestreams/${livestreamId}/facebook-end`, {
        method: 'POST',
      });
      const payload = (await response.json().catch(() => ({}))) as ApiResponse<Livestream> & {
        message?: string;
      };

      if (!response.ok) {
        setError(payload.message ?? 'Failed to end Facebook stream.');
        return;
      }

      if (payload.data) {
        onLivestreamUpdated(payload.data);
      }

      setLocalIngest(null);
      toast.success(payload.message ?? 'Facebook stream ended');
    } catch {
      setError('Failed to end Facebook stream. Please try again.');
    } finally {
      setEnding(false);
    }
  }, [livestreamId, onLivestreamUpdated]);

  if (showEndedBadge) {
    return (
      <div className={className}>
        <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          Streamed to Facebook
        </span>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className ?? ''}`}>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">Facebook stream key</h3>
        <p className="text-xs text-muted-foreground">
          {isDeferredPending
            ? `Your Facebook stream key will be created automatically ${preparationLabel}, after the earlier scheduled Facebook livestream ends.`
            : 'Use this single-use RTMPS ingest URL in your encoder when you go live.'}
        </p>
      </div>

      {!isArmed ? (
        isDeferredPending ? (
          <p
            className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
            role="status"
          >
            Waiting for automatic stream preparation.
          </p>
        ) : (
          <button
            type="button"
            onClick={() => void handleArm()}
            disabled={arming || ending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {arming ? 'Preparing…' : 'Prepare Facebook Stream Now'}
          </button>
        )
      ) : (
        <>
          {ingest ? (
            <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
              <CopyableIngestField
                inputId={`${livestreamId}-facebook-server-url`}
                label="Server URL"
                value={ingest.serverUrl}
              />
              <CopyableIngestField
                inputId={`${livestreamId}-facebook-stream-key`}
                label="Stream key"
                value={ingest.streamKey}
              />
              <p className="text-xs text-muted-foreground">
                This key is single-use — generated fresh for this stream. Paste it into your encoder
                now; preparing again will generate a different key.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Facebook ingest URL is unavailable. Try preparing again to regenerate the stream key.
            </p>
          )}

          {status === 'scheduled' || status === 'live' ? (
            <button
              type="button"
              onClick={() => void handleEnd()}
              disabled={arming || ending}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {ending ? 'Ending…' : 'End Facebook Stream'}
            </button>
          ) : null}
        </>
      )}

      {conflictWarning ? (
        <p
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          role="status"
        >
          {conflictWarning}
        </p>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
