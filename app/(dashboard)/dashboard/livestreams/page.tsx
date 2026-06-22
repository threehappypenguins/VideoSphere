'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  createLivestreamEditorValues,
  LivestreamMetadataModal,
  type LivestreamEditorValues,
} from '@/components/livestreams/LivestreamMetadataModal';
import type {
  ApiResponse,
  ConnectedAccountPlatform,
  ConnectedAccountPublic,
  Livestream,
  LivestreamStatus,
} from '@/types';
import { canEditLivestreamSchedule } from '@/lib/livestreams/livestream-edit-policy';
import { partitionLivestreams } from '@/lib/livestreams/partition-livestreams';
import {
  getSchedulableLivestreamPlatforms,
  type LivestreamConnectionSnapshot,
  toLivestreamConnectionSnapshots,
} from '@/lib/livestreams/schedulable-platforms';

function livestreamTargetsEqual(
  a: readonly ConnectedAccountPlatform[],
  b: readonly ConnectedAccountPlatform[]
): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function isMinimalCreateLivestream(livestream: Livestream): boolean {
  return (
    livestream.title.trim() === '' &&
    livestream.description.trim() === '' &&
    livestream.tags.length === 0 &&
    livestream.targets.length === 0 &&
    !livestream.thumbnailR2Key &&
    !livestream.thumbnailPreviewUrl &&
    !livestream.scheduledStartTime &&
    Object.keys(livestream.platforms ?? {}).length === 0
  );
}

function livestreamEditorHasMeaningfulChanges(
  snapshot: LivestreamEditorValues,
  baselineTargets: readonly ConnectedAccountPlatform[] | null
): boolean {
  const hasTargetsChanged =
    baselineTargets !== null && !livestreamTargetsEqual(snapshot.targets, baselineTargets);

  return (
    snapshot.title.trim() !== '' ||
    snapshot.description.trim() !== '' ||
    snapshot.tags.length > 0 ||
    Boolean(snapshot.thumbnailR2Key || snapshot.thumbnailPreviewUrl) ||
    Boolean(snapshot.scheduledStartTime) ||
    hasTargetsChanged
  );
}

function formatScheduledDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function displayTitle(livestream: Livestream): string {
  return livestream.title.trim() || 'Untitled livestream';
}

function statusBadgeLabel(status: LivestreamStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'scheduled':
      return 'Scheduled';
    case 'live':
      return 'Live';
    case 'ended':
      return 'Ended';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}

function formatKeySwapNote(livestream: Livestream): string | null {
  if (livestream.keySlotStaleAt) {
    return `Key: main → stale (never went live) at ${formatScheduledDateTime(livestream.keySlotStaleAt)}`;
  }
  if (livestream.keySwapPromotedAt && livestream.status === 'scheduled') {
    return `Key: temp → promoted to main at ${formatScheduledDateTime(livestream.keySwapPromotedAt)}`;
  }
  if (livestream.keySlot === 'temp' && livestream.status === 'scheduled') {
    return 'Key: temp (queued)';
  }
  return null;
}

/**
 * Livestreams dashboard list page: drafts, scheduled, live, and streamed sections.
 * @returns The rendered livestreams list UI.
 */
export default function LivestreamsPage() {
  const [livestreams, setLivestreams] = useState<Livestream[]>([]);
  const [connectionSnapshots, setConnectionSnapshots] = useState<LivestreamConnectionSnapshot[]>(
    []
  );
  const [hasLoadedConnections, setHasLoadedConnections] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [isDuplicatingId, setIsDuplicatingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editingLivestream, setEditingLivestream] = useState<LivestreamEditorValues | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  /** True after the user successfully saves a newly created livestream in this session. */
  const [createLivestreamSaved, setCreateLivestreamSaved] = useState(false);
  /** True only when closing the create session should delete the backing livestream row. */
  const shouldDeleteCreateLivestreamOnCancelRef = useRef(false);
  /** True when the modal was opened via New livestream (not from the list). */
  const [isCreateSession, setIsCreateSession] = useState(false);
  /** Baseline targets when minimal create opened (updated when auto-fill adds platforms). */
  const createModalBaselineTargetsRef = useRef<ConnectedAccountPlatform[] | null>(null);
  const duplicatingLivestreamIdRef = useRef<string | null>(null);

  const loadLivestreams = useCallback(
    async (signal?: AbortSignal, options?: { quiet?: boolean }) => {
      const quiet = options?.quiet === true;
      if (!quiet) {
        setIsLoading(true);
        setErrorMessage(null);
        setHasLoadedConnections(false);
      }

      try {
        const livestreamsResponse = await fetch('/api/livestreams', {
          method: 'GET',
          signal,
          cache: 'no-store',
        });

        if (!livestreamsResponse.ok) {
          if (quiet) return;
          const errorBody = (await livestreamsResponse.json().catch(() => null)) as {
            message?: string;
          } | null;
          throw new Error(errorBody?.message ?? 'Failed to load livestreams.');
        }

        const livestreamsJson = (await livestreamsResponse.json()) as ApiResponse<Livestream[]>;
        setLivestreams(Array.isArray(livestreamsJson.data) ? livestreamsJson.data : []);

        if (quiet) {
          return;
        }

        const connectionsResponse = await fetch('/api/platforms/connections', {
          method: 'GET',
          signal,
          cache: 'no-store',
        });

        let snapshots: LivestreamConnectionSnapshot[] = [];
        if (connectionsResponse.ok) {
          const connectionsPayload = (await connectionsResponse.json()) as ApiResponse<
            ConnectedAccountPublic[]
          >;
          snapshots = toLivestreamConnectionSnapshots(
            Array.isArray(connectionsPayload.data) ? connectionsPayload.data : []
          );
        }
        setConnectionSnapshots(snapshots);
        setHasLoadedConnections(connectionsResponse.ok);
      } catch (error) {
        if (signal?.aborted) return;
        if (quiet) return;
        const message = error instanceof Error ? error.message : 'Failed to load livestreams.';
        setErrorMessage(message);
        setLivestreams([]);
        setConnectionSnapshots([]);
        setHasLoadedConnections(false);
      } finally {
        if (!signal?.aborted && !quiet) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadLivestreams(controller.signal);
    return () => controller.abort();
  }, [loadLivestreams]);

  const { drafts, scheduled, live, streamed } = useMemo(
    () => partitionLivestreams(livestreams),
    [livestreams]
  );

  const armedLivestreamsForKeySlot = useMemo(
    () =>
      livestreams.filter(
        (row) =>
          (row.status === 'scheduled' || row.status === 'live') &&
          row.keySlot &&
          row.targets.includes('youtube')
      ),
    [livestreams]
  );

  const handleKeySlotChanged = useCallback(async () => {
    await loadLivestreams(undefined, { quiet: true });
  }, [loadLivestreams]);

  const hasLivestreams = livestreams.length > 0;
  const headingDescription = useMemo(
    () =>
      hasLivestreams
        ? `You have ${livestreams.length} livestream${livestreams.length === 1 ? '' : 's'} across drafts, scheduled, live, and streamed.`
        : 'Plan live broadcasts, schedule them, and track when they go live.',
    [hasLivestreams, livestreams.length]
  );

  const beginCreateLivestreamSession = useCallback(
    (livestream: Livestream) => {
      const minimal = isMinimalCreateLivestream(livestream);
      const schedulable = getSchedulableLivestreamPlatforms(connectionSnapshots);
      const initialTargets =
        livestream.targets.length > 0 ? [...livestream.targets] : [...schedulable];

      setIsCreateSession(true);
      shouldDeleteCreateLivestreamOnCancelRef.current = minimal;
      setCreateLivestreamSaved(!minimal);
      createModalBaselineTargetsRef.current = initialTargets;
      setEditingLivestream({
        ...createLivestreamEditorValues(livestream),
        targets: initialTargets,
      });
    },
    [connectionSnapshots]
  );

  const openEditLivestream = useCallback(
    async (livestream: Livestream, options?: { createSession?: boolean }) => {
      try {
        const response = await fetch(`/api/livestreams/${livestream.id}`, { cache: 'no-store' });
        if (!response.ok) {
          const err = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(err?.message ?? 'Failed to load livestream');
        }
        const payload = (await response.json()) as ApiResponse<Livestream>;
        const detail = payload.data ?? livestream;

        if (options?.createSession) {
          beginCreateLivestreamSession(detail);
          return;
        }

        setIsCreateSession(false);
        shouldDeleteCreateLivestreamOnCancelRef.current = false;
        setCreateLivestreamSaved(false);
        createModalBaselineTargetsRef.current = null;
        setEditingLivestream(createLivestreamEditorValues(detail));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load livestream');
      }
    },
    [beginCreateLivestreamSession]
  );

  useEffect(() => {
    if (!isCreateSession || !editingLivestream) return;
    if (createModalBaselineTargetsRef.current === null) return;
    if (
      editingLivestream.targets.length > 0 &&
      createModalBaselineTargetsRef.current.length === 0
    ) {
      createModalBaselineTargetsRef.current = [...editingLivestream.targets];
    }
  }, [editingLivestream, isCreateSession]);

  const handleSaveEdit = useCallback(
    async (options?: {
      closeAfterSave?: boolean;
      suppressErrorToast?: boolean;
      values?: LivestreamEditorValues;
    }): Promise<{ saved: boolean; livestreamId?: string; message?: string }> => {
      const snapshot = options?.values ?? editingLivestream;
      if (!snapshot) return { saved: false };

      setIsSavingEdit(true);
      try {
        const isExistingLivestream = snapshot.id.trim() !== '';
        const requestUrl = isExistingLivestream
          ? `/api/livestreams/${snapshot.id}`
          : '/api/livestreams';
        const requestMethod = isExistingLivestream ? 'PATCH' : 'POST';

        const response = await fetch(requestUrl, {
          method: requestMethod,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: snapshot.title,
            description: snapshot.description,
            tags: snapshot.tags,
            visibility: snapshot.visibility,
            platforms: snapshot.platforms,
            ...(canEditLivestreamSchedule(snapshot.status)
              ? {
                  targets: snapshot.targets,
                  scheduledStartTime: snapshot.scheduledStartTime ?? null,
                  scheduledStartTimeZone: snapshot.scheduledStartTimeZone ?? null,
                  ...(snapshot.autoPromoteToMainKey !== undefined
                    ? { autoPromoteToMainKey: snapshot.autoPromoteToMainKey }
                    : {}),
                  ...(snapshot.autoPromoteToMainKeyMinutes != null
                    ? { autoPromoteToMainKeyMinutes: snapshot.autoPromoteToMainKeyMinutes }
                    : {}),
                }
              : {}),
          }),
        });
        if (!response.ok) {
          const err = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(
            err?.message ??
              (isExistingLivestream ? 'Failed to update livestream' : 'Failed to create livestream')
          );
        }
        const payload = (await response.json()) as ApiResponse<Livestream>;
        const savedLivestream = payload.data;
        if (!savedLivestream) {
          throw new Error(
            isExistingLivestream ? 'Failed to update livestream' : 'Failed to create livestream'
          );
        }

        if (isCreateSession) {
          setCreateLivestreamSaved(true);
        }

        if (options?.closeAfterSave !== true) {
          setEditingLivestream(createLivestreamEditorValues(savedLivestream));
        } else {
          setIsCreateSession(false);
          shouldDeleteCreateLivestreamOnCancelRef.current = false;
          createModalBaselineTargetsRef.current = null;
          setCreateLivestreamSaved(false);
          setEditingLivestream(null);
        }
        await loadLivestreams(undefined, { quiet: options?.suppressErrorToast === true });
        return {
          saved: true,
          livestreamId: savedLivestream.id,
          message: isExistingLivestream ? 'Livestream updated' : 'Livestream created',
        };
      } catch (error) {
        if (!options?.suppressErrorToast) {
          toast.error(error instanceof Error ? error.message : 'Failed to save livestream');
        }
        return { saved: false };
      } finally {
        setIsSavingEdit(false);
      }
    },
    [editingLivestream, isCreateSession, loadLivestreams]
  );

  const handleScheduled = useCallback(async () => {
    await loadLivestreams(undefined, { quiet: true });
    setIsCreateSession(false);
    shouldDeleteCreateLivestreamOnCancelRef.current = false;
    createModalBaselineTargetsRef.current = null;
    setCreateLivestreamSaved(false);
    setEditingLivestream(null);
  }, [loadLivestreams]);

  const handleCloseLivestreamModal = useCallback(async () => {
    if (
      isCreateSession &&
      editingLivestream?.id &&
      !createLivestreamSaved &&
      shouldDeleteCreateLivestreamOnCancelRef.current
    ) {
      const hasMeaningful = livestreamEditorHasMeaningfulChanges(
        editingLivestream,
        createModalBaselineTargetsRef.current
      );
      if (hasMeaningful) {
        const ok = window.confirm(
          'Discard livestream? Unsaved changes will be lost and this livestream will be deleted.'
        );
        if (!ok) return;
      }
      try {
        const response = await fetch(`/api/livestreams/${editingLivestream.id}`, {
          method: 'DELETE',
        });
        if (!response.ok) {
          const err = (await response.json().catch(() => null)) as { message?: string } | null;
          toast.error(err?.message ?? 'Failed to discard livestream');
          return;
        }
        await loadLivestreams();
      } catch {
        toast.error('Failed to discard livestream');
        return;
      }
    }

    setIsCreateSession(false);
    shouldDeleteCreateLivestreamOnCancelRef.current = false;
    createModalBaselineTargetsRef.current = null;
    setCreateLivestreamSaved(false);
    setEditingLivestream(null);
  }, [createLivestreamSaved, editingLivestream, isCreateSession, loadLivestreams]);

  const handleDeleteLivestream = useCallback(
    async (livestream: Livestream) => {
      if (editingLivestream?.id === livestream.id) {
        toast.error('Close the livestream editor before deleting this livestream.');
        return;
      }

      const title = displayTitle(livestream);
      const confirmed = window.confirm(`Delete "${title}"? This cannot be undone.`);
      if (!confirmed) return;

      setIsDeletingId(livestream.id);
      try {
        const response = await fetch(`/api/livestreams/${livestream.id}`, { method: 'DELETE' });
        if (!response.ok) {
          const err = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(err?.message ?? 'Failed to delete livestream');
        }
        toast.success('Livestream deleted');
        if (editingLivestream?.id === livestream.id) {
          setEditingLivestream(null);
        }
        await loadLivestreams();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to delete livestream');
      } finally {
        setIsDeletingId(null);
      }
    },
    [editingLivestream?.id, loadLivestreams]
  );

  const handleDuplicateLivestream = useCallback(
    async (livestream: Livestream) => {
      if (duplicatingLivestreamIdRef.current === livestream.id) return;
      duplicatingLivestreamIdRef.current = livestream.id;
      setIsDuplicatingId(livestream.id);
      try {
        const response = await fetch('/api/livestreams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `${livestream.title} (copy)`,
            description: livestream.description,
            tags: livestream.tags,
            visibility: livestream.visibility,
            targets: livestream.targets,
            platforms: livestream.platforms,
          }),
        });
        if (!response.ok) {
          const err = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(err?.message ?? 'Failed to duplicate livestream');
        }
        toast.success('Livestream duplicated');
        await loadLivestreams();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to duplicate livestream');
      } finally {
        duplicatingLivestreamIdRef.current = null;
        setIsDuplicatingId(null);
      }
    },
    [loadLivestreams]
  );

  const handleNewLivestream = useCallback(async () => {
    if (isCreating) return;

    setIsCreating(true);
    try {
      const response = await fetch('/api/livestreams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '',
          description: '',
          tags: [],
          targets: [],
          platforms: {},
        }),
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? 'Failed to create livestream');
      }
      const payload = (await response.json()) as ApiResponse<Livestream>;
      const created = payload.data;
      if (!created) {
        throw new Error('Failed to create livestream');
      }

      beginCreateLivestreamSession(created);
      setLivestreams((prev) => [created, ...prev.filter((row) => row.id !== created.id)]);
      void loadLivestreams(undefined, { quiet: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create livestream');
    } finally {
      setIsCreating(false);
    }
  }, [beginCreateLivestreamSession, isCreating, loadLivestreams]);

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Livestreams</h1>
          <p className="mt-2 text-lg text-foreground text-shadow-bg">{headingDescription}</p>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void handleNewLivestream();
            }}
            disabled={isCreating || editingLivestream !== null}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
          >
            {isCreating ? 'Creating…' : 'New livestream'}
          </button>
          {isLoading ? (
            <span className="text-sm text-muted-foreground text-shadow-bg">
              Loading livestreams…
            </span>
          ) : null}
        </div>

        {errorMessage ? (
          <div className="rounded-xl border border-border bg-muted/60 px-4 py-3 text-sm text-foreground">
            Failed to load livestreams: {errorMessage}
          </div>
        ) : null}

        {!isLoading && !hasLivestreams && !errorMessage ? (
          <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 px-6 py-16 text-center">
            <h2 className="text-base font-semibold text-foreground">No livestreams yet</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Create a livestream draft to prepare metadata and schedule a YouTube broadcast when
              you&apos;re ready.
            </p>
          </div>
        ) : null}

        {hasLivestreams ? (
          <div className="space-y-6">
            <LivestreamSection
              title="Drafts"
              description="Livestreams you are still preparing. Schedule them on YouTube when metadata is ready."
            >
              {drafts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No draft livestreams.</p>
              ) : (
                <LivestreamsTableContent
                  livestreams={drafts}
                  showScheduledColumn={false}
                  onEdit={openEditLivestream}
                  onDelete={handleDeleteLivestream}
                  onDuplicate={handleDuplicateLivestream}
                  isDeletingId={isDeletingId}
                  isDuplicatingId={isDuplicatingId}
                />
              )}
            </LivestreamSection>

            <LivestreamSection
              title="Scheduled"
              description="Broadcasts scheduled on YouTube that have not gone live yet."
            >
              {scheduled.length === 0 ? (
                <p className="text-sm text-muted-foreground">No scheduled livestreams.</p>
              ) : (
                <LivestreamsTableContent
                  livestreams={scheduled}
                  showScheduledColumn
                  onEdit={openEditLivestream}
                  onDelete={handleDeleteLivestream}
                  onDuplicate={handleDuplicateLivestream}
                  isDeletingId={isDeletingId}
                  isDuplicatingId={isDuplicatingId}
                />
              )}
            </LivestreamSection>

            <LivestreamSection
              title="Live"
              description="Broadcasts currently live on YouTube."
              live
            >
              {live.length === 0 ? (
                <p className="text-sm text-muted-foreground">No live broadcasts right now.</p>
              ) : (
                <LivestreamsTableContent
                  livestreams={live}
                  showScheduledColumn
                  onEdit={openEditLivestream}
                  onDelete={handleDeleteLivestream}
                  onDuplicate={handleDuplicateLivestream}
                  isDeletingId={isDeletingId}
                  isDuplicatingId={isDuplicatingId}
                />
              )}
            </LivestreamSection>

            <LivestreamSection
              title="Streamed"
              description="Past broadcasts that have ended on YouTube."
              streamed
            >
              {streamed.length === 0 ? (
                <p className="text-sm text-muted-foreground">No streamed livestreams yet.</p>
              ) : (
                <LivestreamsTableContent
                  livestreams={streamed}
                  showScheduledColumn
                  onEdit={openEditLivestream}
                  onDelete={handleDeleteLivestream}
                  onDuplicate={handleDuplicateLivestream}
                  isDeletingId={isDeletingId}
                  isDuplicatingId={isDuplicatingId}
                  dimStreamedRows
                />
              )}
            </LivestreamSection>
          </div>
        ) : null}
      </div>

      <LivestreamMetadataModal
        mode={isCreateSession && !createLivestreamSaved ? 'create' : 'edit'}
        value={editingLivestream}
        initialConnectionSnapshots={connectionSnapshots}
        initialConnectionsResolved={hasLoadedConnections}
        isSaving={isSavingEdit}
        onClose={() => {
          void handleCloseLivestreamModal();
        }}
        onSave={handleSaveEdit}
        onScheduled={handleScheduled}
        onChange={setEditingLivestream}
        armedLivestreamsForKeySlot={armedLivestreamsForKeySlot}
        onKeySlotChanged={handleKeySlotChanged}
      />
    </div>
  );
}

interface LivestreamActionsProps {
  livestream: Livestream;
  onDelete: (livestream: Livestream) => void;
  onDuplicate: (livestream: Livestream) => void;
  isDeletingId: string | null;
  isDuplicatingId: string | null;
}

function LivestreamActions({
  livestream,
  onDelete,
  onDuplicate,
  isDeletingId,
  isDuplicatingId,
}: LivestreamActionsProps) {
  return (
    <div className="inline-flex max-w-full flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDuplicate(livestream);
        }}
        disabled={isDuplicatingId === livestream.id}
        className="pointer-events-auto whitespace-nowrap rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
      >
        {isDuplicatingId === livestream.id ? 'Copying...' : 'Duplicate'}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(livestream);
        }}
        disabled={isDeletingId === livestream.id}
        className="pointer-events-auto inline-flex items-center justify-center whitespace-nowrap rounded-md border border-border bg-background p-1.5 text-foreground transition-colors hover:bg-muted disabled:opacity-60"
        aria-label="Delete livestream"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: LivestreamStatus }) {
  const label = statusBadgeLabel(status);
  const className =
    status === 'draft'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100'
      : status === 'scheduled'
        ? 'border-sky-500/30 bg-sky-500/10 text-sky-950 dark:text-sky-100'
        : status === 'live'
          ? 'border-amber-500/40 bg-amber-500/15 text-amber-950 dark:text-amber-100'
          : status === 'failed'
            ? 'border-destructive/40 bg-destructive/10 text-destructive'
            : 'border-muted-foreground/30 bg-muted/40 text-muted-foreground';

  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}
    >
      {label}
    </span>
  );
}

interface LivestreamSectionProps {
  title: string;
  description: string;
  live?: boolean;
  streamed?: boolean;
  children: ReactNode;
}

function LivestreamSection({
  title,
  description,
  live = false,
  streamed = false,
  children,
}: LivestreamSectionProps) {
  const sectionClassName = live
    ? 'border-amber-500/40 bg-amber-500/10'
    : streamed
      ? 'border-muted-foreground/30 bg-muted/20'
      : 'border-border bg-background';

  return (
    <section className={`space-y-3 rounded-xl border p-4 sm:p-5 ${sectionClassName}`}>
      <header className="space-y-1">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  );
}

interface LivestreamsTableContentProps {
  livestreams: Livestream[];
  showScheduledColumn: boolean;
  onEdit: (livestream: Livestream) => void;
  onDelete: (livestream: Livestream) => void;
  onDuplicate: (livestream: Livestream) => void;
  isDeletingId: string | null;
  isDuplicatingId: string | null;
  dimStreamedRows?: boolean;
}

function LivestreamsTableContent({
  livestreams,
  showScheduledColumn,
  onEdit,
  onDelete,
  onDuplicate,
  isDeletingId,
  isDuplicatingId,
  dimStreamedRows = false,
}: LivestreamsTableContentProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <th
              scope="col"
              className={`px-3 py-3 text-left sm:px-4 ${showScheduledColumn ? 'w-[28%]' : 'w-[36%]'}`}
            >
              Title
            </th>
            {showScheduledColumn ? (
              <th scope="col" className="w-[20%] px-3 py-3 text-left sm:px-4">
                Scheduled
              </th>
            ) : null}
            <th
              scope="col"
              className={`px-3 py-3 text-left sm:px-4 ${showScheduledColumn ? 'w-[14%]' : 'w-[18%]'}`}
            >
              Status
            </th>
            <th
              scope="col"
              className={`px-3 py-3 text-right sm:px-4 ${showScheduledColumn ? 'w-[38%]' : 'w-[46%]'}`}
            >
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {livestreams.map((livestream) => {
            const title = displayTitle(livestream);
            const keySwapNote = formatKeySwapNote(livestream);
            return (
              <tr
                key={livestream.id}
                className={`border-b border-border transition-colors hover:bg-muted/40 ${
                  dimStreamedRows ? 'bg-muted/20' : ''
                }`}
              >
                <td className="p-0 align-top">
                  <button
                    type="button"
                    onClick={() => onEdit(livestream)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onEdit(livestream);
                      }
                    }}
                    aria-label={`Edit livestream "${title}"`}
                    className="block w-full px-3 py-3 text-left sm:px-4"
                  >
                    <span className="block max-w-full truncate text-foreground">{title}</span>
                    {keySwapNote ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {keySwapNote}
                      </span>
                    ) : null}
                  </button>
                </td>
                {showScheduledColumn ? (
                  <td className="p-0 align-top text-muted-foreground">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => onEdit(livestream)}
                      aria-label={`Edit livestream "${title}"`}
                      className="block w-full px-3 py-3 text-left sm:px-4"
                    >
                      <span className="block truncate">
                        {formatScheduledDateTime(livestream.scheduledStartTime)}
                      </span>
                    </button>
                  </td>
                ) : null}
                <td className="p-0 align-top">
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => onEdit(livestream)}
                    aria-label={`Edit livestream "${title}"`}
                    className="block w-full px-3 py-3 text-left sm:px-4"
                  >
                    <StatusBadge status={livestream.status} />
                  </button>
                </td>
                <td className="p-0 align-top text-right">
                  <div className="relative">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => onEdit(livestream)}
                      aria-label={`Edit livestream "${title}"`}
                      className="absolute inset-0 z-0"
                    />
                    <div
                      className="relative z-10 px-3 py-3 sm:px-4"
                      role="button"
                      tabIndex={0}
                      aria-label={`Edit livestream "${title}"`}
                      onClick={() => onEdit(livestream)}
                      onKeyDown={(event) => {
                        const target = event.target as HTMLElement | null;
                        if (target && target.closest('button') && target !== event.currentTarget) {
                          return;
                        }
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onEdit(livestream);
                        }
                      }}
                    >
                      <LivestreamActions
                        livestream={livestream}
                        onDelete={onDelete}
                        onDuplicate={onDuplicate}
                        isDeletingId={isDeletingId}
                        isDuplicatingId={isDuplicatingId}
                      />
                    </div>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
