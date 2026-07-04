'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  createLivestreamEditorValues,
  LivestreamMetadataModal,
  type LivestreamEditorValues,
} from '@/components/livestreams/LivestreamMetadataModal';
import { LivestreamsTableContent } from '@/components/livestreams/LivestreamsListTable';
import type { ApiResponse, ConnectedAccountPublic, Livestream } from '@/types';
import {
  toLivestreamConnectionSnapshots,
  type LivestreamConnectionSnapshot,
} from '@/lib/livestreams/schedulable-platforms';
import { deleteLivestreamViaApi } from '@/lib/livestreams/delete-livestream-client';

interface StreamedLivestreamsHistoryResponse extends ApiResponse<Livestream[]> {
  meta?: {
    total: number;
    limit: number;
    offset: number;
  };
}

/** Must match GET /api/livestreams streamed pagination default `limit`. */
const STREAMED_HISTORY_PAGE_SIZE = 20;

/**
 * Paginated list of past streamed livestreams with edit and delete actions.
 * @returns Streamed livestream history UI.
 */
export function StreamedLivestreamsHistoryClient() {
  const [livestreams, setLivestreams] = useState<Livestream[]>([]);
  const [connectionSnapshots, setConnectionSnapshots] = useState<LivestreamConnectionSnapshot[]>(
    []
  );
  const [hasLoadedConnections, setHasLoadedConnections] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [isDuplicatingId, setIsDuplicatingId] = useState<string | null>(null);
  const [editingLivestream, setEditingLivestream] = useState<LivestreamEditorValues | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/livestreams?status=streamed&limit=${STREAMED_HISTORY_PAGE_SIZE}&offset=${offset}`,
        { cache: 'no-store' }
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? 'Failed to load streamed livestreams');
      }

      const payload = (await response.json()) as StreamedLivestreamsHistoryResponse;
      const data = Array.isArray(payload.data) ? payload.data : [];
      const totalCount = payload.meta?.total ?? 0;
      const pageSize = STREAMED_HISTORY_PAGE_SIZE;

      if (totalCount === 0) {
        setLivestreams([]);
        setTotal(0);
        if (offset > 0) setOffset(0);
        return;
      }

      setTotal(totalCount);

      const lastPageOffset = Math.max(0, Math.floor((totalCount - 1) / pageSize) * pageSize);
      if (offset > lastPageOffset) {
        setOffset(lastPageOffset);
        return;
      }

      setLivestreams(data);

      if (!hasLoadedConnections) {
        const connectionsResponse = await fetch('/api/platforms/connections', {
          cache: 'no-store',
        });
        if (connectionsResponse.ok) {
          const connectionsPayload = (await connectionsResponse.json()) as ApiResponse<
            ConnectedAccountPublic[]
          >;
          setConnectionSnapshots(
            toLivestreamConnectionSnapshots(
              Array.isArray(connectionsPayload.data) ? connectionsPayload.data : []
            )
          );
        }
        setHasLoadedConnections(connectionsResponse.ok);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load streamed livestreams');
      setLivestreams([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [hasLoadedConnections, offset]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

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

  const scheduledFacebookLivestreams = useMemo(
    () =>
      livestreams.filter(
        (row) =>
          (row.status === 'scheduled' || row.status === 'live') && row.targets.includes('facebook')
      ),
    [livestreams]
  );

  const openEditLivestream = useCallback(async (livestream: Livestream) => {
    try {
      const response = await fetch(`/api/livestreams/${livestream.id}`, { cache: 'no-store' });
      if (!response.ok) {
        const err = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? 'Failed to load livestream');
      }
      const payload = (await response.json()) as ApiResponse<Livestream>;
      setEditingLivestream(createLivestreamEditorValues(payload.data ?? livestream));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load livestream');
    }
  }, []);

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
        const response = await fetch(`/api/livestreams/${snapshot.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: snapshot.title,
            description: snapshot.description,
            tags: snapshot.tags,
            targets: snapshot.targets,
            platforms: snapshot.platforms,
            thumbnailR2Key: snapshot.thumbnailR2Key,
            scheduledStartTime: snapshot.scheduledStartTime,
            scheduledStartTimeZone: snapshot.scheduledStartTimeZone,
          }),
        });
        if (!response.ok) {
          const err = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(err?.message ?? 'Failed to save livestream');
        }
        if (options?.closeAfterSave !== false) {
          setEditingLivestream(null);
        }
        await loadHistory();
        return { saved: true, livestreamId: snapshot.id };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to save livestream';
        if (!options?.suppressErrorToast) {
          toast.error(message);
        }
        return { saved: false, message };
      } finally {
        setIsSavingEdit(false);
      }
    },
    [editingLivestream, loadHistory]
  );

  const handleDeleteLivestreamById = useCallback(
    async (livestreamId: string): Promise<boolean> => {
      setIsDeletingId(livestreamId);
      try {
        const deleted = await deleteLivestreamViaApi(livestreamId);
        if (deleted && editingLivestream?.id === livestreamId) {
          setEditingLivestream(null);
        }
        if (deleted) {
          await loadHistory();
        }
        return deleted;
      } finally {
        setIsDeletingId(null);
      }
    },
    [editingLivestream?.id, loadHistory]
  );

  const handleDeleteLivestream = useCallback(
    async (livestream: Livestream) => {
      if (isDeletingId) return;
      await handleDeleteLivestreamById(livestream.id);
    },
    [isDeletingId, handleDeleteLivestreamById]
  );

  const handleDuplicateLivestream = useCallback(
    async (livestream: Livestream) => {
      if (isDuplicatingId) return;
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
        await loadHistory();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to duplicate livestream');
      } finally {
        setIsDuplicatingId(null);
      }
    },
    [isDuplicatingId, loadHistory]
  );

  const canPrev = offset > 0;
  const canNext = offset + livestreams.length < total;

  if (isLoading) {
    return <p className="mt-8 text-sm text-muted-foreground">Loading streamed livestreams…</p>;
  }

  if (livestreams.length === 0 && total === 0) {
    return (
      <div className="mt-8 rounded-xl border border-border bg-muted/50 p-12 text-center">
        <p className="font-medium text-foreground">No streamed livestreams yet</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Past broadcasts will appear here after they end on YouTube.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mt-8 space-y-3">
        <p className="text-xs text-muted-foreground">
          Showing{' '}
          {livestreams.length === 0
            ? total === 0
              ? '0'
              : '—'
            : `${offset + 1}-${offset + livestreams.length}`}{' '}
          of {total}
        </p>

        <LivestreamsTableContent
          livestreams={livestreams}
          showScheduledColumn
          onEdit={openEditLivestream}
          onDelete={handleDeleteLivestream}
          onDuplicate={handleDuplicateLivestream}
          isDeletingId={isDeletingId}
          isDuplicatingId={isDuplicatingId}
          dimStreamedRows
        />

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => setOffset((prev) => Math.max(0, prev - STREAMED_HISTORY_PAGE_SIZE))}
            disabled={!canPrev}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setOffset((prev) => prev + STREAMED_HISTORY_PAGE_SIZE)}
            disabled={!canNext}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60"
          >
            Next
          </button>
        </div>
      </div>

      <LivestreamMetadataModal
        mode="edit"
        value={editingLivestream}
        initialConnectionSnapshots={connectionSnapshots}
        initialConnectionsResolved={hasLoadedConnections}
        isSaving={isSavingEdit}
        onClose={() => setEditingLivestream(null)}
        onSave={handleSaveEdit}
        onScheduled={loadHistory}
        onChange={setEditingLivestream}
        armedLivestreamsForKeySlot={armedLivestreamsForKeySlot}
        scheduledFacebookLivestreams={scheduledFacebookLivestreams}
        onKeySlotChanged={loadHistory}
        onFacebookChanged={loadHistory}
        onDelete={handleDeleteLivestreamById}
      />
    </>
  );
}
