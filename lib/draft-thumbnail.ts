/** Draft thumbnail uploads: validation shared by presign, complete routes, and client UI. */

export const MAX_DRAFT_THUMBNAIL_BYTES = 2 * 1024 * 1024;

const ALLOWED = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
]);

/** Human-readable max size for UI copy (e.g. "2 MB") — derives from MAX_DRAFT_THUMBNAIL_BYTES. */
export const DRAFT_THUMBNAIL_MAX_SIZE_LABEL = `${MAX_DRAFT_THUMBNAIL_BYTES / (1024 * 1024)} MB`;

/** MIME types allowed for thumbnails (same keys as server-side validation). */
export const DRAFT_THUMBNAIL_ALLOWED_CONTENT_TYPES = Object.freeze(
  Array.from(ALLOWED.keys())
) as readonly string[];

/** `<input type="file" accept={…}>` value aligned with {@link isAllowedDraftThumbnailContentType}. */
export function draftThumbnailFileInputAccept(): string {
  const segments: string[] = [];
  for (const [mime, ext] of ALLOWED.entries()) {
    segments.push(mime);
    if (ext === 'jpg') {
      segments.push('.jpg', '.jpeg');
    } else {
      segments.push(`.${ext}`);
    }
  }
  return segments.join(',');
}

/**
 * Executes is allowed draft thumbnail content type.
 * @param ct - Input value for ct.
 * @returns The computed result.
 */
export function isAllowedDraftThumbnailContentType(ct: string): boolean {
  return ALLOWED.has(ct.trim().toLowerCase());
}

/**
 * Executes draft thumbnail max size exceeded message.
 * @returns The computed result.
 */
export function draftThumbnailMaxSizeExceededMessage(): string {
  return `Thumbnail must be ${DRAFT_THUMBNAIL_MAX_SIZE_LABEL} or smaller`;
}

/** Client toast when the file MIME type is not in {@link DRAFT_THUMBNAIL_ALLOWED_CONTENT_TYPES}. */
export const DRAFT_THUMBNAIL_DISALLOWED_TYPE_MESSAGE = 'Only JPG or PNG images are allowed';

/** Platforms that consume the draft-level or per-platform thumbnail on distribute. */
export const DRAFT_THUMBNAIL_PLATFORMS = ['youtube', 'vimeo', 'facebook', 'sermon_audio'] as const;

/** Platform id that accepts draft thumbnails on distribute. */
export type DraftThumbnailPlatform = (typeof DRAFT_THUMBNAIL_PLATFORMS)[number];

/** Display order for thumbnail platform icons and per-platform pickers. */
export const DRAFT_THUMBNAIL_PLATFORM_ORDER: DraftThumbnailPlatform[] = [
  'youtube',
  'vimeo',
  'facebook',
  'sermon_audio',
];

/**
 * Returns whether a platform id supports draft thumbnail upload/distribution.
 * @param platform - Connected platform identifier.
 * @returns True when the platform uses draft thumbnails.
 */
export function isDraftThumbnailPlatform(platform: string): platform is DraftThumbnailPlatform {
  return (DRAFT_THUMBNAIL_PLATFORMS as readonly string[]).includes(platform);
}

/**
 * Executes file extension for thumbnail content type.
 * @param contentType - Input value for content type.
 * @returns The computed result.
 */
export function fileExtensionForThumbnailContentType(contentType: string): string {
  const ext = ALLOWED.get(contentType.trim().toLowerCase());
  return ext ?? 'bin';
}
