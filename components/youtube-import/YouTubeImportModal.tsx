'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { CircleCheck, Loader2 } from 'lucide-react';
import { formatVideoDuration } from '@/lib/format-video-duration';
import { getLivestreamListThumbnailUrl } from '@/lib/livestreams/youtube-thumbnail-preview';
import { formatScheduledDateTime } from '@/components/livestreams/LivestreamsListTable';
import { TrimRangeSlider } from '@/components/youtube-import/TrimRangeSlider';
import {
  YouTubePreviewPlayer,
  type YouTubePlayerHandle,
} from '@/components/youtube-import/YouTubePreviewPlayer';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  formatYoutubeImportStatusLabel,
  isActiveYoutubeImportStatus,
} from '@/lib/youtube-import/import-job-ui';
import type { ApiResponse, Livestream, YoutubeImportJob } from '@/types';

/** Poll interval for in-flight import jobs (matches draft upload polling). */
const IMPORT_JOB_POLL_INTERVAL_MS = 3000;

/** Page size for streamed livestream history in the YouTube import source picker. */
const LIVESTREAM_IMPORT_PAGE_SIZE = 2;

/**
 * Modal step identifiers for the YouTube import flow.
 */
type YouTubeImportModalStep = 'source' | 'editor' | 'progress';

/**
 * Resolved YouTube source metadata from the resolve API.
 */
interface ResolvedYouTubeSource {
  youtubeVideoId: string;
  title: string;
  durationSeconds: number;
  thumbnailUrl: string;
  previewStreamUrl: string;
  previewExpiresAt: number;
  sourceUrl?: string;
  livestreamId?: string;
}

interface LivestreamsListResponse extends ApiResponse<Livestream[]> {
  meta?: {
    total: number;
    limit: number;
    offset: number;
  };
}

/**
 * Props for {@link YouTubeImportModal}.
 */
export interface YouTubeImportModalProps {
  /** Draft that will receive the imported video. */
  draftId: string;
  /** Whether the modal is open. */
  open: boolean;
  /**
   * Called when the modal open state changes.
   * @param open - Next open state.
   */
  onOpenChange: (open: boolean) => void;
  /**
   * Called when import staging completes so the parent can refresh draft import state.
   */
  onImportComplete: () => void | Promise<void>;
}

/**
 * Modal for importing and trimming a YouTube video into a draft.
 * @param props - Modal configuration.
 * @returns YouTube import modal UI.
 */
export function YouTubeImportModal({
  draftId,
  open,
  onOpenChange,
  onImportComplete,
}: YouTubeImportModalProps) {
  const [step, setStep] = useState<YouTubeImportModalStep>('source');
  const [resolvedSource, setResolvedSource] = useState<ResolvedYouTubeSource | null>(null);
  const [trimRange, setTrimRange] = useState({ startSeconds: 0, endSeconds: 0 });
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<YoutubeImportJob | null>(null);

  const [sourceUrlInput, setSourceUrlInput] = useState('');
  const [livestreams, setLivestreams] = useState<Livestream[]>([]);
  const [livestreamsTotal, setLivestreamsTotal] = useState(0);
  const [isLoadingLivestreams, setIsLoadingLivestreams] = useState(false);
  const [isCheckingActiveJob, setIsCheckingActiveJob] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelImportConfirm, setShowCancelImportConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conflictActiveJobId, setConflictActiveJobId] = useState<string | null>(null);
  const [showCompletionSuccess, setShowCompletionSuccess] = useState(false);
  const [showVideoPreview, setShowVideoPreview] = useState(true);
  const [enableSmartCut, setEnableSmartCut] = useState(true);

  const playerRef = useRef<YouTubePlayerHandle | null>(null);
  const playerHandle = useMemo<YouTubePlayerHandle>(
    () => ({
      previewAt(seconds: number) {
        playerRef.current?.previewAt(seconds);
      },
      getCurrentTime() {
        return playerRef.current?.getCurrentTime() ?? 0;
      },
    }),
    []
  );
  const completionHandledRef = useRef(false);

  const resetModalState = useCallback(() => {
    setStep('source');
    setResolvedSource(null);
    setTrimRange({ startSeconds: 0, endSeconds: 0 });
    setJobId(null);
    setJobStatus(null);
    setSourceUrlInput('');
    setLivestreams([]);
    setLivestreamsTotal(0);
    setErrorMessage(null);
    setConflictActiveJobId(null);
    setShowCompletionSuccess(false);
    setShowVideoPreview(true);
    setEnableSmartCut(true);
    setIsResolving(false);
    setIsStarting(false);
    setIsCancelling(false);
    setShowCancelImportConfirm(false);
    completionHandledRef.current = false;
  }, []);

  const handleDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        const importInFlight =
          step === 'progress' && jobStatus && isActiveYoutubeImportStatus(jobStatus.status);
        if (!importInFlight) {
          resetModalState();
        }
      }
      onOpenChange(nextOpen);
    },
    [jobStatus, onOpenChange, resetModalState, step]
  );

  const loadLivestreams = useCallback(async (offset: number, options?: { append?: boolean }) => {
    const append = options?.append ?? false;
    setIsLoadingLivestreams(true);
    try {
      const response = await fetch(
        `/api/livestreams?status=streamed&for=youtube-import&limit=${LIVESTREAM_IMPORT_PAGE_SIZE}&offset=${offset}`,
        { cache: 'no-store' }
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? 'Failed to load past livestreams');
      }

      const payload = (await response.json()) as LivestreamsListResponse;
      const rows = Array.isArray(payload.data) ? payload.data : [];
      setLivestreams((current) => (append ? [...current, ...rows] : rows));
      setLivestreamsTotal(payload.meta?.total ?? rows.length);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load past livestreams');
      if (!options?.append) {
        setLivestreams([]);
        setLivestreamsTotal(0);
      }
    } finally {
      setIsLoadingLivestreams(false);
    }
  }, []);

  const resolveSource = useCallback(
    async (body: { sourceUrl: string } | { livestreamId: string }) => {
      setIsResolving(true);
      setErrorMessage(null);
      setConflictActiveJobId(null);

      try {
        const response = await fetch('/api/youtube-import/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const payload = (await response.json().catch(() => null)) as
          | ApiResponse<{
              youtubeVideoId: string;
              title: string;
              durationSeconds: number;
              thumbnailUrl: string;
              previewStreamUrl: string;
              previewExpiresAt: number;
            }>
          | { message?: string }
          | null;

        if (!response.ok || !payload || !('data' in payload) || !payload.data) {
          throw new Error(
            payload && 'message' in payload && payload.message
              ? payload.message
              : 'Failed to resolve YouTube source'
          );
        }

        const resolved: ResolvedYouTubeSource = {
          ...payload.data,
          ...('sourceUrl' in body ? { sourceUrl: body.sourceUrl } : {}),
          ...('livestreamId' in body ? { livestreamId: body.livestreamId } : {}),
        };

        setResolvedSource(resolved);
        setTrimRange({ startSeconds: 0, endSeconds: resolved.durationSeconds });
        setStep('editor');
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : 'Failed to resolve YouTube source'
        );
      } finally {
        setIsResolving(false);
      }
    },
    []
  );

  const handleUsePastedLink = useCallback(async () => {
    const sourceUrl = sourceUrlInput.trim();
    if (!sourceUrl) {
      setErrorMessage('Enter a YouTube URL to continue.');
      return;
    }
    await resolveSource({ sourceUrl });
  }, [resolveSource, sourceUrlInput]);

  const handleSelectLivestream = useCallback(
    async (livestreamId: string) => {
      await resolveSource({ livestreamId });
    },
    [resolveSource]
  );

  const handleStartImport = useCallback(async () => {
    if (!resolvedSource) return;

    setIsStarting(true);
    setErrorMessage(null);
    setConflictActiveJobId(null);

    try {
      const response = await fetch('/api/youtube-import/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId,
          youtubeVideoId: resolvedSource.youtubeVideoId,
          livestreamId: resolvedSource.livestreamId,
          sourceUrl: resolvedSource.sourceUrl,
          startSeconds: trimRange.startSeconds,
          endSeconds: trimRange.endSeconds,
          smartCut: enableSmartCut,
        }),
      });

      const payload = (await response.json().catch(() => null)) as {
        jobId?: string;
        activeJobId?: string | null;
        message?: string;
      } | null;

      if (response.status === 409) {
        setConflictActiveJobId(payload?.activeJobId ?? null);
        setErrorMessage(null);
        return;
      }

      if (!response.ok || !payload?.jobId) {
        throw new Error(payload?.message ?? 'Failed to start YouTube import');
      }

      setJobId(payload.jobId);
      setStep('progress');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to start YouTube import');
    } finally {
      setIsStarting(false);
    }
  }, [draftId, enableSmartCut, resolvedSource, trimRange.endSeconds, trimRange.startSeconds]);

  const handleWatchExistingImport = useCallback(() => {
    if (!conflictActiveJobId) return;
    setJobId(conflictActiveJobId);
    setConflictActiveJobId(null);
    setErrorMessage(null);
    setStep('progress');
  }, [conflictActiveJobId]);

  const handleRetryAfterFailure = useCallback(() => {
    setStep('source');
    setResolvedSource(null);
    setJobId(null);
    setJobStatus(null);
    setErrorMessage(null);
    setShowCompletionSuccess(false);
    completionHandledRef.current = false;
    void loadLivestreams(0);
  }, [loadLivestreams]);

  const handleCancelImport = useCallback(async () => {
    if (!jobId) return;

    setIsCancelling(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/youtube-import/${jobId}/cancel`, { method: 'POST' });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? 'Failed to cancel import');
      }
      setShowCancelImportConfirm(false);
      handleRetryAfterFailure();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to cancel import');
    } finally {
      setIsCancelling(false);
    }
  }, [handleRetryAfterFailure, jobId]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setIsCheckingActiveJob(true);

    void (async () => {
      try {
        const response = await fetch('/api/youtube-import/active', { cache: 'no-store' });
        if (!response.ok || cancelled) return;

        const payload = (await response.json()) as { job: YoutubeImportJob | null };
        if (payload.job) {
          setJobId(payload.job.id);
          setJobStatus(payload.job);
          setStep('progress');
        }
      } catch {
        if (!cancelled) {
          setErrorMessage('Failed to check for an active import job');
        }
      } finally {
        if (!cancelled) {
          setIsCheckingActiveJob(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || step !== 'source' || jobId) return;
    void loadLivestreams(0);
  }, [jobId, loadLivestreams, open, step]);

  useEffect(() => {
    if (!open || step !== 'progress' || !jobId) return;

    let disposed = false;
    const controller = new AbortController();

    const pollJob = async () => {
      try {
        const response = await fetch(`/api/youtube-import/${jobId}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok || disposed) return;

        const payload = (await response.json()) as ApiResponse<YoutubeImportJob>;
        if (!payload.data || disposed) return;

        setJobStatus(payload.data);
      } catch {
        if (controller.signal.aborted || disposed) return;
      }
    };

    void pollJob();
    const intervalId = window.setInterval(() => {
      void pollJob();
    }, IMPORT_JOB_POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [jobId, open, step]);

  useEffect(() => {
    if (!jobStatus || jobStatus.status !== 'completed' || completionHandledRef.current) {
      return;
    }

    completionHandledRef.current = true;
    setShowCompletionSuccess(true);
    void onImportComplete();
  }, [jobStatus, onImportComplete]);

  const canShowMoreLivestreams = livestreams.length < livestreamsTotal;

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import from YouTube</DialogTitle>
          <DialogDescription>
            {step === 'source'
              ? 'Paste a YouTube link or choose a past livestream to import into this draft.'
              : step === 'editor'
                ? showVideoPreview
                  ? 'Preview the source and choose the section to import.'
                  : 'Choose the section to import using the trim handles below.'
                : 'Your import is running in the background.'}
          </DialogDescription>
        </DialogHeader>

        {errorMessage ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}

        {conflictActiveJobId ? (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <p>You already have an import in progress.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={handleWatchExistingImport}
            >
              Watch existing import
            </Button>
          </div>
        ) : null}

        {isCheckingActiveJob ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking for an in-progress import…
          </div>
        ) : null}

        {step === 'source' && !isCheckingActiveJob ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="youtube-import-source-url">YouTube link</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="youtube-import-source-url"
                  value={sourceUrlInput}
                  onChange={(event) => setSourceUrlInput(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                  disabled={isResolving}
                />
                <Button
                  type="button"
                  onClick={() => {
                    void handleUsePastedLink();
                  }}
                  disabled={isResolving || sourceUrlInput.trim() === ''}
                >
                  {isResolving ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Resolving…
                    </>
                  ) : (
                    'Use this link'
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-medium text-foreground">Pick a past livestream</h3>
                <p className="text-xs text-muted-foreground">
                  Completed broadcasts from your VideoSphere livestream history.
                </p>
              </div>

              {isLoadingLivestreams ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading livestreams…
                </div>
              ) : livestreams.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No past YouTube livestreams are available to import. Only ended VideoSphere
                  livestreams that were scheduled on YouTube appear here.
                </p>
              ) : (
                <ul className="space-y-2">
                  {livestreams.map((livestream) => {
                    const thumbnailUrl = getLivestreamListThumbnailUrl(livestream);
                    return (
                      <li key={livestream.id}>
                        <button
                          type="button"
                          onClick={() => {
                            void handleSelectLivestream(livestream.id);
                          }}
                          disabled={isResolving}
                          className="flex w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted disabled:opacity-60"
                        >
                          <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded bg-muted">
                            {thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- YouTube CDN thumbnails are not in next/image remotePatterns.
                              <img
                                src={thumbnailUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">
                              {livestream.title.trim() || 'Untitled livestream'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatScheduledDateTime(livestream.scheduledStartTime)}
                            </p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {livestreamsTotal > 0 ? (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Showing {livestreams.length} of {livestreamsTotal}
                  </p>
                  {canShowMoreLivestreams ? (
                    <button
                      type="button"
                      onClick={() => {
                        void loadLivestreams(livestreams.length, { append: true });
                      }}
                      disabled={isLoadingLivestreams}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60"
                    >
                      {isLoadingLivestreams ? 'Loading…' : 'Show more'}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === 'editor' && resolvedSource ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-foreground">{resolvedSource.title}</h3>
                <p className="text-xs text-muted-foreground">
                  Duration: {formatVideoDuration(resolvedSource.durationSeconds)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <label
                  className="inline-flex items-center gap-2 text-sm text-foreground"
                  title="Turn off to trim by time only and skip video streaming."
                >
                  <input
                    type="checkbox"
                    checked={showVideoPreview}
                    onChange={(event) => setShowVideoPreview(event.target.checked)}
                    className="rounded border-border"
                  />
                  Show video preview
                </label>
                <label
                  className="inline-flex items-center gap-2 text-sm text-foreground"
                  title="Frame-accurate trim at import time. Disables keyframe snapping while you adjust the handles."
                >
                  <input
                    type="checkbox"
                    checked={enableSmartCut}
                    onChange={(event) => setEnableSmartCut(event.target.checked)}
                    className="rounded border-border"
                  />
                  Smart cut
                </label>
              </div>
            </div>

            {showVideoPreview ? (
              <>
                <YouTubePreviewPlayer
                  key={resolvedSource.youtubeVideoId}
                  youtubeVideoId={resolvedSource.youtubeVideoId}
                  streamUrl={resolvedSource.previewStreamUrl}
                  previewExpiresAt={resolvedSource.previewExpiresAt}
                  playerRef={playerRef as RefObject<YouTubePlayerHandle | null>}
                />

                <p className="text-xs text-muted-foreground">
                  Drag the handles to choose where the imported clip starts and ends. The preview
                  may look lower quality than the final video. Private videos must still be
                  accessible to your connected YouTube account.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Video preview is off. Use the trim handles and timestamps below to set the import
                range.
              </p>
            )}

            <TrimRangeSlider
              durationSeconds={resolvedSource.durationSeconds}
              youtubeVideoId={resolvedSource.youtubeVideoId}
              value={trimRange}
              onChange={setTrimRange}
              playerHandle={showVideoPreview ? playerHandle : undefined}
              enableKeyframeSnap={showVideoPreview && !enableSmartCut}
            />

            <DialogFooter className="px-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStep('source');
                  setResolvedSource(null);
                  setErrorMessage(null);
                }}
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={() => {
                  void handleStartImport();
                }}
                disabled={isStarting}
              >
                {isStarting ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Starting…
                  </>
                ) : (
                  'Start import'
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {step === 'progress' && jobStatus ? (
          <div className="space-y-4">
            {showCompletionSuccess ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                  <CircleCheck className="h-4 w-4 shrink-0" />
                  Video staged for this draft
                </div>
                <p className="text-sm text-muted-foreground">
                  Close this window and use <span className="font-medium">Upload &amp; Save</span>{' '}
                  in the draft when your metadata is ready.
                </p>
                <DialogFooter className="px-0">
                  <Button type="button" onClick={() => handleDialogOpenChange(false)}>
                    Done
                  </Button>
                </DialogFooter>
              </div>
            ) : jobStatus.status === 'failed' ? (
              <div className="space-y-3">
                <p className="text-sm text-destructive">
                  {jobStatus.errorMessage?.trim() || 'The import failed.'}
                </p>
                <Button type="button" variant="outline" onClick={handleRetryAfterFailure}>
                  Try a different source
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{formatYoutubeImportStatusLabel(jobStatus.status)}</span>
                    <span>{jobStatus.progressPercent}%</span>
                  </div>
                  <Progress value={jobStatus.progressPercent} className="h-2" />
                </div>

                {isActiveYoutubeImportStatus(jobStatus.status) ? (
                  <DialogFooter className="px-0 sm:justify-between">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                      Continue in background
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowCancelImportConfirm(true)}
                      disabled={isCancelling}
                    >
                      {isCancelling ? (
                        <>
                          <Loader2 className="animate-spin" />
                          Cancelling…
                        </>
                      ) : (
                        'Cancel import'
                      )}
                    </Button>
                  </DialogFooter>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </DialogContent>

      <AlertDialog
        open={showCancelImportConfirm}
        onOpenChange={(open) => {
          if (!open && !isCancelling) {
            setShowCancelImportConfirm(false);
          }
        }}
      >
        <AlertDialogContent stackLayerClassName="!z-[70]">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel YouTube import?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops the current import. Any partial download will be discarded and you can
              choose a different source afterward.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancelling}>Keep importing</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleCancelImport();
              }}
              disabled={isCancelling}
            >
              {isCancelling ? 'Cancelling…' : 'Cancel import'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
