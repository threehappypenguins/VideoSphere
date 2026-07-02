'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Copy, Loader2, Trash2 } from 'lucide-react';
import { DraftMetadataModal, type DraftEditorValues } from '@/components/drafts/DraftMetadataModal';
import { backupNamingForStorage, normalizeBackupFileNameSettings } from '@/lib/backup-filename';
import { useOnboardingContext } from '@/components/onboarding/OnboardingContext';
import type {
  ApiResponse,
  ConnectedAccountPlatform,
  ConnectedAccountPublic,
  Draft,
  DraftLabelDefinition,
} from '@/types';
import { DraftLabelChip } from '@/components/drafts/DraftLabelChip';
import { getUsableConnectedPlatforms } from '@/lib/platforms/connection-status';

const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
type VideosView = 'list' | 'cards';

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
    labels: draft.labels ?? [],
    visibility: draft.visibility,
    targets: [...draft.targets],
    platforms: draft.platforms ?? {},
    backupNaming: normalizeBackupFileNameSettings(draft.backupNaming),
    ...(draft.thumbnailR2Key ? { thumbnailR2Key: draft.thumbnailR2Key } : {}),
    ...(draft.thumbnailContentType ? { thumbnailContentType: draft.thumbnailContentType } : {}),
    ...(draft.thumbnailPreviewUrl ? { thumbnailPreviewUrl: draft.thumbnailPreviewUrl } : {}),
  };
}

function isMinimalCreateDraft(draft: Draft): boolean {
  return (
    draft.title.trim() === '' &&
    draft.description.trim() === '' &&
    draft.tags.length === 0 &&
    draft.targets.length === 0 &&
    !draft.thumbnailR2Key &&
    !draft.thumbnailPreviewUrl
  );
}

/**
 * Renders the dashboard Videos page.
 * @returns The rendered UI output.
 */
export default function VideosPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setOnboardingDraftId } = useOnboardingContext();
  const handledEditDraftIdRef = useRef<string | null>(null);
  const handledCreateDraftIdRef = useRef<string | null>(null);
  /** Prevents duplicate router.replace when opening create from URL query (e.g. React Strict Mode). */
  const handledOpenCreateQueryRef = useRef(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [labelLibrary, setLabelLibrary] = useState<DraftLabelDefinition[]>([]);
  const [connectedPlatforms, setConnectedPlatforms] = useState<ConnectedAccountPlatform[]>([]);
  const [hasLoadedConnections, setHasLoadedConnections] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [view, setView] = useState<VideosView>('list');
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
  /** True only when closing the create modal should delete the backing draft row. */
  const shouldDeleteCreateDraftOnCancelRef = useRef(false);
  /** Baseline targets when minimal create opened (updated if auto-fill effect adds platforms). */
  const createModalBaselineTargetsRef = useRef<ConnectedAccountPlatform[] | null>(null);
  /** Blocks duplicate POST when the duplicate button is clicked again before re-render. */
  const duplicatingDraftIdRef = useRef<string | null>(null);

  const loadDrafts = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage(null);
    setHasLoadedConnections(false);

    try {
      const [draftsResponse, connectionsResponse, aiAccessResponse, labelsResponse] =
        await Promise.all([
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
          fetch('/api/drafts/labels', {
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
          ? getUsableConnectedPlatforms(connectionsPayload.data)
          : [];
      }
      setConnectedPlatforms(platforms);
      setHasLoadedConnections(connectionsResponse.ok);

      const aiAccessPayload = aiAccessResponse.ok
        ? ((await aiAccessResponse.json()) as { canUseAiMetadata?: boolean })
        : null;

      setDrafts(Array.isArray(draftsJson.data) ? draftsJson.data : []);
      if (labelsResponse.ok) {
        const labelsPayload = (await labelsResponse.json()) as ApiResponse<DraftLabelDefinition[]>;
        setLabelLibrary(Array.isArray(labelsPayload.data) ? labelsPayload.data : []);
      } else {
        setLabelLibrary([]);
      }
      setCanUseAiMetadata(Boolean(aiAccessPayload?.canUseAiMetadata));
    } catch (error) {
      if (signal?.aborted) return;
      const message = error instanceof Error ? error.message : 'Failed to load drafts.';
      setErrorMessage(message);
      setDrafts([]);
      setLabelLibrary([]);
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
    } else {
      // Clear stale draft ID when onboarding ends or draft is cleared
      setOnboardingDraftId(null);
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
      if (creatingDraft?.id === draft.id || editingDraft?.id === draft.id) {
        toast.error('Close the draft editor before deleting this draft.');
        return;
      }

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
    [creatingDraft?.id, editingDraft?.id, loadDrafts]
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
      if (duplicatingDraftIdRef.current === draft.id) return;
      duplicatingDraftIdRef.current = draft.id;
      setIsDuplicatingId(draft.id);
      try {
        const response = await fetch('/api/drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `${draft.title} (copy)`,
            description: draft.description,
            tags: draft.tags,
            labels: draft.labels,
            targets: draft.targets,
            visibility: draft.visibility,
            platforms: draft.platforms,
            backupNaming: draft.backupNaming,
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
        duplicatingDraftIdRef.current = null;
        setIsDuplicatingId(null);
      }
    },
    [loadDrafts]
  );

  const handleSaveEdit = useCallback(
    async (options?: {
      closeAfterSave?: boolean;
    }): Promise<{ saved: boolean; draftId?: string; message?: string }> => {
      if (!editingDraft) return { saved: false };
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
            labels: editingDraft.labels,
            visibility: editingDraft.visibility,
            targets: editingDraft.targets,
            platforms: editingDraft.platforms,
            backupNaming: backupNamingForStorage(editingDraft.backupNaming),
          }),
        });
        if (!response.ok) {
          const err = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(err?.message ?? 'Failed to update draft');
        }
        const payload = (await response.json()) as ApiResponse<Draft>;
        const updatedDraft = payload.data;
        if (updatedDraft && options?.closeAfterSave !== true) {
          setEditingDraft(createEditorValues(updatedDraft));
        }
        if (options?.closeAfterSave === true) {
          setEditingDraft(null);
        }
        await loadDrafts();
        return { saved: true, draftId: editingDraft.id, message: 'Draft updated' };
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
    }): Promise<{ saved: boolean; draftId?: string; message?: string }> => {
      if (!creatingDraft) return { saved: false };
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
            labels: creatingDraft.labels,
            visibility: creatingDraft.visibility,
            targets: creatingDraft.targets,
            platforms: creatingDraft.platforms,
            backupNaming: backupNamingForStorage(creatingDraft.backupNaming),
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
        const saveMessage = isExistingDraft ? 'Draft updated' : 'Draft created';
        setCreateDraftSaved(true);

        if (options?.closeAfterSave === true) {
          setCreatingDraft(null);
          setCreateDraftSaved(false);
        }
        return { saved: true, draftId: createdDraft.id, message: saveMessage };
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
      shouldDeleteCreateDraftOnCancelRef.current = true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create draft');
    } finally {
      setIsOpeningCreate(false);
    }
  }, [connectedPlatforms]);

  const openExistingCreateDraft = useCallback(
    async (draftId: string) => {
      setIsOpeningCreate(true);
      try {
        const response = await fetch(`/api/drafts/${draftId}`, { cache: 'no-store' });
        if (!response.ok) {
          const err = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(err?.message ?? 'Failed to open draft');
        }

        const payload = (await response.json()) as ApiResponse<Draft>;
        const draft = payload.data;
        if (!draft) {
          throw new Error('Failed to open draft');
        }

        const draftWasMinimal = isMinimalCreateDraft(draft);
        const initialTargets =
          draft.targets.length > 0
            ? [...draft.targets]
            : connectedPlatforms.length > 0
              ? [...connectedPlatforms]
              : [];
        createModalBaselineTargetsRef.current = initialTargets;
        setCreatingDraft({
          ...createEditorValues(draft),
          targets: initialTargets,
        });
        setCreateDraftSaved(!draftWasMinimal);
        shouldDeleteCreateDraftOnCancelRef.current = draftWasMinimal;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to open draft');
      } finally {
        setIsOpeningCreate(false);
      }
    },
    [connectedPlatforms]
  );

  useEffect(() => {
    const shouldOpenCreate =
      searchParams.get('openCreateDraft') === 'true' || searchParams.get('openWizard') === 'true';
    if (!shouldOpenCreate) {
      handledOpenCreateQueryRef.current = false;
      return;
    }
    if (creatingDraft || isOpeningCreate || handledOpenCreateQueryRef.current) return;

    handledOpenCreateQueryRef.current = true;
    void handleOpenCreateModal();

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('openCreateDraft');
    nextParams.delete('openWizard');
    const q = nextParams.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }, [searchParams, creatingDraft, handleOpenCreateModal, isOpeningCreate, pathname, router]);

  useEffect(() => {
    const createDraftId = searchParams.get('createDraftId');
    if (!createDraftId) {
      handledCreateDraftIdRef.current = null;
      return;
    }
    if (handledCreateDraftIdRef.current === createDraftId) return;
    if (creatingDraft || isOpeningCreate) return;

    handledCreateDraftIdRef.current = createDraftId;
    void openExistingCreateDraft(createDraftId);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('createDraftId');
    const q = nextParams.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }, [searchParams, creatingDraft, isOpeningCreate, openExistingCreateDraft, pathname, router]);

  const handleCloseCreateModal = useCallback(async () => {
    if (creatingDraft?.id) {
      if (!createDraftSaved && shouldDeleteCreateDraftOnCancelRef.current) {
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
    shouldDeleteCreateDraftOnCancelRef.current = false;
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
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Videos</h1>
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
            <VideosTable
              drafts={drafts}
              labelLibrary={labelLibrary}
              onEdit={(draft) => {
                void openEditDraft(draft);
              }}
              onDelete={handleDeleteDraft}
              onDuplicate={handleDuplicateDraft}
              isDeletingId={isDeletingId}
              isDuplicatingId={isDuplicatingId}
            />
          ) : (
            <VideosCards
              drafts={drafts}
              labelLibrary={labelLibrary}
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
        labelLibrary={labelLibrary}
        onLabelLibraryChange={setLabelLibrary}
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
        labelLibrary={labelLibrary}
        onLabelLibraryChange={setLabelLibrary}
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

interface VideosRowActionsProps {
  draft: Draft;
  onDelete: (draft: Draft) => void;
  onDuplicate: (draft: Draft) => void;
  isDeletingId: string | null;
  isDuplicatingId: string | null;
}

const draftActionIconButtonClassName =
  'pointer-events-auto inline-flex shrink-0 h-12 w-12 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors hover:bg-muted disabled:opacity-60';

function VideosRowActions({
  draft,
  onDelete,
  onDuplicate,
  isDeletingId,
  isDuplicatingId,
}: VideosRowActionsProps) {
  const isDuplicating = isDuplicatingId === draft.id;

  return (
    <div className="inline-flex shrink-0 items-center gap-3">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDuplicate(draft);
        }}
        disabled={isDuplicating}
        className={draftActionIconButtonClassName}
        aria-label={isDuplicating ? 'Copying draft' : 'Duplicate draft'}
      >
        {isDuplicating ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Copy className="h-4 w-4" aria-hidden />
        )}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(draft);
        }}
        disabled={isDeletingId === draft.id}
        className={draftActionIconButtonClassName}
        aria-label="Delete draft"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

/** True when the draft has a real upload timestamp (aligned with GET /api/drafts backfill). */
function hasNonEmptyUsedInUploadAt(draft: Draft): boolean {
  return typeof draft.usedInUploadAt === 'string' && draft.usedInUploadAt.trim() !== '';
}

function partitionDraftsByUploadStatus(drafts: Draft[]): { unused: Draft[]; used: Draft[] } {
  const unused: Draft[] = [];
  const used: Draft[] = [];
  for (const draft of drafts) {
    if (hasNonEmptyUsedInUploadAt(draft)) {
      used.push(draft);
    } else {
      unused.push(draft);
    }
  }
  return { unused, used };
}

function UsedIndicator({ used }: { used: boolean }) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-center text-[11px] font-medium leading-snug ${
        used
          ? 'border-amber-500/40 bg-amber-500/15 text-amber-950 dark:text-amber-100'
          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100'
      }`}
    >
      {used ? 'Used in upload' : 'Ready to upload'}
    </span>
  );
}

interface VideosSectionProps {
  title: string;
  description: string;
  used?: boolean;
  children: ReactNode;
}

function VideosSection({ title, description, used = false, children }: VideosSectionProps) {
  return (
    <section
      className={`space-y-3 rounded-xl border p-4 sm:p-5 ${
        used ? 'border-amber-500/30 bg-amber-500/5' : 'border-border bg-background'
      }`}
    >
      <header className="space-y-1">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  );
}

interface VideosCollectionProps {
  drafts: Draft[];
  labelLibrary: DraftLabelDefinition[];
  onEdit: (draft: Draft) => void;
  onDelete: (draft: Draft) => void;
  onDuplicate: (draft: Draft) => void;
  isDeletingId: string | null;
  isDuplicatingId: string | null;
}

function VideosTable({
  drafts,
  labelLibrary,
  onEdit,
  onDelete,
  onDuplicate,
  isDeletingId,
  isDuplicatingId,
}: VideosCollectionProps) {
  const { unused, used } = partitionDraftsByUploadStatus(drafts);

  return (
    <div className="space-y-6">
      {unused.length > 0 ? (
        <VideosSection
          title="Ready to upload"
          description="Drafts that have not been used for an upload yet."
        >
          <VideosTableContent
            drafts={unused}
            labelLibrary={labelLibrary}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            isDeletingId={isDeletingId}
            isDuplicatingId={isDuplicatingId}
          />
        </VideosSection>
      ) : null}
      {used.length > 0 ? (
        <VideosSection
          title="Used in upload"
          description="These drafts were already used to start an upload. Duplicate one if you need to publish again."
          used
        >
          <VideosTableContent
            drafts={used}
            labelLibrary={labelLibrary}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            isDeletingId={isDeletingId}
            isDuplicatingId={isDuplicatingId}
            dimUsedRows
          />
        </VideosSection>
      ) : null}
    </div>
  );
}

function VideosMobileRow({
  draft,
  used,
  labelLibrary,
  dimUsedRows = false,
  onEdit,
  onDelete,
  onDuplicate,
  isDeletingId,
  isDuplicatingId,
}: {
  draft: Draft;
  used: boolean;
  labelLibrary: DraftLabelDefinition[];
  dimUsedRows?: boolean;
  onEdit: (draft: Draft) => void;
  onDelete: (draft: Draft) => void;
  onDuplicate: (draft: Draft) => void;
  isDeletingId: string | null;
  isDuplicatingId: string | null;
}) {
  const displayTitle = draft.title.trim() || 'Untitled draft';

  return (
    <article className={`relative px-3 py-3 sm:px-4 ${dimUsedRows ? 'bg-muted/20' : ''}`}>
      <button
        type="button"
        onClick={() => onEdit(draft)}
        aria-label={`Edit draft "${displayTitle}"`}
        className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      />
      <div className="relative z-0">
        <span className="text-sm font-medium text-foreground">{displayTitle}</span>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs text-muted-foreground">
            {formatLastEdited(draft.$updatedAt)}
          </span>
          <UsedIndicator used={used} />
          <VideosLabelChips
            labels={draft.labels ?? []}
            labelLibrary={labelLibrary}
            className="min-w-0 flex-1 basis-full sm:basis-auto sm:flex-initial"
          />
          <div className="relative z-20 ml-auto pointer-events-auto">
            <VideosRowActions
              draft={draft}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              isDeletingId={isDeletingId}
              isDuplicatingId={isDuplicatingId}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function VideosLabelChips({
  labels,
  labelLibrary,
  className,
}: {
  labels: string[];
  labelLibrary: DraftLabelDefinition[];
  className?: string;
}) {
  if (labels.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-1 ${className ?? 'mt-1.5'}`}>
      {labels.map((label) => (
        <li key={label}>
          <DraftLabelChip label={label} library={labelLibrary} />
        </li>
      ))}
    </ul>
  );
}

function VideosTableContent({
  drafts,
  labelLibrary,
  onEdit,
  onDelete,
  onDuplicate,
  isDeletingId,
  isDuplicatingId,
  dimUsedRows = false,
}: VideosCollectionProps & { dimUsedRows?: boolean }) {
  return (
    <>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background md:hidden">
        {drafts.map((draft) => (
          <VideosMobileRow
            key={draft.id}
            draft={draft}
            used={hasNonEmptyUsedInUploadAt(draft)}
            labelLibrary={labelLibrary}
            dimUsedRows={dimUsedRows}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            isDeletingId={isDeletingId}
            isDuplicatingId={isDuplicatingId}
          />
        ))}
      </div>
      <div className="hidden overflow-hidden rounded-xl border border-border bg-background md:block">
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="w-[38%] px-4 py-3 text-left">
                Draft title
              </th>
              <th scope="col" className="w-[16%] px-4 py-3 text-left">
                Last edited
              </th>
              <th scope="col" className="w-[16%] px-4 py-3 text-left">
                Status
              </th>
              <th scope="col" className="w-[20%] px-4 py-3 text-left">
                Labels
              </th>
              <th scope="col" className="w-[10%] py-3 pl-2 pr-4 text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft) => {
              const displayTitle = draft.title.trim() || 'Untitled draft';
              const used = hasNonEmptyUsedInUploadAt(draft);
              return (
                <tr
                  key={draft.id}
                  className={`border-b border-border transition-colors hover:bg-muted/40 ${
                    dimUsedRows ? 'bg-muted/20' : ''
                  }`}
                >
                  <td className="p-0 align-middle">
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
                      className="flex min-h-12 w-full items-center px-4 py-3 text-left"
                    >
                      <span className="block max-w-full truncate text-foreground">
                        {displayTitle}
                      </span>
                    </button>
                  </td>
                  <td className="p-0 align-middle text-muted-foreground">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => onEdit(draft)}
                      aria-label={`Edit draft "${displayTitle}"`}
                      className="flex min-h-12 w-full items-center px-4 py-3 text-left"
                    >
                      <span className="block truncate">{formatLastEdited(draft.$updatedAt)}</span>
                    </button>
                  </td>
                  <td className="p-0 align-middle">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => onEdit(draft)}
                      aria-label={`Edit draft "${displayTitle}"`}
                      className="flex min-h-12 w-full items-center px-4 py-3 text-left"
                    >
                      <UsedIndicator used={used} />
                    </button>
                  </td>
                  <td className="p-0 align-middle">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => onEdit(draft)}
                      aria-label={`Edit draft "${displayTitle}"`}
                      className="flex min-h-12 w-full items-center px-4 py-3 text-left"
                    >
                      <VideosLabelChips
                        labels={draft.labels ?? []}
                        labelLibrary={labelLibrary}
                        className="mt-0"
                      />
                    </button>
                  </td>
                  <td className="p-0 align-middle text-right">
                    <div className="relative">
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => onEdit(draft)}
                        aria-label={`Edit draft "${displayTitle}"`}
                        className="absolute inset-0 z-0"
                      />
                      <div
                        className="relative z-10 flex min-h-12 items-center justify-end py-3 pl-2 pr-4"
                        role="button"
                        tabIndex={0}
                        aria-label={`Edit draft "${displayTitle}"`}
                        onClick={() => onEdit(draft)}
                        onKeyDown={(event) => {
                          const target = event.target as HTMLElement | null;
                          if (
                            target &&
                            target.closest('button') &&
                            target !== event.currentTarget
                          ) {
                            return;
                          }
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onEdit(draft);
                          }
                        }}
                      >
                        <VideosRowActions
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
    </>
  );
}

function VideosCards({
  drafts,
  labelLibrary,
  onEdit,
  onDelete,
  onDuplicate,
  isDeletingId,
  isDuplicatingId,
}: VideosCollectionProps) {
  const { unused, used } = partitionDraftsByUploadStatus(drafts);

  return (
    <div className="space-y-6">
      {unused.length > 0 ? (
        <VideosSection
          title="Ready to upload"
          description="Drafts that have not been used for an upload yet."
        >
          <VideosCardsGrid
            drafts={unused}
            labelLibrary={labelLibrary}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            isDeletingId={isDeletingId}
            isDuplicatingId={isDuplicatingId}
          />
        </VideosSection>
      ) : null}
      {used.length > 0 ? (
        <VideosSection
          title="Used in upload"
          description="These drafts were already used to start an upload. Duplicate one if you need to publish again."
          used
        >
          <VideosCardsGrid
            drafts={used}
            labelLibrary={labelLibrary}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            isDeletingId={isDeletingId}
            isDuplicatingId={isDuplicatingId}
            dimUsedCards
          />
        </VideosSection>
      ) : null}
    </div>
  );
}

function VideosCardsGrid({
  drafts,
  labelLibrary,
  onEdit,
  onDelete,
  onDuplicate,
  isDeletingId,
  isDuplicatingId,
  dimUsedCards = false,
}: VideosCollectionProps & { dimUsedCards?: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {drafts.map((draft) => {
        const displayTitle = draft.title.trim() || 'Untitled draft';
        const used = hasNonEmptyUsedInUploadAt(draft);
        return (
          <div
            key={draft.id}
            className={`relative rounded-xl border shadow-sm transition-colors hover:bg-muted/30 ${
              dimUsedCards ? 'border-amber-500/30 bg-muted/30' : 'border-border bg-background'
            }`}
          >
            <button
              type="button"
              onClick={() => onEdit(draft)}
              aria-label={`Edit draft "${displayTitle}"`}
              className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="relative z-0 p-4">
              <div className="space-y-2">
                <h3 className="line-clamp-2 text-sm font-semibold text-foreground">
                  {displayTitle}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Last edited {formatLastEdited(draft.$updatedAt)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <UsedIndicator used={used} />
                  <VideosLabelChips
                    labels={draft.labels ?? []}
                    labelLibrary={labelLibrary}
                    className="min-w-0 flex-1 basis-full sm:basis-auto sm:flex-initial mt-0"
                  />
                  <div className="relative z-20 ml-auto shrink-0 pointer-events-auto">
                    <VideosRowActions
                      draft={draft}
                      onDelete={onDelete}
                      onDuplicate={onDuplicate}
                      isDeletingId={isDeletingId}
                      isDuplicatingId={isDuplicatingId}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
