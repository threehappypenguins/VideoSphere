'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { DraftMetadataModal, type DraftEditorValues } from '@/components/drafts/DraftMetadataModal';
import { useOnboardingContext } from '@/components/onboarding/OnboardingContext';
import type { ApiResponse, ConnectedAccountPlatform, ConnectedAccountPublic, Draft } from '@/types';

const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
type DraftView = 'list' | 'cards';

function draftTargetsEqual(
  a: readonly ConnectedAccountPlatform[],
  b: readonly ConnectedAccountPlatform[]
): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function formatLastEdited(isoDate: string): string {
  const updatedDate = new Date(isoDate);
  if (Number.isNaN(updatedDate.getTime())) return 'Recently';

  const diffMs = updatedDate.getTime() - Date.now();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (Math.abs(diffMs) < hour) {
    return relativeTimeFormatter.format(Math.round(diffMs / minute), 'minute');
  }

  if (Math.abs(diffMs) < day) {
    return relativeTimeFormatter.format(Math.round(diffMs / hour), 'hour');
  }

  return relativeTimeFormatter.format(Math.round(diffMs / day), 'day');
}

function createEditorValues(draft: Draft): DraftEditorValues {
  return {
    id: draft.id,
    title: draft.title,
    description: draft.description,
    tags: draft.tags,
    visibility: draft.visibility,
    targets: [...draft.targets],
    ...(draft.thumbnailR2Key ? { thumbnailR2Key: draft.thumbnailR2Key } : {}),
    ...(draft.thumbnailContentType ? { thumbnailContentType: draft.thumbnailContentType } : {}),
    ...(draft.thumbnailPreviewUrl ? { thumbnailPreviewUrl: draft.thumbnailPreviewUrl } : {}),
  };
}

function createNewEditorValues(): DraftEditorValues {
  return {
    id: '',
    title: '',
    description: '',
    tags: [],
    visibility: 'public',
    targets: [],
  };
}

export default function DraftsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setOnboardingDraftId } = useOnboardingContext();
  const handledEditDraftIdRef = useRef<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [connectedPlatforms, setConnectedPlatforms] = useState<ConnectedAccountPlatform[]>([]);
  const [hasLoadedConnections, setHasLoadedConnections] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [view, setView] = useState<DraftView>('list');
  const [creatingDraft, setCreatingDraft] = useState<DraftEditorValues | null>(null);
  const [editingDraft, setEditingDraft] = useState<DraftEditorValues | null>(null);
  const [isSavingCreate, setIsSavingCreate] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [isDuplicatingId, setIsDuplicatingId] = useState<string | null>(null);
  const [canUseAiMetadata, setCanUseAiMetadata] = useState(false);
  const [isOpeningCreate, setIsOpeningCreate] = useState(false);
  /** True after the user successfully saves a draft that was opened via minimal create. */
  const [createDraftSaved, setCreateDraftSaved] = useState(false);
  /** Baseline targets when minimal create opened (updated if auto-fill effect adds platforms). */
  const createModalBaselineTargetsRef = useRef<ConnectedAccountPlatform[] | null>(null);

  const loadDrafts = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage(null);
    setHasLoadedConnections(false);

    try {
      const [draftsResponse, connectionsResponse, aiAccessResponse] = await Promise.all([
        fetch('/api/drafts', {
          method: 'GET',
          signal,
          cache: 'no-store',
        }),
        fetch('/api/platforms/connections', {
          method: 'GET',
          signal,
          cache: 'no-store',
        }),
        fetch('/api/auth/ai-access', {
          method: 'GET',
          signal,
          cache: 'no-store',
        }),
      ]);

      if (!draftsResponse.ok) {
        const errorBody = (await draftsResponse.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(errorBody?.message ?? 'Failed to load drafts.');
      }

      const draftsJson = (await draftsResponse.json()) as ApiResponse<Draft[]>;

      let platforms: ConnectedAccountPlatform[] = [];
      if (connectionsResponse.ok) {
        const connectionsPayload = (await connectionsResponse.json()) as ApiResponse<
          ConnectedAccountPublic[]
        >;
        platforms = Array.isArray(connectionsPayload.data)
          ? connectionsPayload.data.map((account) => account.platform)
          : [];
      }
      setConnectedPlatforms(platforms);
      setHasLoadedConnections(connectionsResponse.ok);

      const aiAccessPayload = aiAccessResponse.ok
        ? ((await aiAccessResponse.json()) as { canUseAiMetadata?: boolean })
        : null;

      setDrafts(Array.isArray(draftsJson.data) ? draftsJson.data : []);
      setCanUseAiMetadata(Boolean(aiAccessPayload?.canUseAiMetadata));
    } catch (error) {
      if (signal?.aborted) return;
      const message = error instanceof Error ? error.message : 'Failed to load drafts.';
      setErrorMessage(message);
      setDrafts([]);
      setConnectedPlatforms([]);
      setCanUseAiMetadata(false);
      setHasLoadedConnections(false);
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadDrafts(controller.signal);
    return () => controller.abort();
  }, [loadDrafts]);

  // Track onboarding draft in context so tour can clean it up
  useEffect(() => {
    const isOnboarding = searchParams.get('onboardingFlow') === 'true';
    if (isOnboarding && creatingDraft?.id) {
      setOnboardingDraftId(creatingDraft.id);
    }
  }, [creatingDraft?.id, searchParams, setOnboardingDraftId]);

  const openEditDraft = useCallback(async (draft: Draft) => {
    try {
      const res = await fetch(`/api/drafts/${draft.id}`, { cache: 'no-store' });
      if (!res.ok) {
        setEditingDraft(createEditorValues(draft));
        return;
      }
      const payload = (await res.json()) as ApiResponse<Draft>;
      setEditingDraft(createEditorValues(payload.data ?? draft));
    } catch {
      setEditingDraft(createEditorValues(draft));
    }
  }, []);

  useEffect(() => {
    const editDraftId = searchParams.get('editDraft');
    if (!editDraftId) {
      handledEditDraftIdRef.current = null;
      return;
    }
    if (handledEditDraftIdRef.current === editDraftId) return;
    if (!editDraftId || isLoading || editingDraft !== null) return;
    const draft = drafts.find((item) => item.id === editDraftId);
    if (draft) {
      handledEditDraftIdRef.current = editDraftId;
      void openEditDraft(draft);
    }
  }, [drafts, editingDraft, isLoading, searchParams, openEditDraft]);

  const clearEditDraftQuery = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (!nextParams.has('editDraft')) return;
    nextParams.delete('editDraft');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!creatingDraft) return;
    if (creatingDraft.targets.length > 0) return;
    if (connectedPlatforms.length === 0) return;

    // Create mode default: preselect every connected platform.
    setCreatingDraft((prev) => {
      if (!prev || prev.targets.length > 0) return prev;
      const nextTargets = [...connectedPlatforms];
      createModalBaselineTargetsRef.current = nextTargets;
      return {
        ...prev,
        targets: nextTargets,
      };
    });
  }, [connectedPlatforms, creatingDraft]);

  const handleDeleteDraft = useCallback(
    async (draft: Draft) => {
      const confirmed = window.confirm(`Delete "${draft.title}"? This cannot be undone.`);
      if (!confirmed) return;

      setIsDeletingId(draft.id);
      try {
        const response = await fetch(`/api/drafts/${draft.id}`, { method: 'DELETE' });
        if (!response.ok) {
          const err = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(err?.message ?? 'Failed to delete draft');
        }
        toast.success('Draft deleted');
        await loadDrafts();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to delete draft');
      } finally {
        setIsDeletingId(null);
      }
    },
    [loadDrafts]
  );

  const handleDeleteDraftById = useCallback(
    async (draftId: string): Promise<boolean> => {
      setIsDeletingId(draftId);
      try {
        const response = await fetch(`/api/drafts/${draftId}`, { method: 'DELETE' });
        if (!response.ok) {
          const err = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(err?.message ?? 'Failed to delete draft');
        }
        toast.success('Draft deleted');
        await loadDrafts();
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to delete draft');
        return false;
      } finally {
        setIsDeletingId(null);
      }
    },
    [loadDrafts]
  );

  const handleDuplicateDraft = useCallback(
    async (draft: Draft) => {
      setIsDuplicatingId(draft.id);
      try {
        const response = await fetch('/api/drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `${draft.title} (copy)`,
            description: draft.description,
            tags: draft.tags,
            targets: draft.targets,
            visibility: draft.visibility,
            platforms: draft.platforms,
          }),
        });
        if (!response.ok) {
          const err = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(err?.message ?? 'Failed to duplicate draft');
        }
        toast.success('Draft duplicated');
        await loadDrafts();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to duplicate draft');
      } finally {
        setIsDuplicatingId(null);
      }
    },
    [loadDrafts]
  );

  const handleSaveEdit = useCallback(
    async (options?: {
      closeAfterSave?: boolean;
    }): Promise<{ saved: boolean; draftId?: string }> => {
      if (!editingDraft) return { saved: false };
      if (editingDraft.title.trim() === '') {
        toast.error('Title is required');
        return { saved: false };
      }
      if (editingDraft.targets.length === 0) {
        toast.error('Select at least one target platform');
        return { saved: false };
      }

      setIsSavingEdit(true);
      try {
        const response = await fetch(`/api/drafts/${editingDraft.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: editingDraft.title,
            description: editingDraft.description,
            tags: editingDraft.tags,
            visibility: editingDraft.visibility,
            targets: editingDraft.targets,
          }),
        });
        if (!response.ok) {
          const err = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(err?.message ?? 'Failed to update draft');
        }
        toast.success('Draft updated');
        if (options?.closeAfterSave === true) {
          setEditingDraft(null);
        }
        await loadDrafts();
        return { saved: true, draftId: editingDraft.id };
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to update draft');
        return { saved: false };
      } finally {
        setIsSavingEdit(false);
      }
    },
    [editingDraft, loadDrafts]
  );

  const handleSaveCreate = useCallback(
    async (options?: {
      closeAfterSave?: boolean;
    }): Promise<{ saved: boolean; draftId?: string }> => {
      if (!creatingDraft) return { saved: false };
      if (creatingDraft.title.trim() === '') {
        toast.error('Title is required');
        return { saved: false };
      }
      if (creatingDraft.targets.length === 0) {
        toast.error('Select at least one target platform');
        return { saved: false };
      }

      setIsSavingCreate(true);
      try {
        const isExistingDraft = creatingDraft.id.trim() !== '';
        const requestUrl = isExistingDraft ? `/api/drafts/${creatingDraft.id}` : '/api/drafts';
        const requestMethod = isExistingDraft ? 'PATCH' : 'POST';

        const response = await fetch(requestUrl, {
          method: requestMethod,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: creatingDraft.title,
            description: creatingDraft.description,
            tags: creatingDraft.tags,
            visibility: creatingDraft.visibility,
            targets: creatingDraft.targets,
          }),
        });
        if (!response.ok) {
          const err = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(
            err?.message ?? (isExistingDraft ? 'Failed to update draft' : 'Failed to create draft')
          );
        }
        const payload = (await response.json()) as ApiResponse<Draft>;
        const createdDraft = payload.data;
        if (!createdDraft) {
          throw new Error(isExistingDraft ? 'Failed to update draft' : 'Failed to create draft');
        }

        setCreatingDraft(createEditorValues(createdDraft));
        setDrafts((prev) => [
          createdDraft,
          ...prev.filter((draft) => draft.id !== createdDraft.id),
        ]);
        toast.success(isExistingDraft ? 'Draft updated' : 'Draft created');
        setCreateDraftSaved(true);

        if (options?.closeAfterSave === true) {
          setCreatingDraft(null);
          setCreateDraftSaved(false);
        }
        return { saved: true, draftId: createdDraft.id };
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : creatingDraft.id.trim() !== ''
              ? 'Failed to update draft'
              : 'Failed to create draft'
        );
        return { saved: false };
      } finally {
        setIsSavingCreate(false);
      }
    },
    [creatingDraft]
  );

  const handleOpenCreateModal = useCallback(async () => {
    setIsOpeningCreate(true);
    try {
      const response = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minimal: true }),
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? 'Failed to create draft');
      }
      const payload = (await response.json()) as ApiResponse<Draft>;
      const d = payload.data;
      if (!d) {
        throw new Error('Failed to create draft');
      }
      const initialTargets = connectedPlatforms.length > 0 ? [...connectedPlatforms] : [];
      createModalBaselineTargetsRef.current = initialTargets;
      setCreatingDraft({
        ...createEditorValues(d),
        targets: initialTargets,
      });
      setCreateDraftSaved(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create draft');
    } finally {
      setIsOpeningCreate(false);
    }
  }, [connectedPlatforms]);

  useEffect(() => {
    const shouldOpenCreate =
      searchParams.get('openCreateDraft') === 'true' || searchParams.get('openWizard') === 'true';
    if (!shouldOpenCreate || creatingDraft) return;

    void handleOpenCreateModal();

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('openCreateDraft');
    nextParams.delete('openWizard');
    const q = nextParams.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }, [searchParams, creatingDraft, handleOpenCreateModal, pathname, router]);

  const handleCloseCreateModal = useCallback(async () => {
    if (creatingDraft?.id) {
      if (!createDraftSaved) {
        const baselineTargets = createModalBaselineTargetsRef.current;
        const hasTargetsChanged =
          baselineTargets !== null && !draftTargetsEqual(creatingDraft.targets, baselineTargets);
        const hasMeaningful =
          creatingDraft.title.trim() !== '' ||
          creatingDraft.description.trim() !== '' ||
          creatingDraft.tags.length > 0 ||
          Boolean(creatingDraft.thumbnailR2Key || creatingDraft.thumbnailPreviewUrl) ||
          hasTargetsChanged;
        if (hasMeaningful) {
          const ok = window.confirm(
            'Discard draft? Unsaved changes will be lost and this draft will be deleted.'
          );
          if (!ok) return;
        }
        try {
          const res = await fetch(`/api/drafts/${creatingDraft.id}`, { method: 'DELETE' });
          if (!res.ok) {
            const err = (await res.json().catch(() => null)) as { message?: string } | null;
            toast.error(err?.message ?? 'Failed to discard draft');
            return;
          }
          await loadDrafts();
        } catch {
          toast.error('Failed to discard draft');
          return;
        }
      }
    }
    createModalBaselineTargetsRef.current = null;
    setCreatingDraft(null);
    setCreateDraftSaved(false);
  }, [creatingDraft, createDraftSaved, loadDrafts]);

  const hasDrafts = drafts.length > 0;
  const headingDescription = useMemo(
    () =>
      hasDrafts
        ? `You have ${drafts.length} draft${drafts.length === 1 ? '' : 's'} ready to edit or upload.`
        : "Videos you've started but haven't published yet. Drafts help you prepare uploads before distributing them.",
    [drafts.length, hasDrafts]
  );

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Drafts</h1>
          <p className="mt-2 text-lg text-foreground text-shadow-bg">{headingDescription}</p>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-tour="drafts-create-draft-button"
            onClick={() => {
              void handleOpenCreateModal();
            }}
            disabled={isOpeningCreate || creatingDraft !== null}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
          >
            {isOpeningCreate ? 'Creating…' : 'Create draft'}
          </button>
          <div className="inline-flex items-center rounded-md border border-border bg-background p-1 text-xs">
            <button
              type="button"
              onClick={() => setView('list')}
              className={`rounded px-2 py-1 transition-colors ${view === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setView('cards')}
              className={`rounded px-2 py-1 transition-colors ${view === 'cards' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Cards
            </button>
          </div>
          {isLoading ? (
            <span className="text-sm text-muted-foreground text-shadow-bg">Loading drafts...</span>
          ) : null}
        </div>

        {errorMessage ? (
          <div className="rounded-xl border border-border bg-muted/60 px-4 py-3 text-sm text-foreground">
            Failed to load drafts: {errorMessage}
          </div>
        ) : null}

        {!isLoading && !hasDrafts && !errorMessage ? (
          <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 px-6 py-16 text-center">
            <h2 className="text-base font-semibold text-foreground">No drafts yet</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Create a draft to get started. You can come back later to upload and publish your
              video when you&apos;re ready.
            </p>
          </div>
        ) : null}

        {hasDrafts ? (
          view === 'list' ? (
            <DraftsTable
              drafts={drafts}
              onEdit={(draft) => {
                void openEditDraft(draft);
              }}
              onDelete={handleDeleteDraft}
              onDuplicate={handleDuplicateDraft}
              isDeletingId={isDeletingId}
              isDuplicatingId={isDuplicatingId}
            />
          ) : (
            <DraftCards
              drafts={drafts}
              onEdit={(draft) => {
                void openEditDraft(draft);
              }}
              onDelete={handleDeleteDraft}
              onDuplicate={handleDuplicateDraft}
              isDeletingId={isDeletingId}
              isDuplicatingId={isDuplicatingId}
            />
          )
        ) : null}
      </div>

      <DraftMetadataModal
        mode="create"
        value={creatingDraft}
        initialConnectedPlatforms={connectedPlatforms}
        initialConnectionsResolved={hasLoadedConnections}
        onChange={setCreatingDraft}
        onClose={() => {
          void handleCloseCreateModal();
        }}
        onSave={handleSaveCreate}
        onUploadComplete={loadDrafts}
        isSaving={isSavingCreate}
        canUseAiMetadata={canUseAiMetadata}
        disableInteractionLock={searchParams.get('onboardingFlow') === 'true'}
      />
      <DraftMetadataModal
        mode="edit"
        value={editingDraft}
        initialConnectedPlatforms={connectedPlatforms}
        initialConnectionsResolved={hasLoadedConnections}
        onChange={setEditingDraft}
        onClose={() => {
          setEditingDraft(null);
          clearEditDraftQuery();
        }}
        onSave={handleSaveEdit}
        onUploadComplete={loadDrafts}
        onDelete={handleDeleteDraftById}
        isSaving={isSavingEdit}
        canUseAiMetadata={canUseAiMetadata}
      />
    </div>
  );
}

interface DraftActionsProps {
  draft: Draft;
  onDelete: (draft: Draft) => void;
  onDuplicate: (draft: Draft) => void;
  isDeletingId: string | null;
  isDuplicatingId: string | null;
}

function DraftActions({
  draft,
  onDelete,
  onDuplicate,
  isDeletingId,
  isDuplicatingId,
}: DraftActionsProps) {
  return (
    <div className="inline-flex max-w-full flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDuplicate(draft);
        }}
        disabled={isDuplicatingId === draft.id}
        className="pointer-events-auto whitespace-nowrap rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
      >
        {isDuplicatingId === draft.id ? 'Copying...' : 'Duplicate'}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(draft);
        }}
        disabled={isDeletingId === draft.id}
        className="pointer-events-auto inline-flex items-center justify-center whitespace-nowrap rounded-md border border-border bg-background p-1.5 text-foreground transition-colors hover:bg-muted disabled:opacity-60"
        aria-label="Delete draft"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

/** True when the draft has a real upload timestamp (aligned with GET /api/drafts backfill). */
function hasNonEmptyUsedInUploadAt(draft: Draft): boolean {
  return typeof draft.usedInUploadAt === 'string' && draft.usedInUploadAt.trim() !== '';
}

function UsedIndicator({ used }: { used: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${used ? 'border-border bg-muted text-foreground' : 'border-border bg-background text-muted-foreground'}`}
    >
      {used ? 'Used in upload' : 'Not uploaded'}
    </span>
  );
}

interface DraftCollectionProps {
  drafts: Draft[];
  onEdit: (draft: Draft) => void;
  onDelete: (draft: Draft) => void;
  onDuplicate: (draft: Draft) => void;
  isDeletingId: string | null;
  isDuplicatingId: string | null;
}

function DraftsTable({
  drafts,
  onEdit,
  onDelete,
  onDuplicate,
  isDeletingId,
  isDuplicatingId,
}: DraftCollectionProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="w-[30%] px-3 py-3 text-left sm:px-4">
              Draft title
            </th>
            <th scope="col" className="w-[16%] px-3 py-3 text-left sm:px-4">
              Last edited
            </th>
            <th scope="col" className="w-[16%] px-3 py-3 text-left sm:px-4">
              Status
            </th>
            <th scope="col" className="w-[38%] px-3 py-3 text-right sm:px-4">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((draft) => {
            const displayTitle = draft.title.trim() || 'Untitled draft';
            return (
              <tr
                key={draft.id}
                className="border-b border-border transition-colors hover:bg-muted/40"
              >
                <td className="p-0 align-top">
                  <button
                    type="button"
                    onClick={() => onEdit(draft)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onEdit(draft);
                      }
                    }}
                    aria-label={`Edit draft "${displayTitle}"`}
                    className="block w-full px-3 py-3 text-left sm:px-4"
                  >
                    <span className="block max-w-full truncate text-foreground">
                      {displayTitle}
                    </span>
                  </button>
                </td>
                <td className="p-0 align-top text-muted-foreground">
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => onEdit(draft)}
                    aria-label={`Edit draft "${displayTitle}"`}
                    className="block w-full px-3 py-3 text-left sm:px-4"
                  >
                    <span className="block truncate">{formatLastEdited(draft.$updatedAt)}</span>
                  </button>
                </td>
                <td className="p-0 align-top">
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => onEdit(draft)}
                    aria-label={`Edit draft "${displayTitle}"`}
                    className="block w-full px-3 py-3 text-left sm:px-4"
                  >
                    <UsedIndicator used={hasNonEmptyUsedInUploadAt(draft)} />
                  </button>
                </td>
                <td className="p-0 align-top text-right">
                  <div className="relative">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => onEdit(draft)}
                      aria-label={`Edit draft "${displayTitle}"`}
                      className="absolute inset-0 z-0"
                    />
                    <div
                      className="relative z-10 px-3 py-3 sm:px-4"
                      role="button"
                      tabIndex={0}
                      aria-label={`Edit draft "${displayTitle}"`}
                      onClick={() => onEdit(draft)}
                      onKeyDown={(event) => {
                        const target = event.target as HTMLElement | null;
                        if (target && target.closest('button') && target !== event.currentTarget) {
                          return;
                        }
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onEdit(draft);
                        }
                      }}
                    >
                      <DraftActions
                        draft={draft}
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

function DraftCards({
  drafts,
  onEdit,
  onDelete,
  onDuplicate,
  isDeletingId,
  isDuplicatingId,
}: DraftCollectionProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {drafts.map((draft) => {
        const displayTitle = draft.title.trim() || 'Untitled draft';
        return (
          <div
            key={draft.id}
            className="relative rounded-xl border border-border bg-background shadow-sm transition-colors hover:bg-muted/30"
          >
            <button
              type="button"
              onClick={() => onEdit(draft)}
              aria-label={`Edit draft "${displayTitle}"`}
              className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="relative z-0 p-4">
              <div className="space-y-2">
                <h3 className="line-clamp-1 text-sm font-semibold text-foreground">
                  {displayTitle}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Last edited {formatLastEdited(draft.$updatedAt)}
                </p>
                <UsedIndicator used={hasNonEmptyUsedInUploadAt(draft)} />
              </div>
            </div>
            <div className="relative z-20 px-4 pb-4 pointer-events-none">
              <DraftActions
                draft={draft}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                isDeletingId={isDeletingId}
                isDuplicatingId={isDuplicatingId}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
