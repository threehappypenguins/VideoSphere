'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { YouTubePlaylistCombobox } from '@/components/drafts/YouTubePlaylistCombobox';
import { SearchableSelect } from '@/components/drafts/SearchableSelect';
import { LivestreamPlatformToggles } from '@/components/livestreams/LivestreamPlatformToggles';
import { YouTubeTimezoneSelect } from '@/components/drafts/YouTubeTimezoneSelect';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RequiredFieldMarker } from '@/components/ui/required-field-marker';
import { Textarea } from '@/components/ui/textarea';
import {
  DRAFT_THUMBNAIL_DISALLOWED_TYPE_MESSAGE,
  draftThumbnailFileInputAccept,
  draftThumbnailMaxSizeExceededMessage,
  isAllowedDraftThumbnailContentType,
  MAX_DRAFT_THUMBNAIL_BYTES,
} from '@/lib/draft-thumbnail';
import { MAX_DRAFT_TITLE_LENGTH } from '@/lib/youtube-metadata-limits';
import {
  getSchedulableLivestreamPlatforms,
  getYouTubeLivestreamConnection,
  type LivestreamConnectionSnapshot,
  toLivestreamConnectionSnapshots,
} from '@/lib/livestreams/schedulable-platforms';
import { DRAFT_VISIBILITY_OPTIONS } from '@/lib/platforms/vimeo-membership';
import {
  formatTooShortYouTubeTagMessage,
  mergeUniqueTags,
  parseSharedTagInput,
  partitionYouTubeCompatibleTags,
} from '@/lib/platforms/sermon-audio-tags';
import {
  buildYouTubeAccountDefaultsSeedPatch,
  resolveYouTubeOptionalFieldValue,
  type YouTubeAccountDefaults,
} from '@/lib/platforms/youtube-account-defaults';
import { cn } from '@/lib/utils';
import {
  getDefaultScheduleDate,
  getLocalTimeZone,
  getSupportedTimeZones,
  isPublishAtInPast,
  utcIsoToZonedScheduleParts,
  YOUTUBE_SCHEDULE_TIME_OPTIONS,
  zonedDateTimeToUtcIso,
} from '@/lib/youtube-schedule';
import type {
  ApiResponse,
  ConnectedAccountPlatform,
  ConnectedAccountPublic,
  Livestream,
  LivestreamPlatforms,
  LivestreamStatus,
  PlatformUploadVisibility,
  YouTubeLivestreamFields,
} from '@/types';

const DRAFT_THUMBNAIL_INPUT_ACCEPT = draftThumbnailFileInputAccept();

const YOUTUBE_LICENSE_OPTIONS = [
  { value: 'youtube', label: 'Standard YouTube License' },
  { value: 'creativeCommon', label: 'Creative Commons — Attribution' },
] as const;

interface YouTubeMetadataLoadedState {
  languages: boolean;
  categories: boolean;
  accountDefaults: boolean;
}

const EMPTY_YOUTUBE_METADATA_LOADED: YouTubeMetadataLoadedState = {
  languages: false,
  categories: false,
  accountDefaults: false,
};

const STREAM_KEY_ERROR_PATTERN = /stream key|connections page/i;

function isStreamKeyScheduleError(message: string): boolean {
  return STREAM_KEY_ERROR_PATTERN.test(message);
}

/**
 * Renders an inline schedule failure message, optionally linking to Connections for key errors.
 * @param props - Error message from the schedule API.
 * @returns Inline alert copy for the modal footer.
 */
function LivestreamScheduleInlineError({ message }: { message: string }) {
  return (
    <p className="text-sm text-destructive" role="alert">
      {message}
      {isStreamKeyScheduleError(message) ? (
        <>
          {' '}
          <Link href="/profile/connections" className="font-medium underline underline-offset-2">
            Go to Connections
          </Link>
        </>
      ) : null}
    </p>
  );
}

function isYouTubeMetadataFullyLoaded(state: YouTubeMetadataLoadedState): boolean {
  return state.languages && state.categories && state.accountDefaults;
}

const LIVESTREAM_SCHEDULE_FIELD_ORDER = [
  'title',
  'scheduleTime',
  'scheduleDate',
  'scheduledStartTime',
  'targets',
] as const;

/**
 * Maps livestream validation field keys to focusable element ids in the modal.
 * @param field - Validation field key from {@link LivestreamMetadataModal} schedule checks.
 * @returns DOM id for scroll/focus, or null when unknown.
 */
function livestreamFieldFocusId(field: string): string | null {
  if (field === 'title') return 'livestream-title';
  if (field === 'scheduleTime') return 'livestream-schedule-time';
  if (field === 'scheduleDate') return 'livestream-schedule-date';
  if (field === 'scheduledStartTime') return 'livestream-schedule-date';
  if (field === 'targets') return 'livestream-platforms';
  return null;
}

/**
 * Editor state for the livestream metadata modal.
 */
export interface LivestreamEditorValues {
  /** Livestream row id (empty only before the first POST save). */
  id: string;
  /** Current lifecycle status from the server. */
  status: LivestreamStatus;
  /** Shared broadcast title. */
  title: string;
  /** Shared broadcast description. */
  description: string;
  /** Shared tag list. */
  tags: string[];
  /** Shared visibility for the YouTube broadcast. */
  visibility: PlatformUploadVisibility;
  /** Selected distribution platforms. */
  targets: ConnectedAccountPlatform[];
  /** Per-platform-only metadata (YouTube fields added in later prompts). */
  platforms: LivestreamPlatforms;
  /** Intended UTC start time pre-filled before scheduling on YouTube. */
  scheduledStartTime?: string;
  /** IANA timezone for the scheduled start picker wall clock. */
  scheduledStartTimeZone?: string;
  /** R2 key for the shared thumbnail image. */
  thumbnailR2Key?: string;
  /** MIME type of the shared thumbnail. */
  thumbnailContentType?: string;
  /** Ephemeral presigned preview URL for the shared thumbnail. */
  thumbnailPreviewUrl?: string;
}

/**
 * Props for {@link LivestreamMetadataModal}.
 */
export interface LivestreamMetadataModalProps {
  /** Create vs edit label copy; save uses POST when `id` is empty. */
  mode: 'create' | 'edit';
  /** Current editor values, or `null` when closed. */
  value: LivestreamEditorValues | null;
  /** Connection snapshots from the list page (seed until refreshed). */
  initialConnectionSnapshots: LivestreamConnectionSnapshot[];
  /** True once the connections request on the list page has settled. */
  initialConnectionsResolved: boolean;
  /** True while a save request is in flight. */
  isSaving: boolean;
  /** Called after a livestream is successfully scheduled on YouTube. */
  onScheduled?: () => void | Promise<void>;
  /** Called when the user dismisses the modal. */
  onClose: () => void;
  /**
   * Persists editor values via POST or PATCH.
   * @param options - Optional save behavior.
   * @returns Whether save succeeded and an optional toast message.
   */
  onSave: (options?: {
    closeAfterSave?: boolean;
    suppressErrorToast?: boolean;
    /** Snapshot to persist; defaults to the current editor state when omitted. */
    values?: LivestreamEditorValues;
  }) => Promise<{ saved: boolean; livestreamId?: string; message?: string }>;
  /** Called whenever a field changes in the modal. */
  onChange: (value: LivestreamEditorValues) => void;
}

/**
 * Renders the livestream metadata editor modal (base fields slice).
 * @param props - Component props.
 * @returns The livestream editor dialog, or nothing when closed.
 */
export function LivestreamMetadataModal({
  mode,
  value,
  initialConnectionSnapshots,
  initialConnectionsResolved,
  isSaving,
  onScheduled,
  onClose,
  onSave,
  onChange,
}: LivestreamMetadataModalProps) {
  const router = useRouter();
  const livestreamId = value?.id ?? null;
  const isDraft = value?.status === 'draft';
  const isEditable = value?.status === 'draft' || value?.status === 'scheduled';
  const youtubeTargetActive = value?.targets.includes('youtube') ?? false;
  const youtubeFields = value?.platforms.youtube;

  const [connectionSnapshots, setConnectionSnapshots] = useState<LivestreamConnectionSnapshot[]>(
    initialConnectionSnapshots ?? []
  );
  const [hasLoadedConnections, setHasLoadedConnections] = useState(
    Boolean(initialConnectionsResolved)
  );
  const [tagInput, setTagInput] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set());
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(() =>
    getDefaultScheduleDate(getLocalTimeZone())
  );
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduleTimeZone, setScheduleTimeZone] = useState('');
  const [showMoreExpanded, setShowMoreExpanded] = useState(false);
  const [youtubeLanguages, setYoutubeLanguages] = useState<Array<{ id: string; name: string }>>([]);
  const [youtubeCategories, setYoutubeCategories] = useState<Array<{ id: string; title: string }>>(
    []
  );
  const [youtubeAccountDefaults, setYoutubeAccountDefaults] = useState<
    YouTubeAccountDefaults | undefined
  >(undefined);
  const youtubeMetadataLoadedRef = useRef<YouTubeMetadataLoadedState>({
    ...EMPTY_YOUTUBE_METADATA_LOADED,
  });
  const youtubeMetadataRequestIdRef = useRef(0);
  const youtubeDefaultsSeededRef = useRef<string | null>(null);
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [thumbnailUploadProgress, setThumbnailUploadProgress] = useState(0);
  const [thumbnailFileName, setThumbnailFileName] = useState<string | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);
  const thumbnailRequestAbortRef = useRef<AbortController | null>(null);
  const thumbnailXhrRef = useRef<XMLHttpRequest | null>(null);
  const latestValueRef = useRef(value);
  const latestLivestreamIdRef = useRef(livestreamId);
  const isMountedRef = useRef(true);

  const supportedTimeZones = useMemo(() => getSupportedTimeZones(), []);

  const schedulablePlatforms = useMemo(
    () => getSchedulableLivestreamPlatforms(connectionSnapshots),
    [connectionSnapshots]
  );
  const youtubeConnection = useMemo(
    () => getYouTubeLivestreamConnection(connectionSnapshots),
    [connectionSnapshots]
  );
  const connectionsResolvedSuccessfully = hasLoadedConnections;
  const displayPlatforms = useMemo(() => schedulablePlatforms, [schedulablePlatforms]);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    latestLivestreamIdRef.current = livestreamId;
  }, [livestreamId]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setConnectionSnapshots(initialConnectionSnapshots ?? []);
    setHasLoadedConnections(Boolean(initialConnectionsResolved));
  }, [initialConnectionSnapshots, initialConnectionsResolved]);

  useEffect(() => {
    if (!value || hasLoadedConnections) return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/platforms/connections', { cache: 'no-store' });
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as ApiResponse<ConnectedAccountPublic[]>;
        if (cancelled) return;
        setConnectionSnapshots(
          toLivestreamConnectionSnapshots(Array.isArray(payload.data) ? payload.data : [])
        );
      } catch {
        if (!cancelled) {
          setConnectionSnapshots([]);
        }
      } finally {
        if (!cancelled) {
          setHasLoadedConnections(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasLoadedConnections, value]);

  useEffect(() => {
    if (!value || !connectionsResolvedSuccessfully) return;
    if (value.targets.length > 0 || schedulablePlatforms.length === 0) return;

    onChange({
      ...value,
      targets: [...schedulablePlatforms],
    });
  }, [connectionsResolvedSuccessfully, onChange, schedulablePlatforms, value]);

  useEffect(() => {
    if (!value || !connectionsResolvedSuccessfully) return;

    const schedulableSet = new Set(schedulablePlatforms);
    const nextTargets = value.targets.filter((platform) => schedulableSet.has(platform));
    if (nextTargets.length === value.targets.length) return;

    onChange({
      ...value,
      targets: nextTargets,
    });
  }, [connectionsResolvedSuccessfully, onChange, schedulablePlatforms, value]);

  useEffect(() => {
    setTagInput('');
    setFieldErrors(new Set());
    setThumbnailFileName(null);
    setShowMoreExpanded(false);
    setScheduleError(null);
    setIsScheduling(false);
  }, [livestreamId]);

  useEffect(() => {
    const scheduledStartTime = value?.scheduledStartTime;
    const scheduledStartTimeZone = value?.scheduledStartTimeZone;

    if (scheduledStartTime) {
      const tz = scheduledStartTimeZone || getLocalTimeZone();
      const parts = utcIsoToZonedScheduleParts(scheduledStartTime, tz);
      if (parts) {
        setScheduleDate(parts.dateStr);
        setScheduleTime(parts.timeStr);
        setScheduleTimeZone(tz);
      }
    } else {
      const tz = getLocalTimeZone();
      setScheduleDate(getDefaultScheduleDate(tz));
      setScheduleTime('');
      setScheduleTimeZone(tz);
    }
  }, [livestreamId, value?.scheduledStartTime, value?.scheduledStartTimeZone]);

  useEffect(() => {
    if (!livestreamId) {
      setYoutubeLanguages([]);
      setYoutubeCategories([]);
      setYoutubeAccountDefaults(undefined);
      youtubeMetadataLoadedRef.current = { ...EMPTY_YOUTUBE_METADATA_LOADED };
      youtubeDefaultsSeededRef.current = null;
      return;
    }

    youtubeDefaultsSeededRef.current = null;
    youtubeMetadataLoadedRef.current = { ...EMPTY_YOUTUBE_METADATA_LOADED };
    setYoutubeAccountDefaults(undefined);
  }, [livestreamId]);

  useEffect(() => {
    if (!youtubeTargetActive) {
      youtubeDefaultsSeededRef.current = null;
    }
  }, [youtubeTargetActive]);

  useEffect(() => {
    if (!youtubeTargetActive || !livestreamId) {
      return;
    }
    if (isYouTubeMetadataFullyLoaded(youtubeMetadataLoadedRef.current)) {
      return;
    }

    const requestId = ++youtubeMetadataRequestIdRef.current;
    const loadedAtStart = youtubeMetadataLoadedRef.current;

    const loadYouTubeMetadataOptions = async () => {
      try {
        const [languagesResponse, categoriesResponse, accountDefaultsResponse] = await Promise.all([
          loadedAtStart.languages
            ? Promise.resolve(null)
            : fetch('/api/platforms/youtube/languages', { cache: 'no-store' }),
          loadedAtStart.categories
            ? Promise.resolve(null)
            : fetch('/api/platforms/youtube/categories', { cache: 'no-store' }),
          loadedAtStart.accountDefaults
            ? Promise.resolve(null)
            : fetch('/api/platforms/youtube/account-defaults', { cache: 'no-store' }),
        ]);

        if (requestId !== youtubeMetadataRequestIdRef.current) {
          return;
        }

        if (languagesResponse?.ok) {
          const payload = (await languagesResponse.json()) as ApiResponse<
            Array<{ id: string; name: string }>
          >;
          if (Array.isArray(payload.data)) {
            setYoutubeLanguages(payload.data);
          }
          youtubeMetadataLoadedRef.current.languages = true;
        }

        if (categoriesResponse?.ok) {
          const payload = (await categoriesResponse.json()) as ApiResponse<
            Array<{ id: string; title: string }>
          >;
          if (Array.isArray(payload.data)) {
            setYoutubeCategories(payload.data);
          }
          youtubeMetadataLoadedRef.current.categories = true;
        }

        if (accountDefaultsResponse?.ok) {
          const payload =
            (await accountDefaultsResponse.json()) as ApiResponse<YouTubeAccountDefaults>;
          if (payload.data) {
            setYoutubeAccountDefaults(payload.data);
          }
          youtubeMetadataLoadedRef.current.accountDefaults = true;
        }
      } catch {
        // Language/category/account-default lists are optional for editing.
      }
    };

    void loadYouTubeMetadataOptions();

    return () => {
      youtubeMetadataRequestIdRef.current += 1;
    };
  }, [livestreamId, youtubeTargetActive]);

  const updateYouTubeFields = useCallback(
    (patch: Partial<YouTubeLivestreamFields>) => {
      if (!value) return;
      const current: Record<string, unknown> = { ...(value.platforms.youtube ?? {}) };
      for (const [key, fieldValue] of Object.entries(patch)) {
        if (fieldValue === undefined) {
          delete current[key];
        } else {
          current[key] = fieldValue;
        }
      }
      const next: LivestreamEditorValues = {
        ...value,
        platforms: {
          ...value.platforms,
          youtube:
            Object.keys(current).length > 0 ? (current as YouTubeLivestreamFields) : undefined,
        },
      };
      onChange(next);
    },
    [onChange, value]
  );

  useEffect(() => {
    if (!value?.targets.includes('youtube') || !youtubeAccountDefaults) {
      return;
    }

    const seedKey = `${livestreamId}:${JSON.stringify(youtubeAccountDefaults)}`;
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
  }, [livestreamId, updateYouTubeFields, value, youtubeAccountDefaults]);

  const youtubeMadeForKidsValue = youtubeFields?.madeForKids ?? youtubeAccountDefaults?.madeForKids;
  const youtubeDefaultAudioLanguageValue = resolveYouTubeOptionalFieldValue(
    youtubeFields,
    'defaultAudioLanguage',
    youtubeAccountDefaults?.defaultAudioLanguage
  );
  const youtubeLicenseValue = youtubeFields?.license ?? youtubeAccountDefaults?.license;
  const youtubeEmbeddableValue = youtubeFields?.embeddable ?? youtubeAccountDefaults?.embeddable;
  const youtubeCategoryIdValue = youtubeFields?.categoryId ?? youtubeAccountDefaults?.categoryId;
  const youtubePlaylistId = youtubeFields?.playlistIds?.[0];
  const youtubePlaylistTitle = youtubeFields?.playlistTitles?.[0];
  const youtubeLanguageOptions = useMemo(
    () => youtubeLanguages.map((language) => ({ value: language.id, label: language.name })),
    [youtubeLanguages]
  );
  const youtubeCategoryOptions = useMemo(
    () => youtubeCategories.map((category) => ({ value: category.id, label: category.title })),
    [youtubeCategories]
  );

  const effectiveScheduleTimeZone = scheduleTimeZone || getLocalTimeZone();

  const resolvePersistableTags = useCallback((): string[] => {
    const current = latestValueRef.current ?? value;
    if (!current) return [];
    const parsed = parseSharedTagInput(tagInput);
    const { accepted } = partitionYouTubeCompatibleTags(parsed);
    return accepted.length > 0 ? mergeUniqueTags(current.tags, accepted) : [...current.tags];
  }, [tagInput, value]);

  const buildPersistableValue = useCallback(
    (tagsOverride?: string[]): LivestreamEditorValues | null => {
      if (!value) return null;

      const tags = tagsOverride ?? resolvePersistableTags();
      let next: LivestreamEditorValues = { ...value, tags };

      if (scheduleDate && scheduleTime) {
        try {
          const iso = zonedDateTimeToUtcIso(scheduleDate, scheduleTime, effectiveScheduleTimeZone);
          next = {
            ...next,
            scheduledStartTime: iso,
            scheduledStartTimeZone: effectiveScheduleTimeZone,
          };
        } catch {
          // Keep the last stored value when the wall-clock trio is invalid.
        }
      } else {
        next = { ...next, scheduledStartTime: undefined, scheduledStartTimeZone: undefined };
      }

      if (next.targets.length === 0 && schedulablePlatforms.length > 0) {
        next = { ...next, targets: [...schedulablePlatforms] };
      }

      if (youtubeAccountDefaults && next.targets.includes('youtube')) {
        const seedPatch = buildYouTubeAccountDefaultsSeedPatch(
          next.platforms.youtube,
          youtubeAccountDefaults
        );
        if (Object.keys(seedPatch).length > 0) {
          next = {
            ...next,
            platforms: {
              ...next.platforms,
              youtube: { ...next.platforms.youtube, ...seedPatch },
            },
          };
        }
      }

      return next;
    },
    [
      effectiveScheduleTimeZone,
      resolvePersistableTags,
      scheduleDate,
      scheduleTime,
      schedulablePlatforms,
      value,
      youtubeAccountDefaults,
    ]
  );

  const fieldBorderClass = useCallback(
    (field: string) =>
      cn(
        'mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground',
        fieldErrors.has(field)
          ? 'border-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:border-red-500'
          : 'border-border'
      ),
    [fieldErrors]
  );

  const clearFieldError = useCallback((field: string) => {
    setFieldErrors((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
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

  const resetThumbnailUploadUi = useCallback(() => {
    if (!isMountedRef.current) return;
    setThumbnailUploading(false);
    setThumbnailUploadProgress(0);
  }, []);

  useEffect(() => {
    return () => {
      abortThumbnailUploadFlow();
    };
  }, [abortThumbnailUploadFlow]);

  const handleTogglePlatform = (platform: ConnectedAccountPlatform) => {
    if (!value) return;
    const isSelected = value.targets.includes(platform);
    const nextTargets = isSelected
      ? value.targets.filter((entry) => entry !== platform)
      : [...value.targets, platform];
    clearFieldError('targets');
    onChange({ ...value, targets: nextTargets });
  };

  const commitTagsFromInput = useCallback(() => {
    const current = latestValueRef.current ?? value;
    if (!current) return;
    const parsed = parseSharedTagInput(tagInput);
    if (parsed.length === 0) return;

    const { accepted, tooShort } = partitionYouTubeCompatibleTags(parsed);
    if (tooShort.length > 0) {
      toast.error(formatTooShortYouTubeTagMessage(tooShort));
    }
    if (accepted.length > 0) {
      onChange({ ...current, tags: mergeUniqueTags(current.tags, accepted) });
    }
    setTagInput('');
  }, [onChange, tagInput, value]);

  const commitTagsBeforeSave = useCallback((): string[] => {
    const merged = resolvePersistableTags();
    const current = latestValueRef.current ?? value;
    if (!current) return merged;

    const parsed = parseSharedTagInput(tagInput);
    if (parsed.length > 0) {
      const { tooShort } = partitionYouTubeCompatibleTags(parsed);
      if (tooShort.length > 0) {
        toast.error(formatTooShortYouTubeTagMessage(tooShort));
      }
      flushSync(() => {
        onChange({ ...current, tags: merged });
        setTagInput('');
      });
    }
    return merged;
  }, [onChange, resolvePersistableTags, tagInput, value]);

  const validateBeforeSave = useCallback((): { ok: true; tags: string[] } | { ok: false } => {
    if (!value) return { ok: false };
    const tags = commitTagsBeforeSave();
    const errors = new Set<string>();
    if (value.title.trim() === '') {
      errors.add('title');
    }
    if (errors.size > 0) {
      setFieldErrors(errors);
      toast.error('Title is required.');
      const focusId = livestreamFieldFocusId('title');
      if (focusId) {
        requestAnimationFrame(() => {
          document.getElementById(focusId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          document.getElementById(focusId)?.focus();
        });
      }
      return { ok: false };
    }
    setFieldErrors(new Set());
    return { ok: true, tags };
  }, [commitTagsBeforeSave, value]);

  const clearSchedule = () => {
    clearFieldError('scheduleTime');
    clearFieldError('scheduleDate');
    clearFieldError('scheduledStartTime');
    const tz = getLocalTimeZone();
    setScheduleDate(getDefaultScheduleDate(tz));
    setScheduleTime('');
    setScheduleTimeZone(tz);
  };

  const resolvedScheduledStartTimeIso = useMemo((): string | null => {
    if (scheduleDate && scheduleTime) {
      try {
        return zonedDateTimeToUtcIso(scheduleDate, scheduleTime, effectiveScheduleTimeZone);
      } catch {
        return null;
      }
    }
    return null;
  }, [effectiveScheduleTimeZone, scheduleDate, scheduleTime]);

  const schedulePastWarning =
    resolvedScheduledStartTimeIso !== null && isPublishAtInPast(resolvedScheduledStartTimeIso);

  const validateBeforeSchedule = useCallback((): { ok: true; tags: string[] } | { ok: false } => {
    if (!value) return { ok: false };
    const tags = commitTagsBeforeSave();
    const errors = new Set<string>();

    if (value.title.trim() === '') {
      errors.add('title');
    }

    if (!scheduleTime.trim()) {
      errors.add('scheduleTime');
    } else if (!scheduleDate.trim()) {
      errors.add('scheduleDate');
    } else if (!resolvedScheduledStartTimeIso) {
      errors.add('scheduledStartTime');
    }

    const hasYouTubeTarget =
      value.targets.includes('youtube') ||
      (value.targets.length === 0 && schedulablePlatforms.includes('youtube'));
    if (schedulablePlatforms.includes('youtube') && !hasYouTubeTarget) {
      errors.add('targets');
    }

    if (errors.size > 0) {
      setFieldErrors(errors);
      if (errors.has('title') && errors.size === 1) {
        toast.error('Title is required.');
      } else if (errors.has('scheduleTime') && errors.size === 1) {
        toast.error('Choose a scheduled start time before scheduling.');
      } else if (errors.has('scheduleDate') && errors.size === 1) {
        toast.error('Choose a scheduled start date before scheduling.');
      } else if (errors.has('scheduledStartTime') && errors.size === 1) {
        toast.error('Choose a valid scheduled start date and time.');
      } else if (errors.has('targets') && errors.size === 1) {
        toast.error('Select YouTube before scheduling.');
      } else {
        toast.error('Fill in required fields before scheduling.');
      }

      const firstField = LIVESTREAM_SCHEDULE_FIELD_ORDER.find((field) => errors.has(field));
      if (firstField) {
        const focusId = livestreamFieldFocusId(firstField);
        if (focusId) {
          requestAnimationFrame(() => {
            document
              .getElementById(focusId)
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            document.getElementById(focusId)?.focus();
          });
        }
      }
      return { ok: false };
    }

    setFieldErrors(new Set());
    return { ok: true, tags };
  }, [
    commitTagsBeforeSave,
    resolvedScheduledStartTimeIso,
    scheduleDate,
    scheduleTime,
    schedulablePlatforms,
    value,
  ]);

  const handleThumbnailFile = async (file: File) => {
    if (!value || !livestreamId || !isEditable) return;
    const requestLivestreamId = livestreamId;
    const ac = new AbortController();
    abortThumbnailUploadFlow();
    thumbnailRequestAbortRef.current = ac;
    const isCancelled = () =>
      ac.signal.aborted || latestLivestreamIdRef.current !== requestLivestreamId;
    const canUpdateThumbnailUi = () => isMountedRef.current && !isCancelled();

    const rejectThumbnailSelection = (message: string) => {
      toast.error(message);
      thumbnailRequestAbortRef.current = null;
      if (thumbnailInputRef.current) {
        thumbnailInputRef.current.value = '';
      }
      setThumbnailFileName(null);
    };

    if (file.size > MAX_DRAFT_THUMBNAIL_BYTES) {
      rejectThumbnailSelection(draftThumbnailMaxSizeExceededMessage());
      return;
    }
    if (!isAllowedDraftThumbnailContentType(file.type)) {
      rejectThumbnailSelection(DRAFT_THUMBNAIL_DISALLOWED_TYPE_MESSAGE);
      return;
    }

    setThumbnailFileName(file.name);
    setThumbnailUploading(true);
    setThumbnailUploadProgress(0);

    try {
      const presignRes = await fetch(`/api/livestreams/${livestreamId}/thumbnail/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type, fileSize: file.size }),
        signal: ac.signal,
      });
      if (isCancelled()) return;
      if (!presignRes.ok) {
        const err = (await presignRes.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? 'Failed to start thumbnail upload');
      }
      const { uploadUrl, pendingKey } = (await presignRes.json()) as {
        uploadUrl: string;
        pendingKey: string;
      };
      if (typeof uploadUrl !== 'string' || uploadUrl.trim() === '') {
        throw new Error('Invalid presign response: missing upload URL');
      }
      if (typeof pendingKey !== 'string' || pendingKey.trim() === '') {
        throw new Error('Invalid presign response: missing pending key');
      }

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        thumbnailXhrRef.current = xhr;
        let settled = false;
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          callback();
        };
        const timeoutId = window.setTimeout(() => {
          finish(() => reject(new Error('Thumbnail upload timed out')));
          xhr.abort();
        }, 60_000);
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.upload.addEventListener('loadstart', () => {
          if (canUpdateThumbnailUi()) {
            setThumbnailUploadProgress((prev) => (prev === 0 ? 1 : prev));
          }
        });
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable && event.total > 0) {
            const pct = Math.round((event.loaded / event.total) * 100);
            if (canUpdateThumbnailUi()) {
              setThumbnailUploadProgress(pct);
            }
          } else if (event.loaded > 0 && canUpdateThumbnailUi()) {
            setThumbnailUploadProgress((prev) => (prev === 0 ? 1 : prev));
          }
        });
        xhr.addEventListener('load', () => {
          thumbnailXhrRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) {
            finish(() => {
              if (canUpdateThumbnailUi()) setThumbnailUploadProgress(100);
              resolve();
            });
          } else {
            finish(() =>
              reject(new Error(`Failed to upload thumbnail to storage (${xhr.status})`))
            );
          }
        });
        xhr.addEventListener('error', () => {
          thumbnailXhrRef.current = null;
          finish(() => reject(new Error('Failed to upload thumbnail to storage')));
        });
        xhr.addEventListener('abort', () => {
          thumbnailXhrRef.current = null;
          finish(() => reject(new Error('THUMBNAIL_UPLOAD_ABORTED')));
        });
        xhr.send(file);
      });

      const completeRes = await fetch(`/api/livestreams/${livestreamId}/thumbnail/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingKey }),
        signal: ac.signal,
      });
      if (isCancelled()) return;
      if (!completeRes.ok) {
        const err = (await completeRes.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? 'Failed to finalize thumbnail');
      }
      const payload = (await completeRes.json()) as ApiResponse<
        Livestream & { thumbnailPreviewUrl?: string }
      >;
      const latest = latestValueRef.current ?? value;
      if (!latest || isCancelled()) return;
      const updated = payload.data;
      onChange({
        ...latest,
        thumbnailR2Key: updated?.thumbnailR2Key,
        thumbnailContentType: updated?.thumbnailContentType,
        thumbnailPreviewUrl: updated?.thumbnailPreviewUrl ?? latest.thumbnailPreviewUrl,
      });
      toast.success('Thumbnail uploaded');
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'THUMBNAIL_UPLOAD_ABORTED' || error.name === 'AbortError')
      ) {
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Thumbnail upload failed');
    } finally {
      const supersededByNewUpload =
        thumbnailRequestAbortRef.current !== ac && thumbnailRequestAbortRef.current !== null;
      if (thumbnailRequestAbortRef.current === ac) {
        thumbnailRequestAbortRef.current = null;
      }
      thumbnailXhrRef.current = null;
      if (!supersededByNewUpload) {
        resetThumbnailUploadUi();
      }
    }
  };

  const handleRemoveThumbnail = async () => {
    if (!value || !livestreamId || !isEditable) return;
    setThumbnailUploading(true);
    try {
      const response = await fetch(`/api/livestreams/${livestreamId}/thumbnail`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => null)) as { message?: string } | null;
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
      setThumbnailFileName(null);
      if (thumbnailInputRef.current) {
        thumbnailInputRef.current.value = '';
      }
      toast.success('Thumbnail removed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove thumbnail');
    } finally {
      resetThumbnailUploadUi();
    }
  };

  const handleScheduleLivestream = useCallback(async () => {
    if (!value || !isDraft) return;

    setScheduleError(null);
    const validation = validateBeforeSchedule();
    if (!validation.ok) {
      return;
    }

    const persistable = buildPersistableValue(validation.tags);
    if (!persistable) return;

    const scheduledStartTime = persistable.scheduledStartTime ?? null;
    if (!scheduledStartTime) {
      return;
    }

    if (schedulablePlatforms.length === 0) {
      setScheduleError(
        youtubeConnection
          ? 'Add a YouTube stream key on the Connections page before scheduling.'
          : 'Connect YouTube on the Connections page before scheduling.'
      );
      return;
    }

    setIsScheduling(true);

    try {
      const saveResult = await onSave({
        closeAfterSave: false,
        suppressErrorToast: true,
        values: persistable,
      });
      if (!saveResult.saved) {
        setScheduleError('Save your changes before scheduling on YouTube.');
        return;
      }

      const targetId = saveResult.livestreamId ?? value.id;
      if (!targetId) {
        setScheduleError('Save your changes before scheduling on YouTube.');
        return;
      }

      const response = await fetch(`/api/livestreams/${targetId}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledStartTime }),
      });

      if (!response.ok) {
        const err = (await response.json().catch(() => null)) as { message?: string } | null;
        setScheduleError(err?.message ?? 'Failed to schedule livestream on YouTube.');
        return;
      }

      const payload = (await response.json()) as ApiResponse<Livestream>;
      if (payload.message?.includes('YouTube did not keep these tags')) {
        toast.warning(payload.message);
      } else {
        toast.success('Livestream scheduled on YouTube');
      }
      await onScheduled?.();
      onClose();
    } catch (error) {
      console.error('Failed to schedule livestream.', error);
      setScheduleError(
        error instanceof Error ? error.message : 'Failed to schedule livestream on YouTube.'
      );
    } finally {
      setIsScheduling(false);
    }
  }, [
    buildPersistableValue,
    isDraft,
    onClose,
    onSave,
    onScheduled,
    schedulablePlatforms,
    validateBeforeSchedule,
    value,
    youtubeConnection,
  ]);

  const handleConnectNavigation = useCallback(async () => {
    if (!value || thumbnailUploading || isScheduling) return;

    const isCreateLivestreamEmptyForConnect =
      mode === 'create' &&
      value.title.trim() === '' &&
      value.description.trim() === '' &&
      value.tags.length === 0 &&
      tagInput.trim() === '' &&
      !(value.thumbnailR2Key || value.thumbnailPreviewUrl) &&
      !value.scheduledStartTime;

    commitTagsBeforeSave();

    if (isCreateLivestreamEmptyForConnect) {
      onClose();
      router.push('/profile/connections');
      return;
    }

    const persistable = buildPersistableValue();
    if (!persistable) return;

    const result = await onSave({ closeAfterSave: false, values: persistable });
    if (result.saved) {
      router.push('/profile/connections');
    }
  }, [
    buildPersistableValue,
    commitTagsBeforeSave,
    isScheduling,
    mode,
    onClose,
    onSave,
    router,
    tagInput,
    thumbnailUploading,
    value,
  ]);

  const handleConnectClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    void handleConnectNavigation();
  };

  const handleClose = () => {
    if (thumbnailUploading || isScheduling) return;
    abortThumbnailUploadFlow();
    onClose();
  };

  const canSave =
    Boolean(value) &&
    isEditable &&
    value.title.trim() !== '' &&
    !thumbnailUploading &&
    !isScheduling;

  const sharedThumbnailSelectionLabel =
    thumbnailFileName ??
    (value?.thumbnailR2Key || value?.thumbnailPreviewUrl ? 'Current thumbnail' : 'No file chosen');

  return (
    <Dialog
      open={value !== null}
      onOpenChange={(open) => {
        if (!open) {
          if (thumbnailUploading) return;
          abortThumbnailUploadFlow();
          handleClose();
        }
      }}
    >
      <DialogContent
        className="flex max-h-[90vh] w-full max-w-2xl flex-col p-0 sm:max-w-2xl"
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{mode === 'edit' ? 'Edit livestream' : 'Livestream details'}</DialogTitle>
          <DialogDescription>
            {isEditable
              ? 'Configure metadata and your intended start time before scheduling on YouTube.'
              : 'This livestream has already started or ended; fields are read-only.'}
          </DialogDescription>
        </DialogHeader>

        {value ? (
          <div className="flex-1 space-y-6 overflow-y-auto px-6 pb-4">
            {connectionsResolvedSuccessfully && schedulablePlatforms.length === 0 ? (
              <div
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900/60 dark:bg-red-950/30"
                role="status"
              >
                <p className="text-sm text-red-600 dark:text-red-400">
                  {youtubeConnection ? (
                    <>
                      Add a YouTube stream key on the{' '}
                      <Link href="/profile/connections" className="underline underline-offset-2">
                        Connections
                      </Link>{' '}
                      page before you can schedule a livestream.
                    </>
                  ) : (
                    <>
                      No connected platforms found.{' '}
                      <Link href="/profile/connections" className="underline underline-offset-2">
                        Go to Connections
                      </Link>{' '}
                      to connect YouTube and add stream keys.
                    </>
                  )}
                </p>
              </div>
            ) : null}
            <section id="livestream-platforms" tabIndex={-1} className="space-y-2 outline-none">
              <h3 className="text-sm font-semibold text-foreground">Platforms</h3>
              {displayPlatforms.length > 0 ? (
                <LivestreamPlatformToggles
                  availablePlatforms={displayPlatforms}
                  selectedPlatforms={value.targets}
                  connectedPlatforms={schedulablePlatforms}
                  connectionsResolved={connectionsResolvedSuccessfully}
                  onToggle={handleTogglePlatform}
                  onConnectClick={() => {
                    void handleConnectNavigation();
                  }}
                />
              ) : connectionsResolvedSuccessfully ? (
                <p className="text-xs text-muted-foreground">
                  Platforms appear here after YouTube is connected with a stream key.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Loading connected platforms…</p>
              )}
              {fieldErrors.has('targets') ? (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Select YouTube before scheduling.
                </p>
              ) : null}
              {schedulablePlatforms.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Don&apos;t see a specific platform?{' '}
                  <Link
                    href="/profile/connections"
                    className="underline underline-offset-2"
                    onClick={handleConnectClick}
                  >
                    Manage connections
                  </Link>
                </p>
              ) : null}
            </section>

            <section className="space-y-4 rounded-lg border border-border bg-background p-4">
              <div>
                <label htmlFor="livestream-title" className="text-sm font-medium text-foreground">
                  Title
                  <RequiredFieldMarker />
                </label>
                <input
                  id="livestream-title"
                  value={value.title}
                  required
                  disabled={!isEditable}
                  maxLength={MAX_DRAFT_TITLE_LENGTH}
                  onChange={(event) => {
                    clearFieldError('title');
                    onChange({ ...value, title: event.target.value });
                  }}
                  aria-invalid={fieldErrors.has('title')}
                  className={fieldBorderClass('title')}
                />
              </div>

              <div>
                <label
                  htmlFor="livestream-description"
                  className="text-sm font-medium text-foreground"
                >
                  Description
                </label>
                <Textarea
                  id="livestream-description"
                  value={value.description}
                  disabled={!isEditable}
                  rows={4}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                    onChange({ ...value, description: event.target.value });
                  }}
                  className={cn(fieldBorderClass('description'), 'mt-1 min-h-24')}
                />
              </div>

              <div>
                <label htmlFor="livestream-tags" className="text-sm font-medium text-foreground">
                  Tags
                </label>
                <div
                  className={cn(
                    'mt-1 rounded-md border bg-background px-2 py-2',
                    fieldErrors.has('tags') ? 'border-red-600 dark:border-red-500' : 'border-border'
                  )}
                >
                  <div className="mb-2 flex flex-wrap gap-2">
                    {value.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
                      >
                        {tag}
                        {isEditable ? (
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
                        ) : null}
                      </span>
                    ))}
                  </div>
                  <input
                    id="livestream-tags"
                    value={tagInput}
                    disabled={!isEditable}
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
                    className="block w-full border-0 bg-transparent px-1 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Press Enter or comma to add tags. Each tag must be at least 2 characters (YouTube
                  does not accept single-letter tags).
                </p>
              </div>

              <div>
                <label
                  htmlFor="livestream-visibility"
                  className="text-sm font-medium text-foreground"
                >
                  Visibility
                </label>
                <Select
                  value={value.visibility}
                  disabled={!isEditable}
                  onValueChange={(next) => {
                    onChange({ ...value, visibility: next as PlatformUploadVisibility });
                  }}
                >
                  <SelectTrigger
                    id="livestream-visibility"
                    aria-required
                    className={cn(
                      fieldBorderClass('visibility'),
                      'flex h-10 items-center justify-between text-left'
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DRAFT_VISIBILITY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </section>

            <fieldset
              disabled={!isEditable}
              className="space-y-3 rounded-lg border border-border bg-background p-4"
            >
              <div>
                <p className="text-sm font-medium text-foreground">
                  Scheduled start
                  <RequiredFieldMarker />
                </p>
                <p className="text-xs text-muted-foreground">
                  Pre-fill your intended broadcast start time. Date and time are in the selected
                  timezone. Scheduling on YouTube is a separate step.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor="livestream-schedule-date"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Date
                  </label>
                  <input
                    id="livestream-schedule-date"
                    type="date"
                    value={scheduleDate}
                    aria-invalid={
                      fieldErrors.has('scheduleDate') || fieldErrors.has('scheduledStartTime')
                    }
                    onChange={(event) => {
                      clearFieldError('scheduleDate');
                      clearFieldError('scheduledStartTime');
                      setScheduleDate(event.target.value);
                    }}
                    className={cn(
                      'mt-1 flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground',
                      fieldErrors.has('scheduleDate') || fieldErrors.has('scheduledStartTime')
                        ? 'border-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:border-red-500'
                        : 'border-border'
                    )}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor="livestream-schedule-time"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Time
                  </label>
                  <Select
                    value={scheduleTime}
                    onValueChange={(next) => {
                      clearFieldError('scheduleTime');
                      clearFieldError('scheduledStartTime');
                      setScheduleTime(next);
                    }}
                  >
                    <SelectTrigger
                      id="livestream-schedule-time"
                      aria-invalid={
                        fieldErrors.has('scheduleTime') || fieldErrors.has('scheduledStartTime')
                      }
                      className={cn(
                        'mt-1 flex h-10 items-center justify-between text-left rounded-md border bg-background',
                        fieldErrors.has('scheduleTime') || fieldErrors.has('scheduledStartTime')
                          ? 'border-red-600 focus-visible:ring-red-600 dark:border-red-500'
                          : 'border-border'
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
                    htmlFor="livestream-schedule-timezone"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Timezone
                  </label>
                  <YouTubeTimezoneSelect
                    id="livestream-schedule-timezone"
                    value={effectiveScheduleTimeZone}
                    options={supportedTimeZones}
                    onValueChange={(next) => {
                      clearFieldError('scheduledStartTime');
                      setScheduleTimeZone(next);
                    }}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3"
                  />
                </div>
              </div>
              {fieldErrors.has('scheduleTime') ? (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Choose a scheduled start time.
                </p>
              ) : fieldErrors.has('scheduleDate') ? (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Choose a scheduled start date.
                </p>
              ) : fieldErrors.has('scheduledStartTime') ? (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Choose a valid scheduled start date and time.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                {isEditable ? (
                  <button
                    type="button"
                    onClick={clearSchedule}
                    className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Clear schedule
                  </button>
                ) : null}
                {schedulePastWarning ? (
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    Scheduled time is in the past.
                  </p>
                ) : null}
              </div>
            </fieldset>

            {youtubeTargetActive ? (
              <section className="space-y-2 rounded-lg border border-border bg-background p-4">
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
                    <fieldset
                      disabled={!isEditable}
                      className="space-y-6 rounded-lg border border-border bg-muted/20 p-3"
                    >
                      <div>
                        <label
                          htmlFor="livestream-youtube-category"
                          className="text-sm font-medium text-foreground"
                        >
                          Category
                        </label>
                        <SearchableSelect
                          id="livestream-youtube-category"
                          value={youtubeCategoryIdValue}
                          placeholder="Select category"
                          options={youtubeCategoryOptions}
                          onValueChange={(next) =>
                            updateYouTubeFields({ categoryId: next ?? undefined })
                          }
                          className={fieldBorderClass('youtube.categoryId')}
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="livestream-youtube-playlist"
                          className="text-sm font-medium text-foreground"
                        >
                          Playlist
                        </label>
                        <YouTubePlaylistCombobox
                          id="livestream-youtube-playlist"
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

                      <fieldset className="space-y-2">
                        <legend className="text-sm font-medium text-foreground">Audience</legend>
                        <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
                          <input
                            type="radio"
                            name="livestream-youtube-made-for-kids"
                            className="mt-1"
                            checked={youtubeMadeForKidsValue === true}
                            onChange={() => updateYouTubeFields({ madeForKids: true })}
                          />
                          <span>Yes, it&apos;s made for kids.</span>
                        </label>
                        <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
                          <input
                            type="radio"
                            name="livestream-youtube-made-for-kids"
                            className="mt-1"
                            checked={youtubeMadeForKidsValue === false}
                            onChange={() => updateYouTubeFields({ madeForKids: false })}
                          />
                          <span>No, it&apos;s not made for kids.</span>
                        </label>
                      </fieldset>

                      <div className="space-y-3">
                        <p className="text-sm font-medium text-foreground">Stream language</p>
                        <SearchableSelect
                          id="livestream-youtube-stream-language"
                          value={youtubeDefaultAudioLanguageValue}
                          placeholder="Select stream language"
                          options={youtubeLanguageOptions}
                          onValueChange={(next) =>
                            updateYouTubeFields({
                              defaultAudioLanguage: next ?? null,
                            })
                          }
                          className={fieldBorderClass('youtube.defaultAudioLanguage')}
                        />
                      </div>

                      <div className="space-y-3">
                        <p className="text-sm font-medium text-foreground">License</p>
                        <Select
                          value={youtubeLicenseValue}
                          onValueChange={(next) =>
                            updateYouTubeFields({
                              license: next as YouTubeLivestreamFields['license'],
                            })
                          }
                        >
                          <SelectTrigger
                            id="livestream-youtube-license"
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
                            onChange={(event) =>
                              updateYouTubeFields({ embeddable: event.target.checked })
                            }
                          />
                          <span>Allow embedding</span>
                        </label>
                      </div>
                    </fieldset>
                  ) : null}
                </div>
              </section>
            ) : null}

            <section className="space-y-3 rounded-lg border border-border bg-background p-4">
              <div>
                <p className="text-sm font-medium text-foreground">Thumbnail</p>
                <p className="text-xs text-muted-foreground">
                  JPG or PNG, up to {MAX_DRAFT_THUMBNAIL_BYTES / (1024 * 1024)} MB.
                </p>
              </div>
              {value.thumbnailPreviewUrl ? (
                <div className="relative inline-block max-w-full">
                  <Image
                    src={value.thumbnailPreviewUrl}
                    alt="Livestream thumbnail preview"
                    width={800}
                    height={450}
                    unoptimized
                    className="max-h-40 max-w-full rounded-md border border-border object-contain"
                  />
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="livestream-thumbnail-file" className="sr-only">
                  Choose thumbnail image
                </label>
                <input
                  id="livestream-thumbnail-file"
                  ref={thumbnailInputRef}
                  type="file"
                  accept={DRAFT_THUMBNAIL_INPUT_ACCEPT}
                  className="hidden"
                  disabled={!isEditable || thumbnailUploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void handleThumbnailFile(file);
                    }
                  }}
                />
                {isEditable ? (
                  <>
                    <button
                      type="button"
                      disabled={thumbnailUploading}
                      onClick={() => thumbnailInputRef.current?.click()}
                      className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                    >
                      Choose file
                    </button>
                    <span className="max-w-full truncate text-xs text-muted-foreground">
                      {sharedThumbnailSelectionLabel}
                    </span>
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
                  </>
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
            </section>
          </div>
        ) : null}

        {scheduleError ? (
          <div className="px-6 pb-2">
            <LivestreamScheduleInlineError message={scheduleError} />
          </div>
        ) : null}

        <DialogFooter className="mt-3 border-t border-border bg-background px-6 pb-6 pt-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isScheduling}
            className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-60"
          >
            Cancel
          </button>
          {isEditable ? (
            <button
              type="button"
              onClick={() => {
                setScheduleError(null);
                const validation = validateBeforeSave();
                if (!validation.ok) return;
                const persistable = buildPersistableValue(validation.tags);
                if (!persistable) return;
                void (async () => {
                  try {
                    const result = await onSave({
                      closeAfterSave: true,
                      values: persistable,
                    });
                    if (result.message) toast.success(result.message);
                  } catch (error) {
                    console.error('Failed to save livestream.', error);
                  }
                })();
              }}
              disabled={!canSave || isSaving || isScheduling}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          ) : null}
          {isDraft ? (
            <button
              type="button"
              onClick={() => {
                void handleScheduleLivestream();
              }}
              disabled={thumbnailUploading || isSaving || isScheduling}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {isScheduling ? 'Scheduling…' : 'Schedule livestream'}
            </button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Maps a persisted livestream row to editor values.
 * @param livestream - Livestream from the API.
 * @returns Values for {@link LivestreamMetadataModal}.
 */
export function createLivestreamEditorValues(livestream: Livestream): LivestreamEditorValues {
  return {
    id: livestream.id,
    status: livestream.status,
    title: livestream.title,
    description: livestream.description,
    tags: [...livestream.tags],
    visibility: livestream.visibility,
    targets: [...livestream.targets],
    platforms: livestream.platforms ?? {},
    ...(livestream.scheduledStartTime ? { scheduledStartTime: livestream.scheduledStartTime } : {}),
    ...(livestream.scheduledStartTimeZone
      ? { scheduledStartTimeZone: livestream.scheduledStartTimeZone }
      : {}),
    ...(livestream.thumbnailR2Key ? { thumbnailR2Key: livestream.thumbnailR2Key } : {}),
    ...(livestream.thumbnailContentType
      ? { thumbnailContentType: livestream.thumbnailContentType }
      : {}),
    ...(livestream.thumbnailPreviewUrl
      ? { thumbnailPreviewUrl: livestream.thumbnailPreviewUrl }
      : {}),
  };
}
