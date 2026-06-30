import type {
  SermonAudioCrossPublishOptionId,
  SermonAudioCrossPublishPlatformSettings,
  SermonAudioCrossPublishSettings,
  SermonAudioCrossPublishTarget,
  SermonAudioCrossPublishYouTubePrivacy,
} from '@/types';

/** One Cross Publish toggle shown for a destination in the draft editor. */
export interface SermonAudioCrossPublishOptionDef {
  /** Storage key on `SermonAudioCrossPublishPlatformSettings`. */
  id: SermonAudioCrossPublishOptionId;
  /** User-facing label (matches SermonAudio dashboard wording). */
  label: string;
}

/** Cross Publish destination shown in the draft editor (SermonAudio dashboard feature). */
export interface SermonAudioCrossPublishDestinationConfig {
  /** Storage key under `platforms.sermon_audio.crossPublish`. */
  id: SermonAudioCrossPublishTarget;
  /** User-facing label. */
  label: string;
  /** Platform-specific Cross Publish toggles available in the SermonAudio dashboard. */
  options: readonly SermonAudioCrossPublishOptionDef[];
  /** When true, show the description field while post link is enabled. */
  supportsLinkMessage: boolean;
  /** When true, show title and description fields while full-video upload is enabled. */
  supportsVideoMetadata: boolean;
  /** When true, show YouTube visibility while full-video upload is enabled. */
  supportsPrivacy: boolean;
}

/** YouTube visibility choices in the SermonAudio Cross Publish UI. */
export const SERMON_AUDIO_CROSS_PUBLISH_YOUTUBE_PRIVACY_OPTIONS: readonly {
  value: SermonAudioCrossPublishYouTubePrivacy;
  label: string;
}[] = [
  { value: 'public', label: 'Public' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'private', label: 'Private' },
] as const;

/** Ordered Cross Publish destinations for the draft UI (matches SermonAudio dashboard). */
export const SERMON_AUDIO_CROSS_PUBLISH_DESTINATIONS: readonly SermonAudioCrossPublishDestinationConfig[] =
  [
    {
      id: 'youtube',
      label: 'YouTube',
      options: [{ id: 'uploadFullVideo', label: 'Upload full sermon video to YouTube' }],
      supportsLinkMessage: false,
      supportsVideoMetadata: true,
      supportsPrivacy: true,
    },
    {
      id: 'facebook',
      label: 'Facebook',
      options: [
        { id: 'postLink', label: 'Post link to sermon' },
        { id: 'uploadFullVideo', label: 'Upload full sermon video to Facebook' },
      ],
      supportsLinkMessage: true,
      supportsVideoMetadata: false,
      supportsPrivacy: false,
    },
    {
      id: 'x',
      label: 'X (Twitter)',
      options: [
        { id: 'postLink', label: 'Post link to sermon' },
        { id: 'uploadVideoPreview', label: 'Upload video preview to X (Twitter)' },
      ],
      supportsLinkMessage: true,
      supportsVideoMetadata: false,
      supportsPrivacy: false,
    },
  ] as const;

const YOUTUBE_PRIVACY_VALUES = new Set<SermonAudioCrossPublishYouTubePrivacy>([
  'public',
  'unlisted',
  'private',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function trimStr(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeYoutubePrivacy(
  value: unknown
): SermonAudioCrossPublishYouTubePrivacy | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return YOUTUBE_PRIVACY_VALUES.has(normalized as SermonAudioCrossPublishYouTubePrivacy)
    ? (normalized as SermonAudioCrossPublishYouTubePrivacy)
    : undefined;
}

/**
 * Normalizes Cross Publish settings for one destination platform.
 * Drops fields that are not offered for that platform in the SermonAudio dashboard.
 * @param destId - Cross Publish destination id.
 * @param value - Raw JSON value from draft storage.
 * @returns Normalized settings or `undefined` when empty.
 */
export function normalizeSermonAudioCrossPublishPlatformSettings(
  destId: SermonAudioCrossPublishTarget,
  value: unknown
): SermonAudioCrossPublishPlatformSettings | undefined {
  if (!isPlainObject(value)) return undefined;

  const dest = SERMON_AUDIO_CROSS_PUBLISH_DESTINATIONS.find((entry) => entry.id === destId);
  if (!dest) return undefined;

  const out: SermonAudioCrossPublishPlatformSettings = {};

  for (const option of dest.options) {
    const normalized = normalizeOptionalBoolean(value[option.id]);
    if (normalized !== undefined) {
      out[option.id] = normalized;
    }
  }

  if (dest.supportsLinkMessage && out.postLink === true) {
    const linkMessage = trimStr(value.linkMessage);
    if (linkMessage !== undefined) {
      out.linkMessage = linkMessage;
    }
  }

  if (dest.supportsVideoMetadata && out.uploadFullVideo === true) {
    const title = trimStr(value.title);
    const description = trimStr(value.description);
    if (title !== undefined) {
      out.title = title;
    }
    if (description !== undefined) {
      out.description = description;
    }
  }

  if (dest.supportsPrivacy && out.uploadFullVideo === true) {
    const privacy = normalizeYoutubePrivacy(value.privacy);
    if (privacy !== undefined) {
      out.privacy = privacy;
    }
  }

  // SermonAudio dashboard: link post must be enabled before video options on Facebook and X.
  if (destId === 'facebook' && out.postLink !== true) {
    delete out.uploadFullVideo;
  }
  if (destId === 'x' && out.postLink !== true) {
    delete out.uploadVideoPreview;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Normalizes SermonAudio Cross Publish settings stored on a draft.
 * @param value - Raw `crossPublish` object from draft JSON.
 * @returns Normalized Cross Publish settings or `undefined` when empty.
 */
export function normalizeSermonAudioCrossPublishSettings(
  value: unknown
): SermonAudioCrossPublishSettings | undefined {
  if (!isPlainObject(value)) return undefined;

  const enabled = normalizeOptionalBoolean(value.enabled);
  const out: SermonAudioCrossPublishSettings = {
    ...(enabled !== undefined ? { enabled } : {}),
  };

  for (const dest of SERMON_AUDIO_CROSS_PUBLISH_DESTINATIONS) {
    const normalized = normalizeSermonAudioCrossPublishPlatformSettings(dest.id, value[dest.id]);
    if (normalized) {
      out[dest.id] = normalized;
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/** SermonAudio `SocialEnum` value for a Cross Publish destination. */
export type SermonAudioSocialSharingPlatform = 'google' | 'facebook' | 'twitter';

/** One Cross Publish destination in `socialSharingSettings.platforms`. */
export interface SermonAudioSocialSharingSettingsPlatformEntry {
  /** SermonAudio social platform id (`google` = YouTube). */
  platform: SermonAudioSocialSharingPlatform;
  /** Post message (`message` on `SocialSharingSettingsPlatformAPIParam`). */
  message: string;
  /** YouTube video title when uploading full video to YouTube. */
  title?: string;
  /** YouTube visibility when uploading full video to YouTube. */
  privacy?: string;
  /** When true, attach the configured preview clip (X video preview). */
  useVideoClip?: boolean;
}

/**
 * Cross Publish payload nested under `socialSharingSettings` on sermon PATCH/PUT.
 * Matches the SermonAudio dashboard and OpenAPI `SocialSharingSettingsAPIParam`.
 */
export interface SermonAudioSocialSharingSettings {
  /** Per-destination Cross Publish options for selected platforms. */
  platforms: SermonAudioSocialSharingSettingsPlatformEntry[];
  /** When true, cross-post to YouTube (`google` platform entry). */
  google?: boolean;
  /** When true, cross-post to Facebook. */
  facebook?: boolean;
  /** When true, cross-post to X/Twitter. */
  twitter?: boolean;
}

function platformHasCrossPublishSelection(
  destId: SermonAudioCrossPublishTarget,
  settings: SermonAudioCrossPublishPlatformSettings | undefined
): boolean {
  if (!settings) return false;
  const dest = SERMON_AUDIO_CROSS_PUBLISH_DESTINATIONS.find((entry) => entry.id === destId);
  if (!dest) return false;
  if (destId === 'facebook' || destId === 'x') {
    return settings.postLink === true;
  }
  return dest.options.some((option) => settings[option.id] === true);
}

/**
 * Returns whether Cross Publish is enabled with at least one destination option selected.
 * @param settings - Normalized Cross Publish settings.
 * @returns True when master toggle is on and a platform has a valid selection.
 */
export function sermonAudioCrossPublishHasActiveSelection(
  settings: SermonAudioCrossPublishSettings | undefined
): boolean {
  if (!settings || settings.enabled !== true) return false;
  return SERMON_AUDIO_CROSS_PUBLISH_DESTINATIONS.some((dest) =>
    platformHasCrossPublishSelection(dest.id, settings[dest.id])
  );
}

/**
 * Builds Cross Publish `socialSharingSettings` for SermonAudio sermon publish (PATCH/PUT).
 * @param settings - Normalized Cross Publish settings from draft metadata.
 * @param options - Optional draft defaults when Cross Publish text fields are empty.
 * @returns Nested Cross Publish settings, or `undefined` when Cross Publish is off or empty.
 */
export function buildSermonAudioSocialSharingSettings(
  settings: SermonAudioCrossPublishSettings | undefined,
  options?: { defaultTitle?: string; defaultDescription?: string }
): SermonAudioSocialSharingSettings | undefined {
  if (!sermonAudioCrossPublishHasActiveSelection(settings)) return undefined;

  const defaultTitle = options?.defaultTitle?.trim() ?? '';
  const defaultDescription = options?.defaultDescription?.trim() ?? '';
  const platforms: SermonAudioSocialSharingSettingsPlatformEntry[] = [];
  const toggles: Pick<SermonAudioSocialSharingSettings, 'google' | 'facebook' | 'twitter'> = {};

  for (const dest of SERMON_AUDIO_CROSS_PUBLISH_DESTINATIONS) {
    const platformSettings = settings?.[dest.id];
    if (!platformHasCrossPublishSelection(dest.id, platformSettings)) continue;

    if (dest.id === 'youtube') {
      platforms.push({
        platform: 'google',
        title: platformSettings?.title?.trim() || defaultTitle,
        message: platformSettings?.description?.trim() || defaultDescription || defaultTitle,
        privacy: platformSettings?.privacy ?? 'public',
      });
      toggles.google = true;
      continue;
    }

    if (dest.id === 'facebook') {
      const postLink = platformSettings?.postLink === true;
      if (!postLink) continue;

      const uploadFullVideo = platformSettings?.uploadFullVideo === true;
      const customMessage = platformSettings?.linkMessage?.trim() ?? '';
      const message = customMessage || defaultTitle;

      platforms.push({
        platform: 'facebook',
        message,
        useVideoClip: uploadFullVideo,
      });
      toggles.facebook = true;
      continue;
    }

    if (dest.id === 'x') {
      const postLink = platformSettings?.postLink === true;
      if (!postLink) continue;

      const uploadVideoPreview = platformSettings?.uploadVideoPreview === true;
      const customMessage = platformSettings?.linkMessage?.trim() ?? '';
      const message = customMessage || defaultTitle;

      platforms.push({
        platform: 'twitter',
        message,
        useVideoClip: uploadVideoPreview,
      });
      toggles.twitter = true;
      continue;
    }
  }

  if (platforms.length === 0) return undefined;

  return {
    platforms,
    ...toggles,
  };
}
