'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Redo2,
  Sparkles,
  Square,
  Trash2,
  Undo2,
} from 'lucide-react';
import { parseSseChunk } from '@/lib/ai/sse-utils';
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
import {
  DRAFT_THUMBNAIL_DISALLOWED_TYPE_MESSAGE,
  DRAFT_THUMBNAIL_MAX_SIZE_LABEL,
  draftThumbnailFileInputAccept,
  draftThumbnailMaxSizeExceededMessage,
  isAllowedDraftThumbnailContentType,
  MAX_DRAFT_THUMBNAIL_BYTES,
} from '@/lib/draft-thumbnail';

const DRAFT_THUMBNAIL_INPUT_ACCEPT = draftThumbnailFileInputAccept();

export interface DraftEditorValues {
  id: string;
  title: string;
  description: string;
  tags: string[];
  visibility: Draft['visibility'];
  targets: ConnectedAccountPlatform[];
  thumbnailR2Key?: string;
  thumbnailContentType?: string;
  thumbnailPreviewUrl?: string;
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
  onSave: (options?: { closeAfterSave?: boolean }) => Promise<{ saved: boolean; draftId?: string }>;
  onUploadComplete?: () => Promise<void> | void;
  onDelete?: (draftId: string) => Promise<boolean>;
  onChange: (next: DraftEditorValues) => void;
  canUseAiMetadata?: boolean;
  /** Disable Dialog focus trap and scroll lock, e.g. when an onboarding tour overlay is active. */
  disableInteractionLock?: boolean;
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

/** Bound in-memory cache for instant history when switching drafts; evicts oldest (LRU). */
const UPLOAD_HISTORY_CACHE_MAX = 8;

function getCachedUploadHistory(
  map: Map<string, DraftUploadHistoryItem[]>,
  id: string
): DraftUploadHistoryItem[] | undefined {
  const v = map.get(id);
  if (v === undefined) return undefined;
  map.delete(id);
  map.set(id, v);
  return v;
}

function setCachedUploadHistory(
  map: Map<string, DraftUploadHistoryItem[]>,
  id: string,
  items: DraftUploadHistoryItem[]
) {
  if (map.has(id)) map.delete(id);
  map.set(id, items);
  while (map.size > UPLOAD_HISTORY_CACHE_MAX) {
    const k = map.keys().next().value as string | undefined;
    if (k === undefined) break;
    map.delete(k);
  }
}

export function DraftMetadataModal({
  mode,
  value,
  initialConnectedPlatforms,
  initialConnectionsResolved,
  isSaving,
  onClose,
  onSave,
  onUploadComplete,
  onDelete,
  onChange,
  canUseAiMetadata = false,
  disableInteractionLock = false,
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
  /** True when server cancel failed after XHR abort; keeps retry/clear UI until resolved. */
  const [cancelServerFailed, setCancelServerFailed] = useState(false);
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
  const [expandedUploadHistoryIds, setExpandedUploadHistoryIds] = useState<Set<string>>(new Set());
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiStreamPreview, setAiStreamPreview] = useState('');
  const [aiUndoStack, setAiUndoStack] = useState<DraftEditorValues[]>([]);
  const [aiRedoStack, setAiRedoStack] = useState<DraftEditorValues[]>([]);
  const [uploadLimitState, setUploadLimitState] = useState<{
    reached: boolean;
    monthlyUsage?: number;
    limit?: number;
  }>({ reached: false });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const thumbnailXhrRef = useRef<XMLHttpRequest | null>(null);
  const thumbnailRequestAbortRef = useRef<AbortController | null>(null);
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [thumbnailUploadProgress, setThumbnailUploadProgress] = useState(0);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const uploadHistoryCacheRef = useRef(new Map<string, DraftUploadHistoryItem[]>());
  const hadActiveJobsRef = useRef(false);
  const aiMetadataAbortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  /** Tracks the open modal’s draft id so we can ignore stale AI responses after close or draft switch. */
  const latestDraftIdRef = useRef<string | null>(null);
  latestDraftIdRef.current = draftId;
  /** Avoid stale closures in async flows (e.g. thumbnail upload). */
  const latestValueRef = useRef<DraftEditorValues | null>(null);
  useEffect(() => {
    latestValueRef.current = value ?? null;
  }, [value]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const abortThumbnailUploadFlow = useCallback(() => {
    thumbnailRequestAbortRef.current?.abort();
    thumbnailRequestAbortRef.current = null;
    if (thumbnailXhrRef.current) {
      thumbnailXhrRef.current.abort();
      thumbnailXhrRef.current = null;
    }
  }, []);

  const snapshotEditor = (editor: DraftEditorValues): DraftEditorValues => ({
    ...editor,
    tags: [...editor.tags],
    targets: [...editor.targets],
    ...(editor.thumbnailR2Key !== undefined ? { thumbnailR2Key: editor.thumbnailR2Key } : {}),
    ...(editor.thumbnailContentType !== undefined
      ? { thumbnailContentType: editor.thumbnailContentType }
      : {}),
    ...(editor.thumbnailPreviewUrl !== undefined
      ? { thumbnailPreviewUrl: editor.thumbnailPreviewUrl }
      : {}),
  });

  const loadUploadHistory = async (id: string, signal?: AbortSignal) => {
    const skipIfAborted = () => Boolean(signal?.aborted);
    // Background refresh when we already have cached rows for this draft — avoids
    // flashing the loading UI on draft switches (draftId effect hydrates from cache first).
    const hadCached = uploadHistoryCacheRef.current.has(id);
    let showedLoading = false;
    if (!hadCached) {
      setIsLoadingUploadHistory(true);
      showedLoading = true;
    }
    try {
      const response = await fetch(`/api/drafts/${id}/upload-history`, {
        cache: 'no-store',
        signal,
      });
      if (skipIfAborted()) return;

      if (!response.ok) {
        if (skipIfAborted()) return;
        setUploadHistory([]);
        setCachedUploadHistory(uploadHistoryCacheRef.current, id, []);
        return;
      }
      const payload = (await response.json()) as ApiResponse<DraftUploadHistoryItem[]>;
      if (skipIfAborted()) return;
      const history = Array.isArray(payload.data) ? payload.data : [];
      setUploadHistory(history);
      setCachedUploadHistory(uploadHistoryCacheRef.current, id, history);
    } catch (error) {
      if (skipIfAborted()) return;
      const isAbortError =
        (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError';
      if (isAbortError) return;
      if (skipIfAborted()) return;
      setUploadHistory([]);
      setCachedUploadHistory(uploadHistoryCacheRef.current, id, []);
    } finally {
      if (!signal?.aborted && showedLoading) {
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
  const activeUploadJobSetKey = useMemo(
    () => [...activeUploadJobIds].sort().join('|'),
    [activeUploadJobIds]
  );
  const latestActiveUploadJobIdsRef = useRef<string[]>([]);
  latestActiveUploadJobIdsRef.current = activeUploadJobIds;
  const latestActiveJobSetKeyRef = useRef('');
  latestActiveJobSetKeyRef.current = activeUploadJobSetKey;

  useEffect(() => {
    if (!draftId) {
      uploadHistoryCacheRef.current.clear();
      setUsedPlatforms([]);
      setUploadHistory([]);
      setShowUploadHistory(false);
      setExpandedUploadHistoryIds(new Set());
      setIsLoadingUploadHistory(false);
      return;
    }
    // Prevent stale history from the previously opened draft from flashing
    // while the current draft's history request is in flight.
    const cached = getCachedUploadHistory(uploadHistoryCacheRef.current, draftId);
    setUploadHistory(cached ?? []);
    setIsLoadingUploadHistory(cached === undefined);
  }, [draftId]);

  useEffect(() => {
    return () => {
      aiMetadataAbortRef.current?.abort();
    };
  }, [draftId]);

  useEffect(() => {
    return () => {
      if (xhrRef.current) {
        xhrRef.current.abort();
        xhrRef.current = null;
      }
      abortThumbnailUploadFlow();
    };
  }, [abortThumbnailUploadFlow]);

  useEffect(() => {
    return () => {
      abortThumbnailUploadFlow();
    };
  }, [abortThumbnailUploadFlow, draftId]);

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
    if (!activeUploadJobSetKey) {
      // If we just transitioned from active -> idle, do one final full refresh
      // to avoid stale "uploading" states from the last targeted poll tick.
      if (hadActiveJobsRef.current && draftId) {
        hadActiveJobsRef.current = false;
        void loadUploadHistory(draftId);
      }
      return;
    }
    hadActiveJobsRef.current = true;
    const pollDraftId = draftId;
    const pollJobSetKey = activeUploadJobSetKey;
    const controller = new AbortController();
    let disposed = false;

    const pollActiveJobs = async () => {
      if (disposed) return;
      const idsToPoll = latestActiveUploadJobIdsRef.current;
      if (idsToPoll.length === 0) return;
      const responses = await Promise.all(
        idsToPoll.map(async (uploadJobId) => {
          try {
            const response = await fetch(`/api/uploads/jobs/${uploadJobId}`, {
              cache: 'no-store',
              signal: controller.signal,
            });
            if (!response.ok) return null;
            const payload = (await response.json()) as ApiResponse<DraftUploadHistoryItem>;
            return payload.data;
          } catch {
            if (controller.signal.aborted) return null;
            return null;
          }
        })
      );

      if (disposed || controller.signal.aborted) return;
      if (!pollDraftId || latestDraftIdRef.current !== pollDraftId) return;
      if (latestActiveJobSetKeyRef.current !== pollJobSetKey) return;

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
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [activeUploadJobSetKey, draftId]);

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
      abortThumbnailUploadFlow();
      setThumbnailUploading(false);
      setThumbnailUploadProgress(0);
      if (thumbnailInputRef.current) {
        thumbnailInputRef.current.value = '';
      }
      setPlatformWarning(null);
      setTagInput('');
      setUploadComplete(false);
      return;
    }
    if (value.targets.length > 0) {
      setPlatformWarning(null);
    }
  }, [abortThumbnailUploadFlow, value]);

  useEffect(() => {
    if (!draftId) {
      setAiPrompt('');
      setIsGeneratingAi(false);
      setAiStreamPreview('');
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

  const commitTagsBeforeSave = () => {
    // Ensure tag commit is flushed before any save call reads value.tags.
    flushSync(() => {
      commitTagsFromInput();
    });
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
    !cancelServerFailed &&
    !isCancellingUpload &&
    !thumbnailUploading &&
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
      const response = await fetch('/api/ai/generate-metadata/stream', {
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
      if (!response.body) {
        throw new Error('Response body is empty');
      }

      // Read the SSE stream, accumulate token deltas, apply on [DONE]
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        if (ac.signal.aborted) {
          await reader.cancel();
          return;
        }

        const text = decoder.decode(chunk, { stream: true });
        for (const result of parseSseChunk(text)) {
          if (result.error) {
            throw new Error(result.error);
          }
          if (result.done) {
            // Stream complete — parse the assembled JSON
            if (ac.signal.aborted) return;
            if (latestDraftIdRef.current !== requestDraftId) return;

            let parsed: { title?: unknown; description?: unknown; tags?: unknown };
            try {
              parsed = JSON.parse(accumulated) as typeof parsed;
            } catch {
              throw new Error('AI returned invalid JSON. Please try again.');
            }

            applyAiMetadata({
              title: typeof parsed.title === 'string' ? parsed.title : '',
              description: typeof parsed.description === 'string' ? parsed.description : '',
              tags:
                Array.isArray(parsed.tags) && parsed.tags.every((t) => typeof t === 'string')
                  ? (parsed.tags as string[])
                  : [],
            });
            toast.success('Metadata generated successfully');
            return;
          }
          if (result.deltaContent !== undefined) {
            accumulated += result.deltaContent;
            setAiStreamPreview((prev) => prev + result.deltaContent);
          }
        }
      }
      // Stream closed without sending [DONE] — treat as an error
      throw new Error('Stream ended without a completion signal. Please try again.');
    } catch (error) {
      const isAbort =
        (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError';
      if (isAbort) return;
      console.warn('AI metadata generation failed:', error);
      toast.error('Failed to generate metadata. Please try again.');
    } finally {
      if (aiMetadataAbortRef.current === ac) {
        aiMetadataAbortRef.current = null;
        setIsGeneratingAi(false);
        setAiStreamPreview('');
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
    const hasPendingTagInput = tagInput.trim() !== '';
    const isCreateDraftEmptyForConnect =
      mode === 'create' &&
      value !== null &&
      value.title.trim() === '' &&
      value.description.trim() === '' &&
      value.tags.length === 0 &&
      !hasPendingTagInput &&
      aiPrompt.trim() === '' &&
      videoFile === null &&
      !uploading &&
      currentUploadJobId === null &&
      !cancelServerFailed &&
      !(value.thumbnailR2Key || value.thumbnailPreviewUrl);
    commitTagsBeforeSave();
    if (isCreateDraftEmptyForConnect) {
      onClose();
      router.push('/profile/connections');
      return;
    }
    const result = await onSave({ closeAfterSave: false });
    if (result.saved) {
      router.push('/profile/connections');
    }
  };

  const handleConnectAction = async () => {
    const hasPendingTagInput = tagInput.trim() !== '';
    const isCreateDraftEmptyForConnect =
      mode === 'create' &&
      value !== null &&
      value.title.trim() === '' &&
      value.description.trim() === '' &&
      value.tags.length === 0 &&
      !hasPendingTagInput &&
      aiPrompt.trim() === '' &&
      videoFile === null &&
      !uploading &&
      currentUploadJobId === null &&
      !cancelServerFailed &&
      !(value.thumbnailR2Key || value.thumbnailPreviewUrl);
    commitTagsBeforeSave();
    if (isCreateDraftEmptyForConnect) {
      onClose();
      router.push('/profile/connections');
      return;
    }
    const result = await onSave({ closeAfterSave: false });
    if (result.saved) {
      router.push('/profile/connections');
    }
  };

  const handleUploadVideo = async () => {
    if (!value || !videoFile) return;

    commitTagsBeforeSave();
    const saveResult = await onSave({ closeAfterSave: false });
    if (!saveResult.saved) return;
    const draftIdForUpload = saveResult.draftId ?? value.id;
    if (!draftIdForUpload) {
      toast.error('Please save the draft before uploading.');
      return;
    }

    let activeUploadJobId: string | null = null;
    let uploadAbortedByUser = false;

    try {
      setCancelServerFailed(false);
      setUploading(true);
      setUploadProgress(0);

      const presignRes = await fetch('/api/uploads/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: videoFile.name,
          contentType: videoFile.type,
          fileSize: videoFile.size,
          draftId: draftIdForUpload,
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
      await loadUploadHistory(draftIdForUpload);
      await onUploadComplete?.();
      setShowUploadHistory(true);
      setUploadLimitState({ reached: false });
      toast.success('Video uploaded successfully');
    } catch (error) {
      setUploadProgress(0);
      if (error instanceof Error && error.message === 'UPLOAD_ABORTED') {
        uploadAbortedByUser = true;
        // Keep currentUploadJobId and uploading=true until handleCancelUpload completes
        // server-side cancel (or cancelServerFailed); do not clear in finally.
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
      if (!uploadAbortedByUser) {
        setUploading(false);
      }
    }
  };

  const handleCancelUpload = async () => {
    if (!currentUploadJobId) return;
    if (!uploading && !cancelServerFailed) return; // retry path only when stuck or in-flight

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
        setUploading(false);
        setCancelServerFailed(true);
        return;
      }

      setCancelServerFailed(false);
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
      setUploading(false);
      setCancelServerFailed(true);
    } finally {
      setIsCancellingUpload(false);
    }
  };

  const handleThumbnailFile = async (file: File) => {
    if (!value || !draftId) return;
    const requestDraftId = draftId;
    const ac = new AbortController();
    // Starting a new thumbnail upload must cancel both prior fetches and any in-flight PUT XHR.
    abortThumbnailUploadFlow();
    thumbnailRequestAbortRef.current = ac;
    const isStale = () =>
      ac.signal.aborted ||
      !isMountedRef.current ||
      latestDraftIdRef.current !== requestDraftId ||
      thumbnailRequestAbortRef.current !== ac;

    if (file.size > MAX_DRAFT_THUMBNAIL_BYTES) {
      toast.error(draftThumbnailMaxSizeExceededMessage());
      thumbnailRequestAbortRef.current = null;
      if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
      return;
    }
    if (!isAllowedDraftThumbnailContentType(file.type)) {
      toast.error(DRAFT_THUMBNAIL_DISALLOWED_TYPE_MESSAGE);
      thumbnailRequestAbortRef.current = null;
      if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
      return;
    }
    setThumbnailUploading(true);
    setThumbnailUploadProgress(0);
    try {
      const presignRes = await fetch(`/api/drafts/${draftId}/thumbnail/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type, fileSize: file.size }),
        signal: ac.signal,
      });
      if (isStale()) return;
      if (!presignRes.ok) {
        const err = (await presignRes.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? 'Failed to start thumbnail upload');
      }
      const { uploadUrl, pendingKey } = (await presignRes.json()) as {
        uploadUrl: string;
        pendingKey: string;
      };

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        thumbnailXhrRef.current = xhr;
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.upload.addEventListener('progress', (event) => {
          if (!isStale() && event.lengthComputable && event.total > 0) {
            setThumbnailUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        });
        xhr.addEventListener('load', () => {
          thumbnailXhrRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) {
            if (!isStale()) setThumbnailUploadProgress(100);
            resolve();
          } else {
            reject(new Error(`Failed to upload thumbnail to storage (${xhr.status})`));
          }
        });
        xhr.addEventListener('error', () => {
          thumbnailXhrRef.current = null;
          reject(new Error('Failed to upload thumbnail to storage'));
        });
        xhr.addEventListener('abort', () => {
          thumbnailXhrRef.current = null;
          reject(new Error('THUMBNAIL_UPLOAD_ABORTED'));
        });
        xhr.send(file);
      });

      const completeRes = await fetch(`/api/drafts/${draftId}/thumbnail/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingKey }),
        signal: ac.signal,
      });
      if (isStale()) return;
      if (!completeRes.ok) {
        const err = (await completeRes.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? 'Failed to finalize thumbnail');
      }
      const payload = (await completeRes.json()) as ApiResponse<
        Draft & { thumbnailPreviewUrl?: string }
      >;
      const d = payload.data;
      if (!d) {
        throw new Error('Invalid response');
      }
      if (isStale()) return;
      const latest = latestValueRef.current ?? value;
      if (!latest) return;
      onChange({
        ...latest,
        thumbnailR2Key: d.thumbnailR2Key,
        thumbnailContentType: d.thumbnailContentType,
        thumbnailPreviewUrl: d.thumbnailPreviewUrl,
      });
      if (isStale()) return;
      toast.success('Thumbnail uploaded');
    } catch (e) {
      const isAbort =
        ac.signal.aborted ||
        ((e instanceof DOMException || e instanceof Error) && e.name === 'AbortError');
      if (isAbort || isStale()) {
        return;
      }
      if (e instanceof Error && e.message === 'THUMBNAIL_UPLOAD_ABORTED') {
        return;
      }
      toast.error(e instanceof Error ? e.message : 'Thumbnail upload failed');
    } finally {
      // Capture whether a newer upload has taken over before modifying refs.
      const supersededByNewUpload =
        thumbnailRequestAbortRef.current !== ac && thumbnailRequestAbortRef.current !== null;
      if (thumbnailRequestAbortRef.current === ac) {
        thumbnailRequestAbortRef.current = null;
      }
      thumbnailXhrRef.current = null;
      // Reset UI unless a newer upload is already in progress (which owns the uploading state).
      // Intentionally does NOT check ac.signal.aborted: an externally-aborted request that is
      // still the latest for this mounted draft (e.g. onOpenChange abort that was blocked by
      // tryCloseModal) must still clear the uploading indicator to avoid a stuck "Uploading…" state.
      if (
        !supersededByNewUpload &&
        isMountedRef.current &&
        latestDraftIdRef.current === requestDraftId
      ) {
        setThumbnailUploading(false);
        setThumbnailUploadProgress(0);
        if (thumbnailInputRef.current) {
          thumbnailInputRef.current.value = '';
        }
      }
    }
  };

  const handleRemoveThumbnail = async () => {
    if (!value || !draftId) return;
    setThumbnailUploading(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}/thumbnail`, { method: 'DELETE' });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? 'Failed to remove thumbnail');
      }
      const latest = latestValueRef.current ?? value;
      if (!latest) return;
      onChange({
        ...latest,
        thumbnailR2Key: undefined,
        thumbnailContentType: undefined,
        thumbnailPreviewUrl: undefined,
      });
      toast.success('Thumbnail removed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove thumbnail');
    } finally {
      setThumbnailUploading(false);
    }
  };

  const clearPendingVideoSelection = async (options?: { skipServerCancel?: boolean }) => {
    const jobId = currentUploadJobId;

    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }

    if (jobId && !options?.skipServerCancel) {
      try {
        const cancelRes = await fetch(`/api/uploads/${jobId}/cancel`, { method: 'POST' });
        if (!cancelRes.ok) {
          const errBody = (await cancelRes.json().catch(() => null)) as {
            message?: string;
            error?: string;
          } | null;
          const details = errBody?.message ?? errBody?.error ?? `(${cancelRes.status})`;
          toast.error(`Failed to cancel upload. ${details}`);
          setUploading(false);
          setCancelServerFailed(true);
          return false;
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? `Failed to cancel upload. ${error.message}`
            : 'Failed to cancel upload'
        );
        setUploading(false);
        setCancelServerFailed(true);
        return false;
      }
    }

    setVideoFile(null);
    setUploadProgress(0);
    setUploadComplete(false);
    setCurrentUploadJobId(null);
    setUploading(false);
    setCancelServerFailed(false);
    setIsCancellingUpload(false);
    setUploadLimitState({ reached: false });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    return true;
  };

  const confirmLocalClear = () =>
    window.confirm(
      'Server cancellation is unavailable right now. Clear this pending upload locally and close anyway?'
    );

  const tryCloseModal = async () => {
    const cleared = await clearPendingVideoSelection();
    if (cleared) {
      onClose();
      return;
    }
    if (currentUploadJobId && cancelServerFailed && confirmLocalClear()) {
      await clearPendingVideoSelection({ skipServerCancel: true });
      onClose();
    }
  };

  const handleDeleteDraft = async () => {
    if (!value || !onDelete) return;
    setIsDeleting(true);
    try {
      const deleted = await onDelete(value.id);
      if (deleted) {
        setShowDeleteConfirm(false);
        await clearPendingVideoSelection({ skipServerCancel: true });
        onClose();
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleUploadHistoryItem = (uploadJobId: string) => {
    setExpandedUploadHistoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(uploadJobId)) {
        next.delete(uploadJobId);
      } else {
        next.add(uploadJobId);
      }
      return next;
    });
  };

  return (
    <Dialog
      open={value !== null}
      modal={!disableInteractionLock}
      onOpenChange={(open) => {
        if (!open) {
          abortThumbnailUploadFlow();
          void tryCloseModal();
        }
      }}
    >
      <DialogContent
        showOverlay={!disableInteractionLock}
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
            <div data-tour="draft-platforms">
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
            </div>
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
                  {isGeneratingAi ? (
                    <button
                      type="button"
                      onClick={() => {
                        aiMetadataAbortRef.current?.abort();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                      Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        void handleGenerateAiMetadata();
                      }}
                      disabled={isGeneratingAi}
                      className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                    >
                      {`${hasGeneratedMetadata ? 'Regenerate' : 'Generate'} with AI`}
                    </button>
                  )}
                </div>
                {isGeneratingAi ? (
                  <div className="mt-2">
                    {aiStreamPreview ? (
                      <div className="max-h-24 overflow-y-auto rounded border border-border bg-muted/40 px-2.5 py-2 font-mono text-xs text-muted-foreground">
                        <span className="whitespace-pre-wrap break-all">{aiStreamPreview}</span>
                        <span className="animate-pulse">▍</span>
                      </div>
                    ) : (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Connecting to AI…
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div>
              <label htmlFor="edit-title" className="text-sm font-medium text-foreground">
                Title
              </label>
              <input
                id="edit-title"
                data-tour="draft-title-input"
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
              <p className="text-sm font-medium text-foreground">Thumbnail</p>
              <p className="mt-1 text-xs text-muted-foreground">
                JPG or PNG, max {DRAFT_THUMBNAIL_MAX_SIZE_LABEL}. Shown on platforms that support
                custom thumbnails when you distribute.
              </p>
              {!draftId ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Create draft first to add a thumbnail.
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {value.thumbnailPreviewUrl ? (
                    <div className="relative inline-block max-w-full">
                      <Image
                        src={value.thumbnailPreviewUrl}
                        alt="Draft thumbnail preview"
                        width={800}
                        height={450}
                        unoptimized
                        className="max-h-40 max-w-full rounded-md border border-border object-contain"
                      />
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={thumbnailInputRef}
                      type="file"
                      accept={DRAFT_THUMBNAIL_INPUT_ACCEPT}
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void handleThumbnailFile(file);
                        }
                      }}
                    />
                    <button
                      type="button"
                      disabled={thumbnailUploading}
                      onClick={() => thumbnailInputRef.current?.click()}
                      className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                    >
                      {thumbnailUploading
                        ? 'Uploading…'
                        : value.thumbnailPreviewUrl
                          ? 'Replace'
                          : 'Upload'}
                    </button>
                    {value.thumbnailR2Key || value.thumbnailPreviewUrl ? (
                      <button
                        type="button"
                        disabled={thumbnailUploading}
                        onClick={() => {
                          void handleRemoveThumbnail();
                        }}
                        className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-60"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  {thumbnailUploading ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Uploading thumbnail…</span>
                        <span>{thumbnailUploadProgress}%</span>
                      </div>
                      <Progress value={thumbnailUploadProgress} className="h-2" />
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            <div
              data-tour="draft-upload-section"
              className="rounded-lg border border-border bg-muted/30 p-3"
            >
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
              {uploading || cancelServerFailed ? (
                <div className="mt-2 space-y-2">
                  {cancelServerFailed && !uploading ? (
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      Could not cancel on the server. Retry or clear this pending upload.
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Uploading...</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <Progress value={uploadProgress} className="h-2" />
                    </>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void handleCancelUpload();
                      }}
                      disabled={isCancellingUpload}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60"
                    >
                      {isCancellingUpload
                        ? 'Cancelling...'
                        : cancelServerFailed && !uploading
                          ? 'Retry cancel'
                          : 'Cancel upload'}
                    </button>
                    {cancelServerFailed && !uploading ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (!confirmLocalClear()) return;
                          void clearPendingVideoSelection({ skipServerCancel: true });
                        }}
                        disabled={isCancellingUpload}
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60"
                      >
                        Clear pending upload
                      </button>
                    ) : null}
                  </div>
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
              <div className="flex items-center justify-between gap-2">
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
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    router.push('/dashboard/history');
                  }}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Open full history
                </button>
              </div>
              {!isLoadingUploadHistory && showUploadHistory && uploadHistory.length > 0 ? (
                <div className="space-y-2">
                  {uploadHistory.map((item) => {
                    const uploadHistoryExpanded = expandedUploadHistoryIds.has(item.uploadJobId);
                    const uploadHistoryPanelId = `draft-upload-history-panel-${item.uploadJobId}`;
                    const uploadHistoryAriaExpanded: 'true' | 'false' = uploadHistoryExpanded
                      ? 'true'
                      : 'false';
                    return (
                      <div
                        key={item.uploadJobId}
                        className="rounded-md border border-border bg-background p-3"
                      >
                        <button
                          type="button"
                          onClick={() => toggleUploadHistoryItem(item.uploadJobId)}
                          className="flex w-full items-center justify-between gap-2 text-left"
                          aria-expanded={uploadHistoryAriaExpanded}
                          aria-controls={uploadHistoryPanelId}
                        >
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Upload: {new Date(item.createdAt).toLocaleString()}
                            </p>
                            <p className="mt-1 text-xs text-foreground">
                              Job status: {item.status}
                            </p>
                          </div>
                          {uploadHistoryExpanded ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                        </button>
                        <div
                          id={uploadHistoryPanelId}
                          hidden={!uploadHistoryExpanded}
                          className="mt-2 flex flex-wrap gap-2"
                        >
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
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <DialogFooter className="mt-3 border-t border-border bg-background px-6 pb-6 pt-3">
          <button
            type="button"
            onClick={() => {
              void tryCloseModal();
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
            data-tour="draft-save-button"
            onClick={() => {
              commitTagsBeforeSave();
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
                void tryCloseModal();
                return;
              }
              setShowUploadConfirm(true);
            }}
            disabled={
              uploadComplete
                ? false
                : !canSave ||
                  !videoFile ||
                  uploading ||
                  cancelServerFailed ||
                  isSaving ||
                  uploadLimitState.reached
            }
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {uploadComplete
              ? 'Close'
              : uploadLimitState.reached
                ? 'Upload limit reached'
                : uploading
                  ? `Uploading ${uploadProgress}%`
                  : cancelServerFailed
                    ? 'Pending upload'
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
              disabled={!canSave || !videoFile || uploading || cancelServerFailed || isSaving}
            >
              Yes, upload
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
