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

/** One Cross Publish destination in the sermon create `socialSharing` array. */
export interface SermonAudioSocialSharingCreateEntry {
  /** SermonAudio social platform id (`google` = YouTube). */
  platform: SermonAudioSocialSharingPlatform;
  /** Required by SA (`message` on `SocialSharingSettingsPlatformAPIParam`). */
  message: string;
  /** YouTube video title (`title` on `SocialSharingSettingsPlatformAPIParam`). */
  title?: string;
  /** YouTube visibility (`privacy` on `SocialSharingSettingsPlatformAPIParam`). */
  privacy?: string;
  /** When true, attach the configured preview clip (X video preview). */
  useVideoClip?: boolean;
}

/** Cross Publish fields merged into the sermon create POST body. */
export interface SermonAudioSocialSharingCreateFields {
  /** Per-destination Cross Publish options (array form used by the live SA API). */
  socialSharing: SermonAudioSocialSharingCreateEntry[];
  /** Preview clip range (seconds) when X video preview is enabled. */
  social_sharing_video_clip?: { start: number; end: number };
}

/** Default preview clip length (seconds) for X Cross Publish video preview. */
export const SERMON_AUDIO_CROSS_PUBLISH_VIDEO_CLIP_END_SECONDS = 120;

function platformHasCrossPublishSelection(
  destId: SermonAudioCrossPublishTarget,
  settings: SermonAudioCrossPublishPlatformSettings | undefined
): boolean {
  if (!settings) return false;
  const dest = SERMON_AUDIO_CROSS_PUBLISH_DESTINATIONS.find((entry) => entry.id === destId);
  if (!dest) return false;
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
 * Builds Cross Publish fields for the SermonAudio sermon create body (`socialSharing` array +
 * optional `social_sharing_video_clip`). Matches the live API shape used by transferupload and
 * the SermonAudio dashboard; the public OpenAPI spec documents the nested `platforms` form but
 * not this array form.
 * @param settings - Normalized Cross Publish settings from draft metadata.
 * @param options - Optional draft defaults when Cross Publish text fields are empty.
 * @returns SermonAudio body fields, or `undefined` when Cross Publish is off or empty.
 */
export function buildSermonAudioSocialSharingCreateFields(
  settings: SermonAudioCrossPublishSettings | undefined,
  options?: { defaultTitle?: string; defaultDescription?: string }
): SermonAudioSocialSharingCreateFields | undefined {
  if (!sermonAudioCrossPublishHasActiveSelection(settings)) return undefined;

  const defaultTitle = options?.defaultTitle?.trim() ?? '';
  const defaultDescription = options?.defaultDescription?.trim() ?? '';
  const socialSharing: SermonAudioSocialSharingCreateEntry[] = [];
  let usesVideoClip = false;

  for (const dest of SERMON_AUDIO_CROSS_PUBLISH_DESTINATIONS) {
    const platformSettings = settings?.[dest.id];
    if (!platformHasCrossPublishSelection(dest.id, platformSettings)) continue;

    if (dest.id === 'youtube') {
      socialSharing.push({
        platform: 'google',
        title: platformSettings?.title?.trim() || defaultTitle,
        message: platformSettings?.description?.trim() || defaultDescription,
        privacy: platformSettings?.privacy ?? 'public',
      });
      continue;
    }

    if (dest.id === 'facebook') {
      const postLink = platformSettings?.postLink === true;
      const uploadFullVideo = platformSettings?.uploadFullVideo === true;
      const customMessage = platformSettings?.linkMessage?.trim() ?? '';
      const message = postLink
        ? customMessage || defaultTitle
        : uploadFullVideo
          ? defaultDescription || defaultTitle
          : defaultTitle;

      socialSharing.push({ platform: 'facebook', message });
      continue;
    }

    const postLink = platformSettings?.postLink === true;
    const uploadVideoPreview = platformSettings?.uploadVideoPreview === true;
    const customMessage = platformSettings?.linkMessage?.trim() ?? '';
    const message = postLink ? customMessage || defaultTitle : defaultTitle;

    if (uploadVideoPreview) usesVideoClip = true;

    socialSharing.push({
      platform: 'twitter',
      message,
      ...(uploadVideoPreview ? { useVideoClip: true } : {}),
    });
  }

  if (socialSharing.length === 0) return undefined;

  return {
    socialSharing,
    ...(usesVideoClip
      ? {
          social_sharing_video_clip: {
            start: 0,
            end: SERMON_AUDIO_CROSS_PUBLISH_VIDEO_CLIP_END_SECONDS,
          },
        }
      : {}),
  };
}
