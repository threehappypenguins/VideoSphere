import type {
  SermonAudioCrossPublishOptionId,
  SermonAudioCrossPublishPlatformSettings,
  SermonAudioCrossPublishSettings,
  SermonAudioCrossPublishTarget,
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
}

/** Ordered Cross Publish destinations for the draft UI. */
export const SERMON_AUDIO_CROSS_PUBLISH_DESTINATIONS: readonly SermonAudioCrossPublishDestinationConfig[] =
  [
    {
      id: 'youtube',
      label: 'YouTube',
      options: [
        { id: 'postLink', label: 'Post link to sermon' },
        { id: 'uploadFullVideo', label: 'Upload full sermon video to YouTube' },
      ],
    },
    {
      id: 'facebook',
      label: 'Facebook',
      options: [
        { id: 'postLink', label: 'Post link to sermon' },
        { id: 'uploadFullVideo', label: 'Upload full sermon video to Facebook' },
      ],
    },
    {
      id: 'x',
      label: 'X (Twitter)',
      options: [
        { id: 'postLink', label: 'Post link to sermon' },
        { id: 'uploadVideoPreview', label: 'Upload video preview to X (Twitter)' },
      ],
    },
  ] as const;

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

/**
 * Normalizes Cross Publish settings for one destination platform.
 * @param value - Raw JSON value from draft storage.
 * @returns Normalized settings or `undefined` when empty.
 */
export function normalizeSermonAudioCrossPublishPlatformSettings(
  value: unknown
): SermonAudioCrossPublishPlatformSettings | undefined {
  if (!isPlainObject(value)) return undefined;

  const postLink = normalizeOptionalBoolean(value.postLink);
  const uploadFullVideo = normalizeOptionalBoolean(value.uploadFullVideo);
  const uploadVideoPreview = normalizeOptionalBoolean(value.uploadVideoPreview);
  const linkMessage = trimStr(value.linkMessage);

  const out: SermonAudioCrossPublishPlatformSettings = {
    ...(postLink !== undefined ? { postLink } : {}),
    ...(uploadFullVideo !== undefined ? { uploadFullVideo } : {}),
    ...(uploadVideoPreview !== undefined ? { uploadVideoPreview } : {}),
    ...(linkMessage !== undefined ? { linkMessage } : {}),
  };

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
    const normalized = normalizeSermonAudioCrossPublishPlatformSettings(value[dest.id]);
    if (normalized) {
      out[dest.id] = normalized;
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/** SermonAudio `SocialEnum` value for a Cross Publish destination. */
export type SermonAudioSocialSharingPlatform = 'google' | 'facebook' | 'twitter';

const CROSS_PUBLISH_TARGET_TO_SA_PLATFORM: Record<
  SermonAudioCrossPublishTarget,
  SermonAudioSocialSharingPlatform
> = {
  youtube: 'google',
  facebook: 'facebook',
  x: 'twitter',
};

/** One Cross Publish destination on sermon create (matches transferupload / SA dashboard API). */
export interface SermonAudioSocialSharingCreateEntry {
  /** SermonAudio social platform id (`google` = YouTube). */
  platform: SermonAudioSocialSharingPlatform;
  /** Link post message (required by SA when the platform is listed). */
  message: string;
  /** When true, attach the configured preview clip to the social post. */
  useVideoClip?: boolean;
}

/** Cross Publish fields merged into POST `/v2/node/sermons` create body. */
export interface SermonAudioSocialSharingCreateFields {
  /** Per-destination Cross Publish options (array form used by the live SA API). */
  socialSharing: SermonAudioSocialSharingCreateEntry[];
  /** Preview clip range (seconds) attached when any destination uses `useVideoClip`. */
  social_sharing_video_clip?: { start: number; end: number };
}

/** Default preview clip length (seconds) for Cross Publish video attachments. */
export const SERMON_AUDIO_CROSS_PUBLISH_VIDEO_CLIP_END_SECONDS = 120;

function platformHasCrossPublishSelection(
  settings: SermonAudioCrossPublishPlatformSettings | undefined
): boolean {
  if (!settings) return false;
  return (
    settings.postLink === true ||
    settings.uploadFullVideo === true ||
    settings.uploadVideoPreview === true
  );
}

/**
 * Returns whether Cross Publish is enabled with at least one destination option selected.
 * @param settings - Normalized Cross Publish settings.
 * @returns True when master toggle is on and a platform has link, full-video, or preview selected.
 */
export function sermonAudioCrossPublishHasActiveSelection(
  settings: SermonAudioCrossPublishSettings | undefined
): boolean {
  if (!settings || settings.enabled !== true) return false;
  return SERMON_AUDIO_CROSS_PUBLISH_DESTINATIONS.some((dest) =>
    platformHasCrossPublishSelection(settings[dest.id])
  );
}

/**
 * Builds Cross Publish fields for SermonAudio sermon create or pre-publish PATCH.
 * Matches the transferupload `socialSharing` array format used against the live SA API.
 * @param settings - Normalized Cross Publish settings from draft metadata.
 * @param options - Optional fallback link message (typically the sermon title).
 * @returns SermonAudio body fields, or `undefined` when Cross Publish is off or empty.
 */
export function buildSermonAudioSocialSharingCreateFields(
  settings: SermonAudioCrossPublishSettings | undefined,
  options?: { defaultLinkMessage?: string }
): SermonAudioSocialSharingCreateFields | undefined {
  if (!sermonAudioCrossPublishHasActiveSelection(settings)) return undefined;

  const defaultLinkMessage = options?.defaultLinkMessage?.trim() ?? '';
  const socialSharing: SermonAudioSocialSharingCreateEntry[] = [];

  for (const dest of SERMON_AUDIO_CROSS_PUBLISH_DESTINATIONS) {
    const platformSettings = settings?.[dest.id];
    if (!platformHasCrossPublishSelection(platformSettings)) continue;

    const postLink = platformSettings?.postLink === true;
    const customMessage = platformSettings?.linkMessage?.trim() ?? '';

    socialSharing.push({
      platform: CROSS_PUBLISH_TARGET_TO_SA_PLATFORM[dest.id],
      message: postLink ? customMessage || defaultLinkMessage : defaultLinkMessage,
      // transferupload always attaches the preview clip for Cross Publish destinations.
      useVideoClip: true,
    });
  }

  if (socialSharing.length === 0) return undefined;

  return {
    socialSharing,
    social_sharing_video_clip: {
      start: 0,
      end: SERMON_AUDIO_CROSS_PUBLISH_VIDEO_CLIP_END_SECONDS,
    },
  };
}
