/** Draft thumbnail uploads: validation shared by presign and complete routes. */

export const MAX_DRAFT_THUMBNAIL_BYTES = 2 * 1024 * 1024;

const ALLOWED = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
]);

export function isAllowedDraftThumbnailContentType(ct: string): boolean {
  return ALLOWED.has(ct.trim().toLowerCase());
}

export function fileExtensionForThumbnailContentType(contentType: string): string {
  const ext = ALLOWED.get(contentType.trim().toLowerCase());
  return ext ?? 'bin';
}
