/**
 * Platform upload row `document` JSON — snapshot at distribution time.
 * Shared fields mirror the draft; optional keys record per-platform options
 * that were passed into the upload APIs (for debugging and support).
 */

import { DEFAULT_DRAFT_VISIBILITY, visibilityFromRow } from '@/lib/draft-upload-metadata';
import { normalizeDraftPlatforms } from '@/lib/draft-upload-metadata';
import type { PlatformUploadVisibility, VimeoDraftFields, YouTubeDraftFields } from '@/types';

export interface PlatformUploadDocumentStored {
  title: string;
  description: string;
  tags: readonly string[];
  visibility: PlatformUploadVisibility;
  /** YouTube: `snippet.categoryId` from the draft when set. */
  categoryId?: string;
  /** YouTube: `status.selfDeclaredMadeForKids` when set. */
  madeForKids?: boolean;
  /** Vimeo: category URI from the draft when set. */
  vimeoCategoryUri?: string;
  /** Audit: `platforms.youtube` from the draft at distribute time. */
  draftYoutube?: YouTubeDraftFields;
  /** Audit: `platforms.vimeo` from the draft at distribute time. */
  draftVimeo?: VimeoDraftFields;
}

/** Appwrite string column max; keep `document` under this when serialized. */
export const MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS = 16_383;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((t): t is string => typeof t === 'string');
}

export function stringifyPlatformUploadDocumentForStorage(d: PlatformUploadDocumentStored): string {
  const payload: Record<string, unknown> = {
    title: d.title,
    description: d.description,
    tags: [...d.tags],
    visibility: d.visibility,
  };
  if (d.categoryId !== undefined) payload.categoryId = d.categoryId;
  if (d.madeForKids !== undefined) payload.madeForKids = d.madeForKids;
  if (d.vimeoCategoryUri !== undefined) payload.vimeoCategoryUri = d.vimeoCategoryUri;
  if (d.draftYoutube !== undefined) payload.draftYoutube = d.draftYoutube;
  if (d.draftVimeo !== undefined) payload.draftVimeo = d.draftVimeo;
  return JSON.stringify(payload);
}

const EMPTY_DOC: PlatformUploadDocumentStored = {
  title: '',
  description: '',
  tags: [],
  visibility: DEFAULT_DRAFT_VISIBILITY,
};

/** Parse `platform_uploads.document` (required for new rows). */
export function platformUploadDocumentFromRow(
  row: Record<string, unknown>
): PlatformUploadDocumentStored {
  const raw = row.document;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ...EMPTY_DOC };
  }
  try {
    const o = JSON.parse(raw) as unknown;
    if (o === null || typeof o !== 'object' || Array.isArray(o)) {
      return { ...EMPTY_DOC };
    }
    const rec = o as Record<string, unknown>;
    const categoryIdRaw = rec.categoryId;
    const categoryId =
      typeof categoryIdRaw === 'string' && categoryIdRaw.trim() !== ''
        ? categoryIdRaw.trim()
        : undefined;
    const madeForKids = typeof rec.madeForKids === 'boolean' ? rec.madeForKids : undefined;
    const vimeoUriRaw = rec.vimeoCategoryUri;
    const vimeoCategoryUri =
      typeof vimeoUriRaw === 'string' && vimeoUriRaw.trim() !== '' ? vimeoUriRaw.trim() : undefined;
    const draftYoutube = isPlainObject(rec.draftYoutube)
      ? normalizeDraftPlatforms({ youtube: rec.draftYoutube }).youtube
      : undefined;
    const draftVimeo = isPlainObject(rec.draftVimeo)
      ? normalizeDraftPlatforms({ vimeo: rec.draftVimeo }).vimeo
      : undefined;

    return {
      title: typeof rec.title === 'string' ? rec.title : '',
      description: typeof rec.description === 'string' ? rec.description : '',
      tags: normalizeTagList(rec.tags),
      visibility: visibilityFromRow(rec.visibility),
      ...(categoryId !== undefined ? { categoryId } : {}),
      ...(madeForKids !== undefined ? { madeForKids } : {}),
      ...(vimeoCategoryUri !== undefined ? { vimeoCategoryUri } : {}),
      ...(draftYoutube !== undefined ? { draftYoutube } : {}),
      ...(draftVimeo !== undefined ? { draftVimeo } : {}),
    };
  } catch {
    return { ...EMPTY_DOC };
  }
}
