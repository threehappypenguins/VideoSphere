import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Loader2, Redo2, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { DraftPlatformToggles } from '@/components/drafts/DraftPlatformToggles';
import type {
  ApiResponse,
  ConnectedAccountPlatform,
  ConnectedAccountPublic,
  Draft,
  PlatformUploadStatus,
  UploadJobStatus,
} from '@/types';

export interface DraftEditorValues {
  id: string;
  title: string;
  description: string;
  tags: string[];
  visibility: Draft['visibility'];
  targets: ConnectedAccountPlatform[];
}

const VISIBILITY_OPTIONS: Array<{ value: Draft['visibility']; label: string }> = [
  { value: 'public', label: 'Public' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'private', label: 'Private' },
];

const PREFERRED_PLATFORM_ORDER: ConnectedAccountPlatform[] = ['youtube', 'vimeo'];

function comparePlatformsByPreference(
  a: ConnectedAccountPlatform,
  b: ConnectedAccountPlatform
): number {
  const ai = PREFERRED_PLATFORM_ORDER.indexOf(a);
  const bi = PREFERRED_PLATFORM_ORDER.indexOf(b);
  const aKnown = ai !== -1;
  const bKnown = bi !== -1;

  if (aKnown && bKnown) return ai - bi;
  if (aKnown) return -1;
  if (bKnown) return 1;
  return a.localeCompare(b);
}

interface DraftMetadataModalProps {
  mode: 'create' | 'edit';
  value: DraftEditorValues | null;
  initialConnectedPlatforms?: ConnectedAccountPlatform[];
  initialConnectionsResolved?: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSave: (options?: { closeAfterSave?: boolean }) => Promise<boolean>;
  onDelete?: (draftId: string) => Promise<boolean>;
  onChange: (next: DraftEditorValues) => void;
  canUseAiMetadata?: boolean;
}

interface DraftUploadHistoryItem {
  uploadJobId: string;
  status: UploadJobStatus;
  createdAt: string;
  updatedAt: string;
  platforms: Array<{
    platform: ConnectedAccountPlatform;
    status: PlatformUploadStatus;
    updatedAt: string;
  }>;
}

export function DraftMetadataModal({
  mode,
  value,
  initialConnectedPlatforms,
  initialConnectionsResolved,
  isSaving,
  onClose,
  onSave,
  onDelete,
  onChange,
  canUseAiMetadata = false,
}: DraftMetadataModalProps) {
  const router = useRouter();
  const draftId = value?.id ?? null;
  const [connectedPlatforms, setConnectedPlatforms] = useState<ConnectedAccountPlatform[]>(
    initialConnectedPlatforms ?? []
  );
  const [usedPlatforms, setUsedPlatforms] = useState<ConnectedAccountPlatform[]>([]);
  const [isLoadingPlatforms, setIsLoadingPlatforms] = useState(false);
  const [hasLoadedConnections, setHasLoadedConnections] = useState(
    Boolean(initialConnectionsResolved)
  );
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [platformWarning, setPlatformWarning] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [currentUploadJobId, setCurrentUploadJobId] = useState<string | null>(null);
  const [isCancellingUpload, setIsCancellingUpload] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showUploadConfirm, setShowUploadConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [uploadHistory, setUploadHistory] = useState<DraftUploadHistoryItem[]>([]);
  const [isLoadingUploadHistory, setIsLoadingUploadHistory] = useState(false);
  const [showUploadHistory, setShowUploadHistory] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiUndoStack, setAiUndoStack] = useState<DraftEditorValues[]>([]);
  const [aiRedoStack, setAiRedoStack] = useState<DraftEditorValues[]>([]);
  const [uploadLimitState, setUploadLimitState] = useState<{
    reached: boolean;
    monthlyUsage?: number;
    limit?: number;
  }>({ reached: false });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const uploadHistoryCacheRef = useRef<Record<string, DraftUploadHistoryItem[]>>({});
  const hadActiveJobsRef = useRef(false);
  const aiMetadataAbortRef = useRef<AbortController | null>(null);
  /** Tracks the open modal’s draft id so we can ignore stale AI responses after close or draft switch. */
  const latestDraftIdRef = useRef<string | null>(null);
  latestDraftIdRef.current = draftId;

  const snapshotEditor = (editor: DraftEditorValues): DraftEditorValues => ({
    ...editor,
    tags: [...editor.tags],
    targets: [...editor.targets],
  });

  const loadUploadHistory = async (id: string, signal?: AbortSignal) => {
    const skipIfAborted = () => Boolean(signal?.aborted);

    setIsLoadingUploadHistory(true);
    try {
      const response = await fetch(`/api/drafts/${id}/upload-history`, {
        cache: 'no-store',
        signal,
      });
      if (skipIfAborted()) return;

      if (!response.ok) {
        if (skipIfAborted()) return;
        setUploadHistory([]);
        uploadHistoryCacheRef.current[id] = [];
        return;
      }
      const payload = (await response.json()) as ApiResponse<DraftUploadHistoryItem[]>;
      if (skipIfAborted()) return;
      const history = Array.isArray(payload.data) ? payload.data : [];
      setUploadHistory(history);
      uploadHistoryCacheRef.current[id] = history;
    } catch (error) {
      if (skipIfAborted()) return;
      const isAbortError =
        (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError';
      if (isAbortError) return;
      if (skipIfAborted()) return;
      setUploadHistory([]);
      uploadHistoryCacheRef.current[id] = [];
    } finally {
      if (!signal?.aborted) {
        setIsLoadingUploadHistory(false);
      }
    }
  };

  const activeUploadJobIds = useMemo(
    () =>
      uploadHistory
        .filter(
          (item) =>
            item.status === 'pending' ||
            item.status === 'uploading' ||
            item.status === 'distributing' ||
            item.platforms.some(
              (platform) => platform.status === 'pending' || platform.status === 'uploading'
            )
        )
        .map((item) => item.uploadJobId),
    [uploadHistory]
  );

  useEffect(() => {
    if (!draftId) {
      setUsedPlatforms([]);
      setUploadHistory([]);
      setShowUploadHistory(false);
      setIsLoadingUploadHistory(false);
      return;
    }
    // Prevent stale history from the previously opened draft from flashing
    // while the current draft's history request is in flight.
    const cached = uploadHistoryCacheRef.current[draftId];
    setUploadHistory(cached ?? []);
    setIsLoadingUploadHistory(cached === undefined);
  }, [draftId]);

  useEffect(() => {
    return () => {
      aiMetadataAbortRef.current?.abort();
    };
  }, [draftId]);

  useEffect(() => {
    if (initialConnectedPlatforms) {
      setConnectedPlatforms(initialConnectedPlatforms);
    }
  }, [initialConnectedPlatforms]);

  useEffect(() => {
    if (typeof initialConnectionsResolved === 'boolean') {
      setHasLoadedConnections(initialConnectionsResolved);
    }
  }, [initialConnectionsResolved]);

  useEffect(() => {
    if (!draftId) return;
    const controller = new AbortController();

    setUsedPlatforms([]);

    const loadUsedPlatforms = async () => {
      try {
        const response = await fetch(`/api/drafts/${draftId}/used-platforms`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) return;
        const payload = (await response.json()) as ApiResponse<ConnectedAccountPlatform[]>;
        if (!Array.isArray(payload.data)) return;
        setUsedPlatforms(payload.data);
      } catch {
        if (controller.signal.aborted) return;
        // Best-effort enhancement; keep modal usable if this request fails.
        setUsedPlatforms([]);
      }
    };

    void loadUsedPlatforms();
    return () => controller.abort();
  }, [draftId]);

  useEffect(() => {
    if (!draftId) return;
    const controller = new AbortController();
    void loadUploadHistory(draftId, controller.signal);
    return () => controller.abort();
  }, [draftId]);

  useEffect(() => {
    if (activeUploadJobIds.length === 0) {
      // If we just transitioned from active -> idle, do one final full refresh
      // to avoid stale "uploading" states from the last targeted poll tick.
      if (hadActiveJobsRef.current && draftId) {
        hadActiveJobsRef.current = false;
        void loadUploadHistory(draftId);
      }
      return;
    }
    hadActiveJobsRef.current = true;

    const pollActiveJobs = async () => {
      const responses = await Promise.all(
        activeUploadJobIds.map(async (uploadJobId) => {
          try {
            const response = await fetch(`/api/uploads/jobs/${uploadJobId}`, { cache: 'no-store' });
            if (!response.ok) return null;
            const payload = (await response.json()) as ApiResponse<DraftUploadHistoryItem>;
            return payload.data;
          } catch {
            return null;
          }
        })
      );

      const byId = new Map(
        responses
          .filter((item): item is DraftUploadHistoryItem => item !== null)
          .map((item) => [item.uploadJobId, item])
      );

      if (byId.size === 0) return;

      setUploadHistory((prev) => prev.map((item) => byId.get(item.uploadJobId) ?? item));
    };

    // Poll immediately so UI updates without waiting for first interval tick.
    void pollActiveJobs();
    const intervalId = window.setInterval(() => {
      void pollActiveJobs();
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [activeUploadJobIds, draftId]);

  useEffect(() => {
    if (!draftId) return;

    // Drafts page (and similar parents) may already fetch connections with the same
    // freshness guarantees; avoid a duplicate request on every modal open.
    if (initialConnectionsResolved) {
      setConnectionsError(null);
      setIsLoadingPlatforms(false);
      return;
    }

    const controller = new AbortController();

    const loadConnections = async () => {
      setConnectionsError(null);
      setIsLoadingPlatforms(true);
      setHasLoadedConnections(false);
      try {
        const response = await fetch('/api/platforms/connections', {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) {
          const err = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(err?.message ?? 'Failed to load connected platforms');
        }
        const payload = (await response.json()) as ApiResponse<ConnectedAccountPublic[]>;
        const platforms = Array.isArray(payload.data)
          ? payload.data.map((acc) => acc.platform)
          : [];
        setConnectedPlatforms(platforms);
      } catch (error) {
        if (controller.signal.aborted) return;
        setConnectedPlatforms([]);
        setConnectionsError(
          error instanceof Error ? error.message : 'Failed to load connected platforms'
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingPlatforms(false);
          setHasLoadedConnections(true);
        }
      }
    };

    void loadConnections();
    return () => controller.abort();
  }, [draftId, initialConnectionsResolved]);

  useEffect(() => {
    if (!value) {
      setPlatformWarning(null);
      setTagInput('');
      setUploadComplete(false);
      return;
    }
    if (value.targets.length > 0) {
      setPlatformWarning(null);
    }
  }, [value]);

  useEffect(() => {
    if (!draftId) {
      setAiPrompt('');
      setIsGeneratingAi(false);
      setAiUndoStack([]);
      setAiRedoStack([]);
      return;
    }
    setAiUndoStack([]);
    setAiRedoStack([]);
  }, [draftId]);

  const commitTagsFromInput = () => {
    if (!value) return;
    const parsed = tagInput
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (parsed.length === 0) return;
    const merged = [...value.tags];
    for (const tag of parsed) {
      if (!merged.includes(tag)) {
        merged.push(tag);
      }
    }
    onChange({ ...value, tags: merged });
    setTagInput('');
  };

  const displayPlatforms = useMemo(() => {
    if (!value) return [] as ConnectedAccountPlatform[];

    // Keep a stable visual order so toggling platforms does not reshuffle rows.
    // Priority:
    // 1) Connected platforms (connection list order)
    // 2) Selected-but-disconnected platforms (alphabetical)
    // 3) Used-but-not-yet-listed platforms (alphabetical)
    const connectedSet = new Set(connectedPlatforms);
    const connectedOrdered = [...connectedPlatforms].sort(comparePlatformsByPreference);

    const selectedDisconnected = value.targets
      .filter((platform) => !connectedSet.has(platform))
      .sort((a, b) => a.localeCompare(b));

    const listedSet = new Set<ConnectedAccountPlatform>([
      ...connectedOrdered,
      ...selectedDisconnected,
    ]);
    const usedRemainder = usedPlatforms
      .filter((platform) => !listedSet.has(platform))
      .sort((a, b) => a.localeCompare(b));

    return [...connectedOrdered, ...selectedDisconnected, ...usedRemainder];
  }, [connectedPlatforms, usedPlatforms, value]);

  const disconnectedSelectedPlatforms = useMemo(() => {
    if (!value) return [] as ConnectedAccountPlatform[];
    const connectedSet = new Set(connectedPlatforms);
    return value.targets.filter((platform) => !connectedSet.has(platform));
  }, [connectedPlatforms, value]);

  const connectionsResolvedSuccessfully = hasLoadedConnections && connectionsError === null;

  const canSave =
    !isSaving &&
    !uploading &&
    !isCancellingUpload &&
    value !== null &&
    value.targets.length > 0 &&
    (!connectionsResolvedSuccessfully || disconnectedSelectedPlatforms.length === 0) &&
    value.title.trim() !== '';
  const hasGeneratedMetadata =
    value !== null &&
    (value.title.trim() !== '' || value.description.trim() !== '' || value.tags.length > 0);

  const applyAiMetadata = (next: Pick<DraftEditorValues, 'title' | 'description' | 'tags'>) => {
    if (!value) return;
    setAiUndoStack((prev) => [...prev, snapshotEditor(value)]);
    setAiRedoStack([]);
    onChange({
      ...value,
      title: next.title,
      description: next.description,
      tags: next.tags,
    });
  };

  const handleUndoAi = () => {
    if (!value || aiUndoStack.length === 0) return;
    const previous = aiUndoStack[aiUndoStack.length - 1];
    setAiUndoStack((prev) => prev.slice(0, -1));
    setAiRedoStack((prev) => [...prev, snapshotEditor(value)]);
    onChange(snapshotEditor(previous));
  };

  const handleRedoAi = () => {
    if (!value || aiRedoStack.length === 0) return;
    const next = aiRedoStack[aiRedoStack.length - 1];
    setAiRedoStack((prev) => prev.slice(0, -1));
    setAiUndoStack((prev) => [...prev, snapshotEditor(value)]);
    onChange(snapshotEditor(next));
  };

  const handleGenerateAiMetadata = async () => {
    if (!value) return;
    if (value.targets.length === 0) {
      toast.error('Please select at least one platform first');
      return;
    }

    const requestDraftId = value.id;
    aiMetadataAbortRef.current?.abort();
    const ac = new AbortController();
    aiMetadataAbortRef.current = ac;

    setIsGeneratingAi(true);
    try {
      const response = await fetch('/api/ai/generate-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: videoFile?.name ?? 'video',
          userPrompt: aiPrompt.trim() || undefined,
          platforms: value.targets,
        }),
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (!response.ok) {
        const errBody = await response.json().catch(() => null);
        throw new Error(errBody?.message ?? 'Failed to generate metadata');
      }

      const next = (await response.json()) as ApiResponse<{
        title: string;
        description: string;
        tags: string[];
      }>;
      if (ac.signal.aborted) return;
      if (latestDraftIdRef.current !== requestDraftId) return;

      applyAiMetadata({
        title: next.data?.title ?? '',
        description: next.data?.description ?? '',
        tags: Array.isArray(next.data?.tags) ? next.data.tags : [],
      });
      toast.success('Metadata generated successfully');
    } catch (error) {
      const isAbort =
        (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError';
      if (isAbort) return;
      // Keep UX aligned with DraftWizard messaging without triggering
      // Next.js dev error overlay from client-side console.error.
      console.warn('AI metadata generation failed:', error);
      toast.error('Failed to generate metadata. Please try again.');
    } finally {
      // Only clear loading if this is still the active request (avoids a superseded
      // generation turning off the spinner while a newer one is in flight).
      if (aiMetadataAbortRef.current === ac) {
        aiMetadataAbortRef.current = null;
        setIsGeneratingAi(false);
      }
    }
  };

  const handleTogglePlatform = (platform: ConnectedAccountPlatform) => {
    if (!value) return;
    const isSelected = value.targets.includes(platform);
    if (isSelected && value.targets.length === 1) {
      setPlatformWarning('At least one platform must remain selected.');
      return;
    }
    setPlatformWarning(null);
    onChange({
      ...value,
      targets: isSelected
        ? value.targets.filter((p) => p !== platform)
        : [...value.targets, platform],
    });
  };

  const handleConnectClick = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const didSave = await onSave({ closeAfterSave: false });
    if (didSave) {
      router.push('/profile/connections');
    }
  };

  const handleConnectAction = async () => {
    const didSave = await onSave({ closeAfterSave: false });
    if (didSave) {
      router.push('/profile/connections');
    }
  };

  const handleUploadVideo = async () => {
    if (!value || !videoFile) return;

    const didSave = await onSave({ closeAfterSave: false });
    if (!didSave) return;

    let activeUploadJobId: string | null = null;

    try {
      setUploading(true);
      setUploadProgress(0);

      const presignRes = await fetch('/api/uploads/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: videoFile.name,
          contentType: videoFile.type,
          fileSize: videoFile.size,
          draftId: value.id,
        }),
      });

      if (!presignRes.ok) {
        const err = (await presignRes.json().catch(() => null)) as {
          message?: string;
          error?: string;
          details?: string;
          monthlyUsage?: number;
          limit?: number;
        } | null;
        if (presignRes.status === 403 && typeof err?.monthlyUsage === 'number') {
          setUploadLimitState({
            reached: true,
            monthlyUsage: err.monthlyUsage,
            limit: typeof err.limit === 'number' ? err.limit : 10,
          });
        }
        const combinedMessage = [
          err?.message ?? err?.error ?? 'Failed to get upload URL',
          err?.details,
        ]
          .filter(Boolean)
          .join(' — ');
        throw new Error(combinedMessage);
      }

      const { uploadUrl, uploadJobId } = (await presignRes.json()) as {
        uploadUrl: string;
        uploadJobId: string;
      };
      activeUploadJobId = uploadJobId;
      setCurrentUploadJobId(uploadJobId);

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', videoFile.type);
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        });
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed with status ${xhr.status}`));
        });
        xhr.addEventListener('error', () =>
          reject(new Error('Upload failed due to network error'))
        );
        xhr.addEventListener('abort', () => reject(new Error('UPLOAD_ABORTED')));
        xhr.send(videoFile);
      });

      const completeRes = await fetch(`/api/uploads/${uploadJobId}/complete`, { method: 'POST' });
      if (!completeRes.ok) {
        const err = (await completeRes.json().catch(() => null)) as {
          message?: string;
          error?: string;
        } | null;
        throw new Error(err?.message ?? err?.error ?? 'Failed to confirm upload');
      }

      activeUploadJobId = null;
      setCurrentUploadJobId(null);
      setVideoFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setUploadProgress(0);
      setUploadComplete(true);
      await loadUploadHistory(value.id);
      setShowUploadHistory(true);
      setUploadLimitState({ reached: false });
      toast.success('Video uploaded successfully');
    } catch (error) {
      setUploadProgress(0);
      if (error instanceof Error && error.message === 'UPLOAD_ABORTED') {
        // Keep currentUploadJobId so handleCancelUpload / clearPendingVideoSelection can
        // finish server-side cancellation; do not clear in finally.
        return;
      }
      if (activeUploadJobId) {
        void fetch(`/api/uploads/${activeUploadJobId}/cancel`, { method: 'POST' }).catch(() => {
          // Best-effort: release quota / mark cancelled when PUT or complete failed.
        });
      }
      setCurrentUploadJobId(null);
      toast.error(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      xhrRef.current = null;
      setUploading(false);
    }
  };

  const handleCancelUpload = async () => {
    if (!uploading || !currentUploadJobId) return;
    setIsCancellingUpload(true);
    try {
      if (xhrRef.current) {
        xhrRef.current.abort();
      }
      const cancelRes = await fetch(`/api/uploads/${currentUploadJobId}/cancel`, {
        method: 'POST',
      });
      if (!cancelRes.ok) {
        const errBody = (await cancelRes.json().catch(() => null)) as {
          message?: string;
          error?: string;
        } | null;
        const details = errBody?.message ?? errBody?.error ?? `(${cancelRes.status})`;
        toast.error(`Failed to cancel upload. ${details}`);
        return;
      }

      clearPendingVideoSelection({ skipServerCancel: true });
      const draftId = value?.id;
      if (draftId) {
        await loadUploadHistory(draftId);
        setShowUploadHistory(true);
      }
      toast.success('Upload cancelled');
    } catch (error) {
      toast.error(
        error instanceof Error
          ? `Failed to cancel upload. ${error.message}`
          : 'Failed to cancel upload'
      );
    } finally {
      setIsCancellingUpload(false);
    }
  };

  const clearPendingVideoSelection = (options?: { skipServerCancel?: boolean }) => {
    const jobId = currentUploadJobId;

    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }

    if (jobId && !options?.skipServerCancel) {
      void fetch(`/api/uploads/${jobId}/cancel`, { method: 'POST' }).catch(() => {
        // Best-effort: job may already be completed, cancelled, or past pending/uploading.
      });
    }

    setVideoFile(null);
    setUploadProgress(0);
    setUploadComplete(false);
    setCurrentUploadJobId(null);
    setUploading(false);
    setIsCancellingUpload(false);
    setUploadLimitState({ reached: false });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDeleteDraft = async () => {
    if (!value || !onDelete) return;
    setIsDeleting(true);
    try {
      const deleted = await onDelete(value.id);
      if (deleted) {
        setShowDeleteConfirm(false);
        clearPendingVideoSelection();
        onClose();
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog
      open={value !== null}
      onOpenChange={(open) => {
        if (!open) {
          clearPendingVideoSelection();
          onClose();
        }
      }}
    >
      <DialogContent
        className="flex max-h-[90vh] flex-col p-0"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="px-6 pt-6">
          <div className="flex items-start justify-between gap-3">
            <DialogTitle>{mode === 'edit' ? 'Edit draft' : 'Draft details'}</DialogTitle>
          </div>
          {mode === 'create' ? (
            <DialogDescription>Configure your draft metadata.</DialogDescription>
          ) : null}
        </DialogHeader>

        {value ? (
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-2">
            {isLoadingPlatforms && displayPlatforms.length === 0 ? (
              <p className="text-xs text-muted-foreground">Loading connected platforms...</p>
            ) : null}
            <DraftPlatformToggles
              availablePlatforms={displayPlatforms}
              selectedPlatforms={value.targets}
              connectedPlatforms={connectedPlatforms}
              connectionsResolved={connectionsResolvedSuccessfully}
              onToggle={handleTogglePlatform}
              onConnectClick={() => {
                void handleConnectAction();
              }}
            />
            {connectedPlatforms.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Don&apos;t see a specific platform?{' '}
                <Link
                  href="/profile/connections"
                  className="underline underline-offset-2"
                  onClick={handleConnectClick}
                >
                  Find it here and connect it.
                </Link>
              </p>
            ) : null}
            {platformWarning ? <p className="text-xs text-red-600">{platformWarning}</p> : null}
            {connectionsError ? (
              <p className="text-xs text-foreground">
                Could not verify platform connections. Reopen the modal or check your session.
              </p>
            ) : null}
            {connectionsResolvedSuccessfully && connectedPlatforms.length === 0 ? (
              <p className="text-xs text-red-600">
                No connected platforms found.{' '}
                <Link href="/profile/connections" className="underline underline-offset-2">
                  Go to Connections
                </Link>
                .
              </p>
            ) : null}
            {connectedPlatforms.length > 0 && disconnectedSelectedPlatforms.length > 0 ? (
              <p className="text-xs text-foreground">
                One or more selected targets are no longer connected. Reconnect them to include them
                again.{' '}
                <Link href="/profile/connections" className="underline underline-offset-2">
                  Open Connections
                </Link>
                .
              </p>
            ) : null}
            {canUseAiMetadata ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                    <Sparkles className="h-4 w-4" />
                    AI metadata
                  </p>
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleUndoAi}
                      disabled={aiUndoStack.length === 0 || isGeneratingAi}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      Undo
                    </button>
                    <button
                      type="button"
                      onClick={handleRedoAi}
                      disabled={aiRedoStack.length === 0 || isGeneratingAi}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <Redo2 className="h-3.5 w-3.5" />
                      Redo
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Describe your video and generate title, description, and tags.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={aiPrompt}
                    onChange={(event) => setAiPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !isGeneratingAi) {
                        void handleGenerateAiMetadata();
                      }
                    }}
                    placeholder="Optional prompt for AI"
                    className="min-w-[220px] flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void handleGenerateAiMetadata();
                    }}
                    disabled={isGeneratingAi}
                    className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  >
                    {isGeneratingAi
                      ? 'Generating...'
                      : `${hasGeneratedMetadata ? 'Regenerate' : 'Generate'} with AI`}
                  </button>
                </div>
              </div>
            ) : null}
            <div>
              <label htmlFor="edit-title" className="text-sm font-medium text-foreground">
                Title
              </label>
              <input
                id="edit-title"
                value={value.title}
                onChange={(event) => onChange({ ...value, title: event.target.value })}
                className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div>
              <label htmlFor="edit-description" className="text-sm font-medium text-foreground">
                Description
              </label>
              <textarea
                id="edit-description"
                value={value.description}
                onChange={(event) => onChange({ ...value, description: event.target.value })}
                rows={4}
                className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div>
              <label htmlFor="edit-visibility" className="text-sm font-medium text-foreground">
                Privacy
              </label>
              <select
                id="edit-visibility"
                value={value.visibility}
                onChange={(event) =>
                  onChange({
                    ...value,
                    visibility: event.target.value as Draft['visibility'],
                  })
                }
                className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {VISIBILITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="edit-tags" className="text-sm font-medium text-foreground">
                Tags
              </label>
              <div className="mt-1 rounded-md border border-border bg-background px-2 py-2">
                <div className="mb-2 flex flex-wrap gap-2">
                  {value.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() =>
                          onChange({
                            ...value,
                            tags: value.tags.filter((existing) => existing !== tag),
                          })
                        }
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${tag} tag`}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  id="edit-tags"
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ',') {
                      event.preventDefault();
                      commitTagsFromInput();
                    } else if (
                      event.key === 'Backspace' &&
                      tagInput === '' &&
                      value.tags.length > 0
                    ) {
                      event.preventDefault();
                      const lastTag = value.tags[value.tags.length - 1];
                      onChange({ ...value, tags: value.tags.slice(0, -1) });
                      setTagInput(lastTag);
                    }
                  }}
                  onBlur={commitTagsFromInput}
                  placeholder="Type a tag and press Enter or comma"
                  className="block w-full border-0 bg-transparent px-1 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Press Enter or comma to add tags.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-sm font-medium text-foreground">Upload video</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Choose a video file, then upload it for this draft.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label htmlFor="draft-video-file" className="sr-only">
                  Choose video file
                </label>
                <input
                  id="draft-video-file"
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm,.mp4,.mov,.avi,.mkv,.webm"
                  onChange={(event) => setVideoFile(event.target.files?.[0] ?? null)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                >
                  Choose file
                </button>
                <span className="max-w-full truncate text-xs text-muted-foreground">
                  {videoFile ? videoFile.name : 'No file selected'}
                </span>
              </div>
              {uploading ? (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Uploading...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <Progress value={uploadProgress} className="h-2" />
                  <button
                    type="button"
                    onClick={() => {
                      void handleCancelUpload();
                    }}
                    disabled={isCancellingUpload}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60"
                  >
                    {isCancellingUpload ? 'Cancelling...' : 'Cancel upload'}
                  </button>
                </div>
              ) : null}
              {uploadLimitState.reached ? (
                <p className="mt-2 text-xs text-red-600">
                  Upload limit reached
                  {typeof uploadLimitState.monthlyUsage === 'number' &&
                  typeof uploadLimitState.limit === 'number'
                    ? ` (${uploadLimitState.monthlyUsage}/${uploadLimitState.limit} this month). `
                    : '. '}
                  <Link href="/pricing" className="underline underline-offset-2">
                    Upgrade to Supporter
                  </Link>
                  .
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  if (!isLoadingUploadHistory) {
                    setShowUploadHistory((prev) => !prev);
                  }
                }}
                className="inline-flex items-center gap-2 text-sm font-medium text-foreground"
              >
                {isLoadingUploadHistory ? (
                  <ChevronRight className="h-4 w-4 opacity-50" />
                ) : showUploadHistory ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Upload history
                {isLoadingUploadHistory ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <span>({uploadHistory.length})</span>
                )}
              </button>
              {!isLoadingUploadHistory && showUploadHistory && uploadHistory.length > 0 ? (
                <div className="space-y-2">
                  {uploadHistory.map((item) => (
                    <div
                      key={item.uploadJobId}
                      className="rounded-md border border-border bg-background p-3"
                    >
                      <p className="text-xs text-muted-foreground">
                        Upload: {new Date(item.createdAt).toLocaleString()}
                      </p>
                      <p className="mt-1 text-xs text-foreground">Job status: {item.status}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.platforms.map((platform) => (
                          <span
                            key={`${item.uploadJobId}-${platform.platform}`}
                            className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
                          >
                            {platform.platform}: {platform.status} (
                            {new Date(platform.updatedAt).toLocaleString()})
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <DialogFooter className="mt-3 border-t border-border bg-background px-6 pb-6 pt-3">
          <button
            type="button"
            onClick={() => {
              clearPendingVideoSelection();
              onClose();
            }}
            className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
          >
            Cancel
          </button>
          {mode === 'edit' && onDelete && value ? (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="inline-flex items-center justify-center rounded-md border border-border bg-background p-2 text-foreground transition-colors hover:bg-muted"
              aria-label="Delete draft"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void onSave({ closeAfterSave: true });
            }}
            disabled={!canSave}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
          >
            {isSaving ? 'Saving...' : 'Save draft'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (uploadComplete) {
                clearPendingVideoSelection();
                onClose();
                return;
              }
              setShowUploadConfirm(true);
            }}
            disabled={
              uploadComplete
                ? false
                : !canSave || !videoFile || uploading || isSaving || uploadLimitState.reached
            }
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {uploadComplete
              ? 'Close'
              : uploadLimitState.reached
                ? 'Upload limit reached'
                : uploading
                  ? `Uploading ${uploadProgress}%`
                  : 'Upload & Save'}
          </button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this draft and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteDraft();
              }}
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete draft'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showUploadConfirm} onOpenChange={setShowUploadConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Upload and save draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This will save your latest draft changes and upload the selected video using this
              draft. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                setShowUploadConfirm(false);
                void handleUploadVideo();
              }}
              disabled={!canSave || !videoFile || uploading || isSaving}
            >
              Yes, upload
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
