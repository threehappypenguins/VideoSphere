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

export function isAllowedDraftThumbnailContentType(ct: string): boolean {
  return ALLOWED.has(ct.trim().toLowerCase());
}

export function draftThumbnailMaxSizeExceededMessage(): string {
  return `Thumbnail must be ${DRAFT_THUMBNAIL_MAX_SIZE_LABEL} or smaller`;
}

/** Client toast when the file MIME type is not in {@link DRAFT_THUMBNAIL_ALLOWED_CONTENT_TYPES}. */
export const DRAFT_THUMBNAIL_DISALLOWED_TYPE_MESSAGE = 'Only JPG or PNG images are allowed';

export function fileExtensionForThumbnailContentType(contentType: string): string {
  const ext = ALLOWED.get(contentType.trim().toLowerCase());
  return ext ?? 'bin';
}
