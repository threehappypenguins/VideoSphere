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
  CircleCheck,
  Loader2,
  Redo2,
  Sparkles,
  Square,
  Trash2,
  Undo2,
} from 'lucide-react';
import { createSseParser } from '@/lib/ai/sse-utils';
import { validateDraftForUpload, type DraftUploadFieldKey } from '@/lib/draft-upload-validation';
import { mergeSermonAudioDefaultFields } from '@/lib/platforms/sermon-audio-event-types';
import { SERMON_AUDIO_MAX_BIBLE_REFERENCES } from '@/lib/platforms/sermon-audio-bible-books';
import { parseBibleReferences } from '@/lib/platforms/sermon-audio-bible-references';
import {
  mergeUniqueTags,
  parseSermonAudioHashtagInput,
  parseSharedTagInput,
} from '@/lib/platforms/sermon-audio-tags';
import { cn } from '@/lib/utils';
import { SermonAudioSpeakerCombobox } from '@/components/drafts/SermonAudioSpeakerCombobox';
import { SermonAudioSeriesCombobox } from '@/components/drafts/SermonAudioSeriesCombobox';
import { SermonAudioBibleReferencesField } from '@/components/drafts/SermonAudioBibleReferencesField';
import { YouTubePlaylistCombobox } from '@/components/drafts/YouTubePlaylistCombobox';
import { YouTubeSearchableSelect } from '@/components/drafts/YouTubeSearchableSelect';
import { YouTubeTimezoneSelect } from '@/components/drafts/YouTubeTimezoneSelect';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { DraftModalCard } from '@/components/drafts/DraftModalCard';
import { DraftPlatformToggles } from '@/components/drafts/DraftPlatformToggles';
import type {
  ApiResponse,
  ConnectedAccountPlatform,
  ConnectedAccountPublic,
  Draft,
  DraftPlatforms,
  PerPlatformOverrides,
  PlatformUploadStatus,
  SermonAudioDraftFields,
  UploadJobStatus,
  VimeoDraftFields,
  YouTubeDraftFields,
} from '@/types';
import {
  DRAFT_THUMBNAIL_DISALLOWED_TYPE_MESSAGE,
  DRAFT_THUMBNAIL_MAX_SIZE_LABEL,
  draftThumbnailFileInputAccept,
  draftThumbnailMaxSizeExceededMessage,
  isAllowedDraftThumbnailContentType,
  MAX_DRAFT_THUMBNAIL_BYTES,
} from '@/lib/draft-thumbnail';
import {
  PlatformIcon,
  PlatformOverrideLabel,
  PlatformSectionHeader,
  isPlatformBrandIcon,
} from '@/components/icons/PlatformIcon';
import { platformLabel } from '@/lib/ui/platform-label';
import {
  buildYouTubeAccountDefaultsSeedPatch,
  type YouTubeAccountDefaults,
} from '@/lib/platforms/youtube-account-defaults';
import {
  getDefaultScheduleDate,
  getDefaultScheduleTime,
  getLocalTimeZone,
  getSupportedTimeZones,
  isPublishAtInPast,
  utcIsoToZonedScheduleParts,
  YOUTUBE_SCHEDULE_TIME_OPTIONS,
  zonedDateTimeToUtcIso,
} from '@/lib/youtube-schedule';

const DRAFT_THUMBNAIL_INPUT_ACCEPT = draftThumbnailFileInputAccept();

/**
 * Defines the shape of draft editor values.
 */
export interface DraftEditorValues {
  id: string;
  title: string;
  description: string;
  tags: string[];
  visibility: Draft['visibility'];
  targets: ConnectedAccountPlatform[];
  platforms: DraftPlatforms;
  thumbnailR2Key?: string;
  thumbnailContentType?: string;
  thumbnailPreviewUrl?: string;
}

const VISIBILITY_OPTIONS: Array<{ value: Draft['visibility']; label: string }> = [
  { value: 'public', label: 'Public' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'private', label: 'Private' },
];

const YOUTUBE_LICENSE_OPTIONS = [
  { value: 'youtube', label: 'Standard YouTube License' },
  { value: 'creativeCommon', label: 'Creative Commons — Attribution' },
] as const;

const PREFERRED_PLATFORM_ORDER: ConnectedAccountPlatform[] = [
  'youtube',
  'vimeo',
  'google_drive',
  'sftp',
  'smb',
];

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

const OVERRIDE_PLATFORMS = ['youtube', 'vimeo', 'sermon_audio'] as const;

type OverridePlatform = (typeof OVERRIDE_PLATFORMS)[number];

const OVERRIDE_PLATFORM_ORDER: OverridePlatform[] = ['youtube', 'vimeo', 'sermon_audio'];

const PRIVACY_PLATFORMS = ['youtube', 'vimeo'] as const;

type PrivacyPlatform = (typeof PRIVACY_PLATFORMS)[number];

const PRIVACY_PLATFORM_ORDER: PrivacyPlatform[] = ['youtube', 'vimeo'];

/** Platforms that receive draft `thumbnailR2Key` on distribute (YouTube/Vimeo today). */
const DRAFT_THUMBNAIL_PLATFORMS = ['youtube', 'vimeo'] as const;

type DraftThumbnailPlatform = (typeof DRAFT_THUMBNAIL_PLATFORMS)[number];

/**
 * Whether the draft editor should show the thumbnail upload section for the current target list.
 * @param targets - Selected distribute targets on the draft.
 * @returns False when SermonAudio is the only selected target (no supported thumbnail consumer).
 */
function showDraftThumbnailUploadSection(targets: ConnectedAccountPlatform[]): boolean {
  if (targets.length === 0) return true;
  if (targets.length === 1 && targets[0] === 'sermon_audio') return false;
  return targets.some((platform): platform is DraftThumbnailPlatform =>
    (DRAFT_THUMBNAIL_PLATFORMS as readonly string[]).includes(platform)
  );
}

/** SermonAudio short title (`displayTitle`) is offered when the effective title exceeds this length. */
const SERMON_AUDIO_SHORT_TITLE_THRESHOLD = 30;

function isOverridePlatform(platform: ConnectedAccountPlatform): platform is OverridePlatform {
  return (OVERRIDE_PLATFORMS as readonly string[]).includes(platform);
}

function isPrivacyPlatform(platform: ConnectedAccountPlatform): platform is PrivacyPlatform {
  return (PRIVACY_PLATFORMS as readonly string[]).includes(platform);
}

function sortPrivacyPlatforms(platforms: PrivacyPlatform[]): PrivacyPlatform[] {
  return [...platforms].sort(
    (a, b) => PRIVACY_PLATFORM_ORDER.indexOf(a) - PRIVACY_PLATFORM_ORDER.indexOf(b)
  );
}

function platformUsesSharedTitle(fields: PerPlatformOverrides | undefined): boolean {
  return fields?.titleOverride === undefined;
}

function platformUsesSharedDescription(fields: PerPlatformOverrides | undefined): boolean {
  return fields?.descriptionOverride === undefined;
}

function platformUsesSharedTags(fields: PerPlatformOverrides | undefined): boolean {
  return fields?.tagsOverride === undefined;
}

function platformUsesSharedVisibility(fields: PerPlatformOverrides | undefined): boolean {
  return fields?.visibilityOverride === undefined;
}

function sortOverridePlatforms(platforms: OverridePlatform[]): OverridePlatform[] {
  return [...platforms].sort(
    (a, b) => OVERRIDE_PLATFORM_ORDER.indexOf(a) - OVERRIDE_PLATFORM_ORDER.indexOf(b)
  );
}

function sermonAudioEffectiveTitle(value: DraftEditorValues, usePerPlatformTitle: boolean): string {
  if (usePerPlatformTitle) {
    return value.platforms.sermon_audio?.titleOverride ?? value.title;
  }
  return value.title;
}

function needsSermonAudioShortTitle(title: string): boolean {
  return title.length > SERMON_AUDIO_SHORT_TITLE_THRESHOLD;
}

type SharedCopyField = 'title' | 'description' | 'tags';

function SharedMetadataCheckbox({
  checked,
  onChange,
  hint,
}: {
  checked: boolean;
  onChange: (useShared: boolean) => void;
  hint: string;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={hint}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      Use shared metadata
    </label>
  );
}

function SermonAudioShortTitleField({
  value,
  onChange,
  className,
  fieldBorderClassName,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  fieldBorderClassName: string;
}) {
  return (
    <div className={className}>
      <label
        htmlFor="draft-sermon-audio-display-title"
        className="inline-flex items-center gap-2 text-sm font-medium text-foreground"
      >
        <PlatformIcon platform="sermon_audio" size={28} />
        <span>
          Short Title <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
      </label>
      <input
        id="draft-sermon-audio-display-title"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={fieldBorderClassName}
      />
      <p className="mt-1 text-xs text-muted-foreground">
        Use when the main title is longer than {SERMON_AUDIO_SHORT_TITLE_THRESHOLD} characters.
      </p>
    </div>
  );
}

interface DraftMetadataModalProps {
  mode: 'create' | 'edit';
  value: DraftEditorValues | null;
  initialConnectedPlatforms?: ConnectedAccountPlatform[];
  initialConnectionsResolved?: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSave: (options?: {
    closeAfterSave?: boolean;
  }) => Promise<{ saved: boolean; draftId?: string; message?: string }>;
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

/** Extract best-effort partial field values from a partially-assembled JSON string. */
function extractPartialAiFields(raw: string): {
  title: string;
  description: string;
  tags: string[];
} {
  const unescape = (s: string) =>
    s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
  const titleM = raw.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)/u);
  const title = titleM ? unescape(titleM[1]) : '';
  const descM = raw.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)/u);
  const description = descM ? unescape(descM[1]) : '';
  const tagsArrayM = raw.match(/"tags"\s*:\s*\[([^\]]*)/u);
  const tags: string[] = [];
  if (tagsArrayM) {
    for (const m of tagsArrayM[1].matchAll(/"((?:[^"\\]|\\.)*)"/gu)) {
      tags.push(unescape(m[1]));
    }
  }
  return { title, description, tags };
}

/**
 * Renders the draft metadata modal component.
 * @param props - Component props.
 * @returns The rendered UI output.
 */
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
  const [platformOverrideTagInput, setPlatformOverrideTagInput] = useState<
    Partial<Record<OverridePlatform, string>>
  >({});
  const [ageRestrictionsExpanded, setAgeRestrictionsExpanded] = useState(false);
  const [showMoreExpanded, setShowMoreExpanded] = useState(false);
  const [scheduleExpanded, setScheduleExpanded] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduleTimeZone, setScheduleTimeZone] = useState('');
  const scheduleInitializedRef = useRef(false);
  const supportedTimeZones = useMemo(() => getSupportedTimeZones(), []);
  const [youtubeLanguages, setYoutubeLanguages] = useState<Array<{ id: string; name: string }>>([]);
  const [youtubeCategories, setYoutubeCategories] = useState<Array<{ id: string; title: string }>>(
    []
  );
  const [youtubeAccountDefaults, setYoutubeAccountDefaults] = useState<
    YouTubeAccountDefaults | undefined
  >();
  const youtubeDefaultsSeededRef = useRef<string | null>(null);
  const [uploadFieldErrors, setUploadFieldErrors] = useState<Set<DraftUploadFieldKey>>(new Set());
  const [sermonEventTypes, setSermonEventTypes] = useState<string[] | null>(null);
  const [sermonEventTypesLoadFailed, setSermonEventTypesLoadFailed] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiUndoStack, setAiUndoStack] = useState<DraftEditorValues[]>([]);
  const [aiRedoStack, setAiRedoStack] = useState<DraftEditorValues[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const thumbnailSectionRef = useRef<HTMLDivElement>(null);
  const thumbnailAnnouncerRef = useRef<HTMLDivElement>(null);
  const thumbnailAnnounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalAnnouncerRef = useRef<HTMLDivElement>(null);
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announceRafRef = useRef<number | null>(null);
  const latestAnnouncementIdRef = useRef(0);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [modalStatusMsg, setModalStatusMsg] = useState<string | null>(null);
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
      if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
      if (announceRafRef.current !== null) cancelAnimationFrame(announceRafRef.current);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      if (thumbnailAnnounceTimerRef.current) clearTimeout(thumbnailAnnounceTimerRef.current);
    };
  }, []);

  // Announces a message to screen readers within the modal's focus context,
  // avoiding the re-read triggered by focus returning to the dialog after a
  // Sonner toast. Clears first so repeated identical strings re-announce.
  // Also shows a brief visual status banner inside the modal for sighted users.
  const announceInModal = useCallback((message: string) => {
    if (!isMountedRef.current) return;
    const announcementId = ++latestAnnouncementIdRef.current;

    // Visual status for sighted users (auto-dismiss after 4 s)
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setModalStatusMsg(message);
    statusTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      setModalStatusMsg(null);
    }, 4000);

    // Screen reader announcement
    if (!modalAnnouncerRef.current) return;
    if (announceTimerRef.current) {
      clearTimeout(announceTimerRef.current);
      announceTimerRef.current = null;
    }
    if (announceRafRef.current !== null) {
      cancelAnimationFrame(announceRafRef.current);
      announceRafRef.current = null;
    }
    // Remove existing children silently — aria-relevant="additions" means removals don't announce.
    while (modalAnnouncerRef.current.firstChild) {
      modalAnnouncerRef.current.removeChild(modalAnnouncerRef.current.firstChild);
    }
    announceRafRef.current = requestAnimationFrame(() => {
      announceRafRef.current = null;
      if (!isMountedRef.current) return;
      if (announcementId !== latestAnnouncementIdRef.current) return;
      if (modalAnnouncerRef.current) {
        // Appending a new text node IS an addition → announces exactly once.
        modalAnnouncerRef.current.appendChild(document.createTextNode(message));
        // Remove after 1.5 s so stale text isn't re-read during virtual navigation.
        // Removal is silent because aria-relevant="additions" excludes removals.
        const timerId = setTimeout(() => {
          if (!isMountedRef.current) return;
          if (announcementId !== latestAnnouncementIdRef.current) return;
          if (modalAnnouncerRef.current) {
            while (modalAnnouncerRef.current.firstChild) {
              modalAnnouncerRef.current.removeChild(modalAnnouncerRef.current.firstChild);
            }
          }
          if (announceTimerRef.current === timerId) {
            announceTimerRef.current = null;
          }
        }, 1500);
        announceTimerRef.current = timerId;
      }
    });
  }, []);

  // Announces a message inside the thumbnail section's own live region so
  // screen readers pick it up while focus is on the thumbnail container.
  const announceThumbnail = useCallback((message: string) => {
    const el = thumbnailAnnouncerRef.current;
    if (!el || !isMountedRef.current) return;
    if (thumbnailAnnounceTimerRef.current) {
      clearTimeout(thumbnailAnnounceTimerRef.current);
      thumbnailAnnounceTimerRef.current = null;
    }
    el.textContent = '';
    requestAnimationFrame(() => {
      if (!isMountedRef.current || !thumbnailAnnouncerRef.current) return;
      thumbnailAnnouncerRef.current.textContent = message;
      thumbnailAnnounceTimerRef.current = setTimeout(() => {
        if (thumbnailAnnouncerRef.current) thumbnailAnnouncerRef.current.textContent = '';
        thumbnailAnnounceTimerRef.current = null;
      }, 4000);
    });
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
    platforms: {
      youtube: editor.platforms.youtube !== undefined ? { ...editor.platforms.youtube } : undefined,
      vimeo: editor.platforms.vimeo !== undefined ? { ...editor.platforms.vimeo } : undefined,
      sftp: editor.platforms.sftp !== undefined ? { ...editor.platforms.sftp } : undefined,
      smb: editor.platforms.smb !== undefined ? { ...editor.platforms.smb } : undefined,
      sermon_audio:
        editor.platforms.sermon_audio !== undefined
          ? { ...editor.platforms.sermon_audio }
          : undefined,
    },
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
    setYoutubeLanguages([]);
    setYoutubeCategories([]);
    setYoutubeAccountDefaults(undefined);
    youtubeDefaultsSeededRef.current = null;
  }, [draftId]);

  useEffect(() => {
    if (!value?.targets.includes('youtube')) {
      return;
    }

    let cancelled = false;

    const loadYouTubeMetadataOptions = async () => {
      try {
        const [languagesResponse, categoriesResponse, accountDefaultsResponse] = await Promise.all([
          fetch('/api/platforms/youtube/languages', { cache: 'no-store' }),
          fetch('/api/platforms/youtube/categories', { cache: 'no-store' }),
          fetch('/api/platforms/youtube/account-defaults', { cache: 'no-store' }),
        ]);

        if (languagesResponse.ok) {
          const payload = (await languagesResponse.json()) as ApiResponse<
            Array<{ id: string; name: string }>
          >;
          if (!cancelled && Array.isArray(payload.data)) {
            setYoutubeLanguages(payload.data);
          }
        }

        if (categoriesResponse.ok) {
          const payload = (await categoriesResponse.json()) as ApiResponse<
            Array<{ id: string; title: string }>
          >;
          if (!cancelled && Array.isArray(payload.data)) {
            setYoutubeCategories(payload.data);
          }
        }

        if (accountDefaultsResponse.ok) {
          const payload =
            (await accountDefaultsResponse.json()) as ApiResponse<YouTubeAccountDefaults>;
          if (!cancelled && payload.data) {
            setYoutubeAccountDefaults(payload.data);
          }
        }
      } catch {
        // Language/category/account-default lists are optional for editing.
      }
    };

    void loadYouTubeMetadataOptions();
    return () => {
      cancelled = true;
    };
  }, [draftId, value?.targets]);

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
      setAiUndoStack([]);
      setAiRedoStack([]);
      return;
    }
    setAiUndoStack([]);
    setAiRedoStack([]);
  }, [draftId]);

  useEffect(() => {
    if (!value?.targets.includes('sermon_audio')) {
      return;
    }

    let cancelled = false;

    const loadSermonEventTypes = async () => {
      try {
        const response = await fetch(
          '/api/platforms/sermon-audio/filter-options/sermon-event-types',
          {
            cache: 'no-store',
          }
        );
        if (!response.ok) {
          throw new Error('Failed to load SermonAudio event types');
        }
        const payload = (await response.json()) as ApiResponse<string[]>;
        const types = Array.isArray(payload.data)
          ? payload.data.filter((item) => typeof item === 'string' && item.trim() !== '')
          : [];
        if (!cancelled) {
          setSermonEventTypes(types);
          setSermonEventTypesLoadFailed(types.length === 0);
        }
      } catch {
        if (!cancelled) {
          setSermonEventTypes(null);
          setSermonEventTypesLoadFailed(true);
        }
      }
    };

    void loadSermonEventTypes();
    return () => {
      cancelled = true;
    };
  }, [value?.targets]);

  useEffect(() => {
    if (!value?.targets.includes('sermon_audio')) return;
    const defaults = mergeSermonAudioDefaultFields(value.platforms.sermon_audio);
    if (Object.keys(defaults).length === 0) return;
    onChange({
      ...value,
      platforms: {
        ...value.platforms,
        sermon_audio: {
          ...value.platforms.sermon_audio,
          ...defaults,
        },
      },
    });
  }, [
    onChange,
    value,
    value?.platforms.sermon_audio?.eventType,
    value?.platforms.sermon_audio?.preachDate,
    value?.targets,
  ]);

  const selectedOverridePlatforms = useMemo(() => {
    if (!value) return [] as OverridePlatform[];
    return sortOverridePlatforms(value.targets.filter(isOverridePlatform));
  }, [value]);

  const selectedPrivacyPlatforms = useMemo(() => {
    if (!value) return [] as PrivacyPlatform[];
    return sortPrivacyPlatforms(value.targets.filter(isPrivacyPlatform));
  }, [value]);

  const usesSharedTitleGlobally = useMemo(() => {
    if (selectedOverridePlatforms.length < 2) return true;
    return selectedOverridePlatforms.every((platform) =>
      platformUsesSharedTitle(value?.platforms[platform])
    );
  }, [selectedOverridePlatforms, value?.platforms]);

  const usesSharedDescriptionGlobally = useMemo(() => {
    if (selectedOverridePlatforms.length < 2) return true;
    return selectedOverridePlatforms.every((platform) =>
      platformUsesSharedDescription(value?.platforms[platform])
    );
  }, [selectedOverridePlatforms, value?.platforms]);

  const usesSharedTagsGlobally = useMemo(() => {
    if (selectedOverridePlatforms.length < 2) return true;
    return selectedOverridePlatforms.every((platform) =>
      platformUsesSharedTags(value?.platforms[platform])
    );
  }, [selectedOverridePlatforms, value?.platforms]);

  const usesSharedVisibilityGlobally = useMemo(() => {
    if (selectedPrivacyPlatforms.length < 2) return true;
    return selectedPrivacyPlatforms.every((platform) =>
      platformUsesSharedVisibility(value?.platforms[platform])
    );
  }, [selectedPrivacyPlatforms, value?.platforms]);

  const showPerPlatformTitle = selectedOverridePlatforms.length >= 2 && !usesSharedTitleGlobally;
  const showPerPlatformDescription =
    selectedOverridePlatforms.length >= 2 && !usesSharedDescriptionGlobally;
  const showPerPlatformTags = selectedOverridePlatforms.length >= 2 && !usesSharedTagsGlobally;
  const sermonAudioOnlySharedTagInput =
    !showPerPlatformTags &&
    selectedOverridePlatforms.length === 1 &&
    selectedOverridePlatforms[0] === 'sermon_audio';
  const showPrivacyField = selectedPrivacyPlatforms.length > 0;
  const showPerPlatformPrivacy =
    selectedPrivacyPlatforms.length >= 2 && !usesSharedVisibilityGlobally;

  const showSermonAudioFields = value?.targets.includes('sermon_audio') ?? false;
  const showYouTubeFields = value?.targets.includes('youtube') ?? false;
  const showPlatformSectionHeaders =
    [showYouTubeFields, showSermonAudioFields].filter(Boolean).length >= 2;
  const showDraftThumbnailUpload = value != null && showDraftThumbnailUploadSection(value.targets);
  const sermonAudioFields = value?.platforms.sermon_audio;
  const youtubeFields = value?.platforms.youtube;
  const sermonAudioEffectiveTitleText = value
    ? sermonAudioEffectiveTitle(value, showPerPlatformTitle)
    : '';
  const showSermonAudioShortTitleUnderSharedTitle =
    showSermonAudioFields &&
    !showPerPlatformTitle &&
    needsSermonAudioShortTitle(sermonAudioEffectiveTitleText);

  const clearUploadFieldError = useCallback((field: DraftUploadFieldKey) => {
    setUploadFieldErrors((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  }, []);

  const fieldBorderClass = useCallback(
    (field: DraftUploadFieldKey) =>
      cn(
        'mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground',
        uploadFieldErrors.has(field)
          ? 'border-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:border-red-500'
          : 'border-border'
      ),
    [uploadFieldErrors]
  );

  const updateOverridePlatformFields = (
    platform: OverridePlatform,
    patch: Partial<YouTubeDraftFields | VimeoDraftFields | SermonAudioDraftFields>
  ) => {
    if (!value) return;
    onChange({
      ...value,
      platforms: {
        ...value.platforms,
        [platform]: {
          ...value.platforms[platform],
          ...patch,
        },
      },
    });
  };

  const setUseSharedCopyField = (field: SharedCopyField, useShared: boolean) => {
    if (!value) return;

    let nextPlatforms: DraftPlatforms = { ...value.platforms };
    for (const platform of selectedOverridePlatforms) {
      const current = nextPlatforms[platform] ?? {};
      let next: DraftPlatforms[OverridePlatform];

      if (useShared) {
        if (field === 'title') {
          const { titleOverride, ...rest } = current;
          next =
            Object.keys(rest).length > 0
              ? (rest as NonNullable<DraftPlatforms[OverridePlatform]>)
              : undefined;
        } else if (field === 'description') {
          const { descriptionOverride, ...rest } = current;
          next =
            Object.keys(rest).length > 0
              ? (rest as NonNullable<DraftPlatforms[OverridePlatform]>)
              : undefined;
        } else {
          const { tagsOverride, ...rest } = current;
          next =
            Object.keys(rest).length > 0
              ? (rest as NonNullable<DraftPlatforms[OverridePlatform]>)
              : undefined;
        }
      } else if (field === 'title') {
        next = { ...current, titleOverride: value.title };
      } else if (field === 'description') {
        next = { ...current, descriptionOverride: value.description };
      } else {
        next = { ...current, tagsOverride: [...value.tags] };
      }

      nextPlatforms = { ...nextPlatforms, [platform]: next };
    }

    onChange({ ...value, platforms: nextPlatforms });
    if (field === 'tags' && useShared) {
      setPlatformOverrideTagInput({});
    }
  };

  const setUseSharedVisibility = (useShared: boolean) => {
    if (!value) return;

    let nextPlatforms: DraftPlatforms = { ...value.platforms };
    for (const platform of selectedPrivacyPlatforms) {
      const current = nextPlatforms[platform] ?? {};
      let next: DraftPlatforms[PrivacyPlatform];

      if (useShared) {
        const { visibilityOverride, ...rest } = current;
        next =
          Object.keys(rest).length > 0
            ? (rest as NonNullable<DraftPlatforms[PrivacyPlatform]>)
            : undefined;
      } else {
        next = { ...current, visibilityOverride: value.visibility };
      }

      nextPlatforms = { ...nextPlatforms, [platform]: next };
    }

    onChange({ ...value, platforms: nextPlatforms });
  };

  const commitPlatformOverrideTags = (platform: OverridePlatform) => {
    if (!value) return;
    const raw = platformOverrideTagInput[platform]?.trim() ?? '';
    if (raw === '') return;
    const parsed =
      platform === 'sermon_audio' ? parseSermonAudioHashtagInput(raw) : parseSharedTagInput(raw);
    if (parsed.length === 0) return;
    const current = value.platforms[platform]?.tagsOverride ?? value.tags;
    updateOverridePlatformFields(platform, { tagsOverride: mergeUniqueTags(current, parsed) });
    setPlatformOverrideTagInput((prev) => ({ ...prev, [platform]: '' }));
  };

  const handlePlatformOverrideTagInputChange = (platform: OverridePlatform, next: string) => {
    if (platform !== 'sermon_audio' || !/\s/.test(next)) {
      setPlatformOverrideTagInput((prev) => ({ ...prev, [platform]: next }));
      return;
    }

    const segments = next.split(/\s+/);
    const remainder = segments.pop() ?? '';
    const complete = segments.filter(Boolean);
    if (complete.length > 0 && value) {
      const current = value.platforms[platform]?.tagsOverride ?? value.tags;
      const parsed = complete.flatMap((part) => parseSermonAudioHashtagInput(part));
      updateOverridePlatformFields(platform, { tagsOverride: mergeUniqueTags(current, parsed) });
    }
    setPlatformOverrideTagInput((prev) => ({ ...prev, [platform]: remainder }));
  };

  const updateSermonAudioFields = (patch: Partial<SermonAudioDraftFields>) => {
    if (!value) return;
    onChange({
      ...value,
      platforms: {
        ...value.platforms,
        sermon_audio: {
          ...value.platforms.sermon_audio,
          ...patch,
        },
      },
    });
  };

  const updateYouTubeFields = useCallback(
    (patch: Partial<YouTubeDraftFields>) => {
      if (!value) return;
      const current: Record<string, unknown> = { ...(value.platforms.youtube ?? {}) };
      for (const [key, fieldValue] of Object.entries(patch)) {
        if (fieldValue === undefined) {
          delete current[key];
        } else {
          current[key] = fieldValue;
        }
      }
      onChange({
        ...value,
        platforms: {
          ...value.platforms,
          youtube: Object.keys(current).length > 0 ? (current as YouTubeDraftFields) : undefined,
        },
      });
    },
    [onChange, value]
  );

  useEffect(() => {
    if (!value?.targets.includes('youtube')) {
      youtubeDefaultsSeededRef.current = null;
    }
  }, [value?.targets]);

  useEffect(() => {
    if (!value?.targets.includes('youtube') || !youtubeAccountDefaults) {
      return;
    }

    const seedKey = `${draftId}:${JSON.stringify(youtubeAccountDefaults)}`;
    if (youtubeDefaultsSeededRef.current === seedKey) {
      return;
    }

    youtubeDefaultsSeededRef.current = seedKey;
    const patch = buildYouTubeAccountDefaultsSeedPatch(
      value.platforms.youtube,
      youtubeAccountDefaults
    );
    if (Object.keys(patch).length > 0) {
      updateYouTubeFields(patch);
    }
  }, [draftId, value, youtubeAccountDefaults, updateYouTubeFields]);

  const youtubeMadeForKidsValue = youtubeFields?.madeForKids ?? youtubeAccountDefaults?.madeForKids;
  const youtubeDefaultAudioLanguageValue =
    youtubeFields?.defaultAudioLanguage ?? youtubeAccountDefaults?.defaultAudioLanguage;
  const youtubeRecordingDateValue = youtubeFields?.recordingDate ?? '';
  const youtubeLicenseValue = youtubeFields?.license ?? youtubeAccountDefaults?.license;
  const youtubeEmbeddableValue = youtubeFields?.embeddable ?? youtubeAccountDefaults?.embeddable;
  const youtubeNotifySubscribersValue = youtubeFields?.notifySubscribers !== false;
  const youtubeCategoryIdValue = youtubeFields?.categoryId ?? youtubeAccountDefaults?.categoryId;
  const youtubeLanguageOptions = useMemo(
    () => youtubeLanguages.map((language) => ({ value: language.id, label: language.name })),
    [youtubeLanguages]
  );
  const youtubeCategoryOptions = useMemo(
    () => youtubeCategories.map((category) => ({ value: category.id, label: category.title })),
    [youtubeCategories]
  );
  const youtubePublishAtValue = youtubeFields?.publishAt;
  const youtubeSchedulePastWarning =
    youtubePublishAtValue !== undefined && isPublishAtInPast(youtubePublishAtValue);
  const youtubePlaylistId = youtubeFields?.playlistIds?.[0];
  const youtubePlaylistTitle =
    youtubePlaylistId === undefined ? youtubeFields?.playlistTitles?.[0] : undefined;

  useEffect(() => {
    scheduleInitializedRef.current = false;
    setShowMoreExpanded(false);
    setAgeRestrictionsExpanded(false);
    setScheduleExpanded(false);
    setScheduleDate('');
    setScheduleTime('');
    setScheduleTimeZone('');
  }, [draftId]);

  useEffect(() => {
    if (!value || !showMoreExpanded || !scheduleExpanded) return;
    if (!scheduleDate || !scheduleTime || !scheduleTimeZone) return;

    let iso: string;
    try {
      iso = zonedDateTimeToUtcIso(scheduleDate, scheduleTime, scheduleTimeZone);
    } catch {
      return;
    }

    if (value.platforms.youtube?.publishAt === iso) return;
    updateYouTubeFields({ publishAt: iso });
  }, [
    scheduleDate,
    scheduleExpanded,
    scheduleTime,
    scheduleTimeZone,
    showMoreExpanded,
    updateYouTubeFields,
    value,
  ]);

  const handleScheduleExpandedChange = (nextExpanded: boolean) => {
    if (nextExpanded) {
      if (!scheduleInitializedRef.current) {
        const tz = getLocalTimeZone();
        const existingPublishAt = value?.platforms.youtube?.publishAt;
        if (existingPublishAt) {
          const parts = utcIsoToZonedScheduleParts(existingPublishAt, tz);
          if (parts) {
            setScheduleDate(parts.dateStr);
            setScheduleTime(parts.timeStr);
            setScheduleTimeZone(tz);
          } else {
            setScheduleDate(getDefaultScheduleDate(tz));
            setScheduleTime(getDefaultScheduleTime());
            setScheduleTimeZone(tz);
          }
        } else {
          setScheduleDate(getDefaultScheduleDate(tz));
          setScheduleTime(getDefaultScheduleTime());
          setScheduleTimeZone(tz);
        }
        scheduleInitializedRef.current = true;
      }
      setScheduleExpanded(true);
      return;
    }

    setScheduleExpanded(false);
    updateYouTubeFields({ publishAt: undefined });
  };

  const clearSchedule = () => {
    setScheduleExpanded(false);
    scheduleInitializedRef.current = false;
    setScheduleDate('');
    setScheduleTime('');
    setScheduleTimeZone('');
    updateYouTubeFields({ publishAt: undefined });
  };

  const commitTagsFromInput = useCallback(() => {
    if (!value) return;
    const parsed = sermonAudioOnlySharedTagInput
      ? parseSermonAudioHashtagInput(tagInput)
      : parseSharedTagInput(tagInput);
    if (parsed.length === 0) return;
    onChange({ ...value, tags: mergeUniqueTags(value.tags, parsed) });
    setTagInput('');
  }, [onChange, sermonAudioOnlySharedTagInput, tagInput, value]);

  const handleSharedTagInputChange = (next: string) => {
    if (!sermonAudioOnlySharedTagInput || !/\s/.test(next)) {
      setTagInput(next);
      return;
    }

    const segments = next.split(/\s+/);
    const remainder = segments.pop() ?? '';
    const complete = segments.filter(Boolean);
    if (complete.length > 0 && value) {
      const parsed = complete.flatMap((part) => parseSermonAudioHashtagInput(part));
      onChange({ ...value, tags: mergeUniqueTags(value.tags, parsed) });
    }
    setTagInput(remainder);
  };

  const commitTagsBeforeSave = useCallback(() => {
    // Ensure tag commit is flushed before any save call reads value.tags.
    flushSync(() => {
      commitTagsFromInput();
    });
  }, [commitTagsFromInput]);

  const validateBeforeUpload = useCallback((): boolean => {
    if (!value) return false;
    commitTagsBeforeSave();
    const issues = validateDraftForUpload({
      title: value.title,
      description: value.description,
      tags: value.tags,
      targets: value.targets,
      platforms: value.platforms,
    });
    if (issues.length > 0) {
      setUploadFieldErrors(new Set(issues.map((issue) => issue.field)));
      toast.error(issues[0]?.message ?? 'Fill in required fields before uploading.');
      return false;
    }
    setUploadFieldErrors(new Set());
    return true;
  }, [commitTagsBeforeSave, value]);

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
  const trimmedAiPrompt = aiPrompt.trim();
  const hasAiPrompt = trimmedAiPrompt !== '';
  const hasGeneratedMetadata =
    value !== null &&
    (value.title.trim() !== '' || value.description.trim() !== '' || value.tags.length > 0);

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
    if (!hasAiPrompt) return;
    if (value.targets.length === 0) {
      toast.error('Please select at least one platform first');
      return;
    }

    const requestDraftId = value.id;
    // Capture state before we start so undo reverts to the correct baseline.
    const preStreamSnapshot = snapshotEditor(value);
    aiMetadataAbortRef.current?.abort();
    const ac = new AbortController();
    aiMetadataAbortRef.current = ac;

    let didStreamUpdate = false;

    const revertPartialUpdates = () => {
      if (!didStreamUpdate) return;
      if (latestDraftIdRef.current !== requestDraftId) return;
      const latest = latestValueRef.current;
      if (latest) {
        onChange({
          ...latest,
          title: preStreamSnapshot.title,
          description: preStreamSnapshot.description,
          tags: [...preStreamSnapshot.tags],
        });
      }
    };

    setIsGeneratingAi(true);
    try {
      const response = await fetch('/api/ai/generate-metadata/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: videoFile?.name ?? 'video',
          userPrompt: trimmedAiPrompt || undefined,
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

      // Read the SSE stream — push partial JSON tokens live into the form fields.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parseSseChunk = createSseParser();
      let accumulated = '';

      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) {
          // Flush the TextDecoder's internal buffer so any trailing multi-byte
          // UTF-8 sequences held across chunk boundaries are not silently dropped.
          const flushed = decoder.decode();
          if (flushed) {
            for (const result of parseSseChunk(flushed)) {
              if (result.error) throw new Error(result.error);
              if (result.done) {
                // [DONE] arrived in the final flush — run the same finalization
                // path as the main loop so metadata is applied and not silently dropped.
                if (ac.signal.aborted) return;
                if (latestDraftIdRef.current !== requestDraftId) {
                  ac.abort();
                  return;
                }

                let parsed: { title?: unknown; description?: unknown; tags?: unknown };
                try {
                  parsed = JSON.parse(accumulated) as typeof parsed;
                } catch {
                  throw new Error('AI returned invalid JSON. Please try again.');
                }

                setAiUndoStack((prev) => [...prev, preStreamSnapshot]);
                setAiRedoStack([]);

                const latest = latestValueRef.current;
                if (!latest) {
                  ac.abort();
                  return;
                }
                onChange({
                  ...latest,
                  title: typeof parsed.title === 'string' ? parsed.title : '',
                  description: typeof parsed.description === 'string' ? parsed.description : '',
                  tags:
                    Array.isArray(parsed.tags) && parsed.tags.every((t) => typeof t === 'string')
                      ? (parsed.tags as string[])
                      : [],
                });
                announceInModal('Metadata generated successfully');
                return;
              }
            }
          }
          break;
        }
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
            // Stream complete — parse the fully assembled JSON and apply final values.
            if (ac.signal.aborted) return;
            if (latestDraftIdRef.current !== requestDraftId) {
              ac.abort();
              return;
            }

            let parsed: { title?: unknown; description?: unknown; tags?: unknown };
            try {
              parsed = JSON.parse(accumulated) as typeof parsed;
            } catch {
              throw new Error('AI returned invalid JSON. Please try again.');
            }

            // Push the pre-stream snapshot (not the mid-stream state) to the undo stack.
            setAiUndoStack((prev) => [...prev, preStreamSnapshot]);
            setAiRedoStack([]);

            const latest = latestValueRef.current;
            if (!latest) {
              ac.abort();
              return;
            }
            onChange({
              ...latest,
              title: typeof parsed.title === 'string' ? parsed.title : '',
              description: typeof parsed.description === 'string' ? parsed.description : '',
              tags:
                Array.isArray(parsed.tags) && parsed.tags.every((t) => typeof t === 'string')
                  ? (parsed.tags as string[])
                  : [],
            });
            announceInModal('Metadata generated successfully');
            return;
          }
          if (result.deltaContent !== undefined) {
            accumulated += result.deltaContent;
            if (latestDraftIdRef.current !== requestDraftId) {
              ac.abort();
              return;
            }
            const latest = latestValueRef.current;
            if (latest) {
              didStreamUpdate = true;
              onChange({ ...latest, ...extractPartialAiFields(accumulated) });
            }
          }
        }
      }
      // Stream closed without sending [DONE] — treat as an error.
      throw new Error('Stream ended without a completion signal. Please try again.');
    } catch (error) {
      const isAbort =
        (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError';
      // Undo any partial live field updates so the form isn't left with incomplete JSON.
      revertPartialUpdates();
      if (isAbort) return;
      console.warn('AI metadata generation failed:', error);
      toast.error('Failed to generate metadata. Please try again.');
    } finally {
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

    let nextPlatforms = value.platforms;
    if (!isSelected && platform === 'sermon_audio') {
      const defaults = mergeSermonAudioDefaultFields(value.platforms.sermon_audio);
      if (Object.keys(defaults).length > 0) {
        nextPlatforms = {
          ...value.platforms,
          sermon_audio: {
            ...value.platforms.sermon_audio,
            ...defaults,
          },
        };
      }
    }

    onChange({
      ...value,
      targets: isSelected
        ? value.targets.filter((p) => p !== platform)
        : [...value.targets, platform],
      platforms: nextPlatforms,
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
    if (!validateBeforeUpload()) return;

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
        } | null;
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
      announceInModal('Video uploaded successfully');
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
          // Best-effort: mark cancelled when PUT or complete failed.
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
      announceInModal('Upload cancelled');
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
      announceThumbnail('Thumbnail uploaded');
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
      announceThumbnail('Thumbnail removed');
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

  const mergePlatformFieldsIntoMetadataCard = !showPlatformSectionHeaders;

  const youtubePlatformFieldsSection = (
    <>
      <div>
        <label htmlFor="draft-youtube-playlist" className="text-sm font-medium text-foreground">
          Playlist
        </label>
        <YouTubePlaylistCombobox
          id="draft-youtube-playlist"
          playlistId={youtubePlaylistId}
          playlistTitle={youtubePlaylistTitle}
          onPlaylistChange={(next) => {
            updateYouTubeFields({
              playlistIds: next.playlistId ? [next.playlistId] : [],
              playlistTitles: next.playlistTitle ? [next.playlistTitle] : [],
            });
          }}
          className={fieldBorderClass('youtube.playlistIds')}
        />
      </div>
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setAgeRestrictionsExpanded((prev) => !prev)}
          className="inline-flex items-center gap-2 text-sm font-medium text-foreground"
          aria-expanded={ageRestrictionsExpanded}
        >
          {ageRestrictionsExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          Age restrictions
        </button>
        {ageRestrictionsExpanded ? (
          <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-3">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-foreground">Made for kids</legend>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
                <input
                  type="radio"
                  name="draft-youtube-made-for-kids"
                  className="mt-1"
                  checked={youtubeMadeForKidsValue === true}
                  onChange={() => updateYouTubeFields({ madeForKids: true })}
                />
                <span>Yes, it&apos;s made for kids.</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
                <input
                  type="radio"
                  name="draft-youtube-made-for-kids"
                  className="mt-1"
                  checked={youtubeMadeForKidsValue === false}
                  onChange={() => updateYouTubeFields({ madeForKids: false })}
                />
                <span>No, it&apos;s not made for kids.</span>
              </label>
            </fieldset>
          </div>
        ) : null}
      </div>
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowMoreExpanded((prev) => !prev)}
          className="inline-flex items-center gap-2 text-sm font-medium text-foreground"
          aria-expanded={showMoreExpanded}
        >
          {showMoreExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          Show more
        </button>
        {showMoreExpanded ? (
          <div className="space-y-6 rounded-lg border border-border bg-muted/20 p-3">
            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">Video language</p>
              <YouTubeSearchableSelect
                id="draft-youtube-video-language"
                value={youtubeDefaultAudioLanguageValue}
                placeholder="Select video language"
                options={youtubeLanguageOptions}
                onValueChange={(next) =>
                  updateYouTubeFields({
                    defaultAudioLanguage: next,
                  })
                }
                className={fieldBorderClass('youtube.defaultAudioLanguage')}
              />
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">Recording date</p>
              <div className="flex gap-2">
                <input
                  id="draft-youtube-recording-date"
                  type="date"
                  aria-label="Recording date"
                  value={youtubeRecordingDateValue}
                  onChange={(event) =>
                    updateYouTubeFields({
                      recordingDate: event.target.value || undefined,
                    })
                  }
                  className={cn(fieldBorderClass('youtube.recordingDate'), 'flex-1')}
                />
                {youtubeRecordingDateValue !== '' ? (
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 py-2 text-xs text-foreground hover:bg-muted"
                    onClick={() => updateYouTubeFields({ recordingDate: undefined })}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">License</p>
              <Select
                value={youtubeLicenseValue}
                onValueChange={(next) =>
                  updateYouTubeFields({
                    license: next as YouTubeDraftFields['license'],
                  })
                }
              >
                <SelectTrigger
                  id="draft-youtube-license"
                  className={cn(
                    fieldBorderClass('youtube.license'),
                    'flex h-10 items-center justify-between text-left'
                  )}
                >
                  <SelectValue placeholder="Select license" />
                </SelectTrigger>
                <SelectContent>
                  {YOUTUBE_LICENSE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={youtubeEmbeddableValue ?? false}
                  onChange={(event) => updateYouTubeFields({ embeddable: event.target.checked })}
                />
                <span>Allow embedding</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={youtubeNotifySubscribersValue}
                  onChange={(event) =>
                    updateYouTubeFields({ notifySubscribers: event.target.checked })
                  }
                />
                <span>Publish to subscriptions feed and notify subscribers</span>
              </label>
            </div>

            <div>
              <label
                htmlFor="draft-youtube-category"
                className="text-sm font-medium text-foreground"
              >
                Category
              </label>
              <YouTubeSearchableSelect
                id="draft-youtube-category"
                value={youtubeCategoryIdValue}
                placeholder="Select category"
                options={youtubeCategoryOptions}
                onValueChange={(next) => updateYouTubeFields({ categoryId: next ?? undefined })}
                className={fieldBorderClass('youtube.categoryId')}
              />
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => handleScheduleExpandedChange(!scheduleExpanded)}
                className="inline-flex items-center gap-2 text-sm font-medium text-foreground"
                aria-expanded={scheduleExpanded}
              >
                {scheduleExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Schedule
              </button>
              {scheduleExpanded ? (
                <div className="space-y-3 rounded-lg border border-border bg-background p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Schedule</p>
                    <p className="text-xs text-muted-foreground">Schedule as public</p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="min-w-0 flex-1">
                      <label
                        htmlFor="draft-youtube-schedule-date"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Date
                      </label>
                      <input
                        id="draft-youtube-schedule-date"
                        type="date"
                        value={scheduleDate}
                        onChange={(event) => {
                          const nextDate = event.target.value;
                          setScheduleDate(nextDate);
                          if (!nextDate) {
                            updateYouTubeFields({ publishAt: undefined });
                          }
                        }}
                        className={cn(
                          fieldBorderClass('youtube.publishAt'),
                          'mt-1 flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm'
                        )}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <label
                        htmlFor="draft-youtube-schedule-time"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Time
                      </label>
                      <Select value={scheduleTime} onValueChange={(next) => setScheduleTime(next)}>
                        <SelectTrigger
                          id="draft-youtube-schedule-time"
                          className={cn(
                            fieldBorderClass('youtube.publishAt'),
                            'mt-1 flex h-10 items-center justify-between text-left'
                          )}
                        >
                          <SelectValue placeholder="Select time" />
                        </SelectTrigger>
                        <SelectContent>
                          {YOUTUBE_SCHEDULE_TIME_OPTIONS.map((timeOption) => (
                            <SelectItem key={timeOption} value={timeOption}>
                              {timeOption}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="min-w-0 flex-1">
                      <label
                        htmlFor="draft-youtube-schedule-timezone"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Timezone
                      </label>
                      <YouTubeTimezoneSelect
                        id="draft-youtube-schedule-timezone"
                        value={scheduleTimeZone}
                        options={supportedTimeZones}
                        onValueChange={(next) => setScheduleTimeZone(next)}
                        className={cn(
                          fieldBorderClass('youtube.publishAt'),
                          'mt-1 w-full rounded-md border bg-background px-3'
                        )}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={clearSchedule}
                      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      Clear schedule
                    </button>
                    {youtubeSchedulePastWarning ? (
                      <p className="text-sm text-amber-600 dark:text-amber-400">
                        Scheduled time is in the past. The video may publish immediately.
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );

  const sermonAudioPlatformFieldsSection = (
    <>
      <div>
        <label htmlFor="draft-sermon-audio-speaker" className="text-sm font-medium text-foreground">
          Speaker
        </label>
        <SermonAudioSpeakerCombobox
          id="draft-sermon-audio-speaker"
          speakerName={sermonAudioFields?.speakerName ?? ''}
          speakerID={sermonAudioFields?.speakerID}
          onSpeakerChange={(next) => {
            clearUploadFieldError('sermon_audio.speakerName');
            updateSermonAudioFields(next);
          }}
          invalid={uploadFieldErrors.has('sermon_audio.speakerName')}
          className={fieldBorderClass('sermon_audio.speakerName')}
        />
      </div>
      <div>
        <label
          htmlFor="draft-sermon-audio-preach-date"
          className="text-sm font-medium text-foreground"
        >
          Date Recorded
        </label>
        <input
          id="draft-sermon-audio-preach-date"
          type="date"
          value={sermonAudioFields?.preachDate ?? ''}
          onChange={(event) => {
            clearUploadFieldError('sermon_audio.preachDate');
            updateSermonAudioFields({ preachDate: event.target.value });
          }}
          aria-invalid={uploadFieldErrors.has('sermon_audio.preachDate')}
          className={fieldBorderClass('sermon_audio.preachDate')}
        />
      </div>
      <div>
        <label
          htmlFor="draft-sermon-audio-event-type"
          className="text-sm font-medium text-foreground"
        >
          Event Category
        </label>
        {sermonEventTypesLoadFailed || sermonEventTypes === null ? (
          <input
            id="draft-sermon-audio-event-type"
            value={sermonAudioFields?.eventType ?? ''}
            onChange={(event) => {
              clearUploadFieldError('sermon_audio.eventType');
              updateSermonAudioFields({ eventType: event.target.value });
            }}
            aria-invalid={uploadFieldErrors.has('sermon_audio.eventType')}
            className={fieldBorderClass('sermon_audio.eventType')}
          />
        ) : (
          <Select
            value={
              sermonAudioFields?.eventType && sermonAudioFields.eventType !== ''
                ? sermonAudioFields.eventType
                : undefined
            }
            onValueChange={(next) => {
              clearUploadFieldError('sermon_audio.eventType');
              updateSermonAudioFields({ eventType: next });
            }}
          >
            <SelectTrigger
              id="draft-sermon-audio-event-type"
              aria-invalid={uploadFieldErrors.has('sermon_audio.eventType')}
              className={cn(
                fieldBorderClass('sermon_audio.eventType'),
                'flex h-10 items-center justify-between text-left'
              )}
            >
              <SelectValue placeholder="Select an event category" />
            </SelectTrigger>
            <SelectContent>
              {sermonEventTypes.map((eventType) => (
                <SelectItem key={eventType} value={eventType}>
                  {eventType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div>
        <label htmlFor="draft-sermon-audio-series" className="text-sm font-medium text-foreground">
          Series
        </label>
        <SermonAudioSeriesCombobox
          id="draft-sermon-audio-series"
          seriesTitle={sermonAudioFields?.subtitle ?? ''}
          seriesID={sermonAudioFields?.seriesID}
          onSeriesChange={(next) => {
            updateSermonAudioFields(next);
          }}
          className={fieldBorderClass('sermon_audio.subtitle')}
        />
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label
            htmlFor="draft-sermon-audio-bible-text"
            className="text-sm font-medium text-foreground"
          >
            Bible References
          </label>
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {parseBibleReferences(sermonAudioFields?.bibleText ?? '').length}/
            {SERMON_AUDIO_MAX_BIBLE_REFERENCES}
          </span>
        </div>
        <SermonAudioBibleReferencesField
          id="draft-sermon-audio-bible-text"
          bibleText={sermonAudioFields?.bibleText ?? ''}
          onBibleTextChange={(next) => updateSermonAudioFields({ bibleText: next })}
          invalid={uploadFieldErrors.has('sermon_audio.bibleText')}
          className={fieldBorderClass('sermon_audio.bibleText')}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-foreground">Auto-publish when processed</span>
        <label
          htmlFor="draft-sermon-audio-auto-publish"
          className="relative inline-flex cursor-pointer items-center"
        >
          <input
            id="draft-sermon-audio-auto-publish"
            type="checkbox"
            role="switch"
            aria-label="Auto-publish when processed"
            checked={sermonAudioFields?.autoPublishOnProcessed !== false}
            onChange={(event) =>
              updateSermonAudioFields({
                autoPublishOnProcessed: event.target.checked,
              })
            }
            className="peer sr-only"
          />
          <span className="h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-primary" />
          <span className="pointer-events-none absolute left-0.5 h-5 w-5 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-5" />
        </label>
      </div>
      {/* TODO(sermon-audio-cross-publish): I will contact the SermonAudio developer about how to get Cross Publish working via the API. Cross Publish UI hidden until then. */}
    </>
  );

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
        className="flex max-h-[90vh] w-full max-w-2xl flex-col p-0 sm:max-w-2xl"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div
          ref={modalAnnouncerRef}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-relevant="additions"
          className="sr-only"
        />
        {modalStatusMsg && (
          <div
            aria-hidden="true"
            className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
          >
            <CircleCheck className="h-4 w-4 shrink-0" />
            {modalStatusMsg}
          </div>
        )}
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
            <DraftModalCard title="Target platforms" data-tour="draft-platforms">
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
                  One or more selected targets are no longer connected. Reconnect them to include
                  them again.{' '}
                  <Link href="/profile/connections" className="underline underline-offset-2">
                    Open Connections
                  </Link>
                  .
                </p>
              ) : null}
            </DraftModalCard>
            {canUseAiMetadata ? (
              <DraftModalCard
                className="bg-muted/40"
                header={
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
                }
              >
                <p id="draft-ai-metadata-help" className="text-xs text-muted-foreground">
                  Enter a prompt to generate title, description, and tags.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="draft-ai-prompt" className="sr-only">
                    AI prompt required for generation
                  </label>
                  <input
                    id="draft-ai-prompt"
                    value={aiPrompt}
                    onChange={(event) => setAiPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !isGeneratingAi && hasAiPrompt) {
                        void handleGenerateAiMetadata();
                      }
                    }}
                    aria-describedby="draft-ai-metadata-help"
                    placeholder="Enter a prompt for AI"
                    className="min-w-55 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                  {isGeneratingAi ? (
                    <button
                      type="button"
                      onClick={() => {
                        aiMetadataAbortRef.current?.abort();
                      }}
                      aria-describedby="draft-ai-metadata-help"
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
                      disabled={isGeneratingAi || !hasAiPrompt}
                      aria-describedby="draft-ai-metadata-help"
                      className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                    >
                      {`${hasGeneratedMetadata ? 'Regenerate' : 'Generate'} with AI`}
                    </button>
                  )}
                </div>
                {isGeneratingAi ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    AI is generating your metadata…
                  </p>
                ) : null}
              </DraftModalCard>
            ) : null}
            <DraftModalCard>
              <div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <label htmlFor="edit-title" className="text-sm font-medium text-foreground">
                    Title
                  </label>
                  {selectedOverridePlatforms.length >= 2 ? (
                    <SharedMetadataCheckbox
                      checked={usesSharedTitleGlobally}
                      onChange={(useShared) => setUseSharedCopyField('title', useShared)}
                      hint="When checked, all selected platforms share one title. Uncheck to set a title per platform."
                    />
                  ) : null}
                </div>
                {showPerPlatformTitle ? (
                  <div className="mt-2 space-y-3">
                    {selectedOverridePlatforms.map((platform) => {
                      const platformFields = value.platforms[platform];
                      const fieldKey = `title:${platform}` as DraftUploadFieldKey;
                      const platformTitle = platformFields?.titleOverride ?? value.title;
                      const showShortTitleUnderPlatform =
                        platform === 'sermon_audio' && needsSermonAudioShortTitle(platformTitle);
                      return (
                        <div key={platform}>
                          <label
                            htmlFor={`edit-title-${platform}`}
                            className="text-xs font-medium text-muted-foreground"
                          >
                            {isPlatformBrandIcon(platform) ? (
                              <PlatformOverrideLabel platform={platform} />
                            ) : (
                              platformLabel(platform)
                            )}
                          </label>
                          <input
                            id={`edit-title-${platform}`}
                            value={platformTitle}
                            onChange={(event) => {
                              clearUploadFieldError(fieldKey);
                              updateOverridePlatformFields(platform, {
                                titleOverride: event.target.value,
                              });
                            }}
                            aria-invalid={uploadFieldErrors.has(fieldKey)}
                            className={fieldBorderClass(fieldKey)}
                          />
                          {showShortTitleUnderPlatform ? (
                            <SermonAudioShortTitleField
                              className="mt-3"
                              value={sermonAudioFields?.displayTitle ?? ''}
                              onChange={(next) => updateSermonAudioFields({ displayTitle: next })}
                              fieldBorderClassName={fieldBorderClass('sermon_audio.displayTitle')}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <>
                    <input
                      id="edit-title"
                      data-tour="draft-title-input"
                      value={value.title}
                      onChange={(event) => {
                        clearUploadFieldError('title');
                        onChange({ ...value, title: event.target.value });
                      }}
                      aria-invalid={uploadFieldErrors.has('title')}
                      className={fieldBorderClass('title')}
                    />
                    {showSermonAudioShortTitleUnderSharedTitle ? (
                      <SermonAudioShortTitleField
                        className="mt-3"
                        value={sermonAudioFields?.displayTitle ?? ''}
                        onChange={(next) => updateSermonAudioFields({ displayTitle: next })}
                        fieldBorderClassName={fieldBorderClass('sermon_audio.displayTitle')}
                      />
                    ) : null}
                  </>
                )}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <label htmlFor="edit-description" className="text-sm font-medium text-foreground">
                    Description
                  </label>
                  {selectedOverridePlatforms.length >= 2 ? (
                    <SharedMetadataCheckbox
                      checked={usesSharedDescriptionGlobally}
                      onChange={(useShared) => setUseSharedCopyField('description', useShared)}
                      hint="When checked, all selected platforms share one description. Uncheck to set a description per platform."
                    />
                  ) : null}
                </div>
                {showPerPlatformDescription ? (
                  <div className="mt-2 space-y-3">
                    {selectedOverridePlatforms.map((platform) => {
                      const platformFields = value.platforms[platform];
                      return (
                        <div key={platform}>
                          <label
                            htmlFor={`edit-description-${platform}`}
                            className="text-xs font-medium text-muted-foreground"
                          >
                            {isPlatformBrandIcon(platform) ? (
                              <PlatformOverrideLabel platform={platform} />
                            ) : (
                              platformLabel(platform)
                            )}
                          </label>
                          <textarea
                            id={`edit-description-${platform}`}
                            value={platformFields?.descriptionOverride ?? value.description}
                            onChange={(event) =>
                              updateOverridePlatformFields(platform, {
                                descriptionOverride: event.target.value,
                              })
                            }
                            rows={4}
                            className={fieldBorderClass(`description:${platform}`)}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <textarea
                    id="edit-description"
                    value={value.description}
                    onChange={(event) => onChange({ ...value, description: event.target.value })}
                    rows={4}
                    className={fieldBorderClass('description')}
                  />
                )}
              </div>
              {showPrivacyField ? (
                <div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <label
                      htmlFor="edit-visibility"
                      className="text-sm font-medium text-foreground"
                    >
                      Privacy
                    </label>
                    {selectedPrivacyPlatforms.length >= 2 ? (
                      <SharedMetadataCheckbox
                        checked={usesSharedVisibilityGlobally}
                        onChange={setUseSharedVisibility}
                        hint="When checked, YouTube and Vimeo share one privacy setting. Uncheck to set privacy per platform."
                      />
                    ) : null}
                  </div>
                  {showPerPlatformPrivacy ? (
                    <div className="mt-2 space-y-3">
                      {selectedPrivacyPlatforms.map((platform) => {
                        const platformFields = value.platforms[platform];
                        const platformVisibility =
                          platformFields?.visibilityOverride ?? value.visibility;
                        return (
                          <div key={platform}>
                            <label
                              htmlFor={`edit-visibility-${platform}`}
                              className="text-xs font-medium text-muted-foreground"
                            >
                              {isPlatformBrandIcon(platform) ? (
                                <PlatformOverrideLabel platform={platform} />
                              ) : (
                                platformLabel(platform)
                              )}
                            </label>
                            <Select
                              value={platformVisibility}
                              onValueChange={(next) =>
                                updateOverridePlatformFields(platform, {
                                  visibilityOverride: next as Draft['visibility'],
                                })
                              }
                            >
                              <SelectTrigger
                                id={`edit-visibility-${platform}`}
                                className={cn(
                                  fieldBorderClass(`visibility:${platform}`),
                                  'flex h-10 items-center justify-between text-left'
                                )}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {VISIBILITY_OPTIONS.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <Select
                      value={value.visibility}
                      onValueChange={(next) =>
                        onChange({
                          ...value,
                          visibility: next as Draft['visibility'],
                        })
                      }
                    >
                      <SelectTrigger
                        id="edit-visibility"
                        className={cn(
                          fieldBorderClass('visibility'),
                          'flex h-10 items-center justify-between text-left'
                        )}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VISIBILITY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ) : null}
              <div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <label htmlFor="edit-tags" className="text-sm font-medium text-foreground">
                    {showSermonAudioFields ? 'Tags / Hashtags' : 'Tags'}
                  </label>
                  {selectedOverridePlatforms.length >= 2 ? (
                    <SharedMetadataCheckbox
                      checked={usesSharedTagsGlobally}
                      onChange={(useShared) => setUseSharedCopyField('tags', useShared)}
                      hint={
                        showSermonAudioFields
                          ? 'When checked, all selected platforms share one tag list (SermonAudio hashtags included). Uncheck to set tags per platform.'
                          : 'When checked, all selected platforms share one tag list. Uncheck to set tags per platform.'
                      }
                    />
                  ) : null}
                </div>
                {showPerPlatformTags ? (
                  <div className="mt-2 space-y-3">
                    {selectedOverridePlatforms.map((platform) => {
                      const platformFields = value.platforms[platform];
                      const overrideTags = platformFields?.tagsOverride ?? value.tags;
                      return (
                        <div key={platform}>
                          <label
                            htmlFor={`edit-tags-${platform}`}
                            className="text-xs font-medium text-muted-foreground"
                          >
                            {isPlatformBrandIcon(platform) ? (
                              <PlatformOverrideLabel
                                platform={platform}
                                suffix={platform === 'sermon_audio' ? ' (hashtags)' : undefined}
                              />
                            ) : (
                              <>
                                {platformLabel(platform)}
                                {platform === 'sermon_audio' ? ' (hashtags)' : ''}
                              </>
                            )}
                          </label>
                          <div
                            className={cn(
                              'mt-1 rounded-md border bg-background px-2 py-2',
                              uploadFieldErrors.has(`tags:${platform}`)
                                ? 'border-red-600 dark:border-red-500'
                                : 'border-border'
                            )}
                          >
                            <div className="mb-2 flex flex-wrap gap-2">
                              {overrideTags.map((tag) => (
                                <span
                                  key={`${platform}-${tag}`}
                                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
                                >
                                  {tag}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateOverridePlatformFields(platform, {
                                        tagsOverride: overrideTags.filter(
                                          (existing) => existing !== tag
                                        ),
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
                              id={`edit-tags-${platform}`}
                              value={platformOverrideTagInput[platform] ?? ''}
                              onChange={(event) =>
                                handlePlatformOverrideTagInputChange(platform, event.target.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ',') {
                                  event.preventDefault();
                                  commitPlatformOverrideTags(platform);
                                } else if (
                                  event.key === ' ' &&
                                  platform === 'sermon_audio' &&
                                  (platformOverrideTagInput[platform] ?? '').trim() !== ''
                                ) {
                                  event.preventDefault();
                                  commitPlatformOverrideTags(platform);
                                } else if (
                                  event.key === 'Backspace' &&
                                  (platformOverrideTagInput[platform] ?? '') === '' &&
                                  overrideTags.length > 0
                                ) {
                                  event.preventDefault();
                                  const lastTag = overrideTags[overrideTags.length - 1];
                                  updateOverridePlatformFields(platform, {
                                    tagsOverride: overrideTags.slice(0, -1),
                                  });
                                  setPlatformOverrideTagInput((prev) => ({
                                    ...prev,
                                    [platform]: lastTag,
                                  }));
                                }
                              }}
                              onBlur={() => commitPlatformOverrideTags(platform)}
                              placeholder={
                                platform === 'sermon_audio'
                                  ? 'Type one hashtag; press Enter, comma, or space'
                                  : 'Type a tag and press Enter or comma'
                              }
                              className="block w-full border-0 bg-transparent px-1 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    className={cn(
                      'mt-1 rounded-md border bg-background px-2 py-2',
                      uploadFieldErrors.has('tags')
                        ? 'border-red-600 dark:border-red-500'
                        : 'border-border'
                    )}
                  >
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
                      onChange={(event) => handleSharedTagInputChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ',') {
                          event.preventDefault();
                          commitTagsFromInput();
                        } else if (
                          event.key === ' ' &&
                          sermonAudioOnlySharedTagInput &&
                          tagInput.trim() !== ''
                        ) {
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
                      placeholder={
                        sermonAudioOnlySharedTagInput
                          ? 'Type one hashtag; press Enter, comma, or space'
                          : 'Type a tag and press Enter or comma'
                      }
                      className="block w-full border-0 bg-transparent px-1 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                  </div>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {showPerPlatformTags
                    ? 'YouTube and Vimeo tags may include spaces. SermonAudio hashtags are one word each; leading `#` is removed.'
                    : sermonAudioOnlySharedTagInput
                      ? 'SermonAudio hashtags are one word each; press Enter, comma, or space to add. Leading `#` is removed.'
                      : `Press Enter or comma to add tags${
                          showSermonAudioFields
                            ? '. SermonAudio hashtags omit spaces and `#` when uploaded'
                            : ''
                        }.`}
                </p>
              </div>
              {mergePlatformFieldsIntoMetadataCard && showYouTubeFields
                ? youtubePlatformFieldsSection
                : null}
              {mergePlatformFieldsIntoMetadataCard && showSermonAudioFields
                ? sermonAudioPlatformFieldsSection
                : null}
            </DraftModalCard>
            {!mergePlatformFieldsIntoMetadataCard && showYouTubeFields ? (
              <DraftModalCard
                header={
                  showPlatformSectionHeaders ? (
                    <PlatformSectionHeader platform="youtube" />
                  ) : undefined
                }
              >
                {youtubePlatformFieldsSection}
              </DraftModalCard>
            ) : null}
            {!mergePlatformFieldsIntoMetadataCard && showSermonAudioFields ? (
              <DraftModalCard
                header={
                  showPlatformSectionHeaders ? (
                    <PlatformSectionHeader platform="sermon_audio" />
                  ) : undefined
                }
              >
                {sermonAudioPlatformFieldsSection}
              </DraftModalCard>
            ) : null}
            {/* TODO(sermon-audio-thumbnail): Ask SermonAudio how to set display video thumbnails via the public API (uploadType, API key permissions). Hidden when SermonAudio is the only distribute target until supported. */}
            {showDraftThumbnailUpload ? (
              <DraftModalCard ref={thumbnailSectionRef} tabIndex={-1} title="Thumbnail">
                {/* Thumbnail-scoped live region — announced while focus is within this section */}
                <div
                  ref={thumbnailAnnouncerRef}
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  className="sr-only"
                />
                <p className="text-xs text-muted-foreground">
                  JPG or PNG, max {DRAFT_THUMBNAIL_MAX_SIZE_LABEL}. Shown on platforms that support
                  custom thumbnails when you distribute.
                </p>
                {!draftId ? (
                  <p className="text-xs text-muted-foreground">
                    Create draft first to add a thumbnail.
                  </p>
                ) : (
                  <>
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
                      <label htmlFor="draft-thumbnail-file" className="sr-only">
                        Choose thumbnail image
                      </label>
                      <input
                        id="draft-thumbnail-file"
                        ref={thumbnailInputRef}
                        type="file"
                        accept={DRAFT_THUMBNAIL_INPUT_ACCEPT}
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            // The browser restores focus from the native file
                            // picker *after* onChange fires and after any state
                            // updates.  The upload button is disabled by then, so
                            // the browser falls back to the dialog root and the
                            // screen reader re-reads the entire modal.  Instead
                            // we focus the thumbnail section container (tabIndex
                            // -1, never disabled) in a rAF so we run after the
                            // browser's own focus-restoration tick.
                            requestAnimationFrame(() => {
                              thumbnailSectionRef.current?.focus();
                            });
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
                  </>
                )}
              </DraftModalCard>
            ) : null}
            <DraftModalCard title="Upload video" data-tour="draft-upload-section">
              <p className="text-xs text-muted-foreground">
                Choose a video file, then upload it for this draft.
              </p>
              <div className="flex flex-wrap items-center gap-2">
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
            </DraftModalCard>
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
                              {platformLabel(platform.platform)}: {platform.status} (
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
              void (async () => {
                try {
                  const r = await onSave({ closeAfterSave: true });
                  if (r.message) toast.success(r.message);
                } catch (error) {
                  console.error('Failed to save draft.', error);
                }
              })();
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
              if (!validateBeforeUpload()) return;
              setShowUploadConfirm(true);
            }}
            disabled={
              uploadComplete
                ? false
                : !canSave || !videoFile || uploading || cancelServerFailed || isSaving
            }
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {uploadComplete
              ? 'Close'
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
