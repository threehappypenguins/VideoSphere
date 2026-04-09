/**
 * Platform upload row `document` JSON — snapshot at distribution time.
 * Shared fields mirror the draft; optional keys record per-platform options
 * that were passed into the upload APIs (for debugging and support).
 */

import { DEFAULT_DRAFT_VISIBILITY, visibilityFromRow } from '@/lib/draft-upload-metadata';
import { normalizeDraftPlatforms } from '@/lib/draft-upload-metadata';
import type { PlatformUploadVisibility, VimeoDraftFields, YouTubeDraftFields } from '@/types';

/**
 * Defines the shape of platform upload document stored.
 */
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

/**
 * Writable tags for create-input; same shape as persisted document fields (without job id / platform).
 * Defined here so routes can validate serialized size without importing the Appwrite-backed repository.
 */
export type PlatformUploadRowDocumentInput = Omit<PlatformUploadDocumentStored, 'tags'> & {
  tags: string[];
};

/** Appwrite string column max (character/code-unit budget); keep serialized `document` under this. */
export const MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS = 16_383;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((t): t is string => typeof t === 'string');
}

/**
 * Defines the shape of stringify platform upload document options.
 */
export interface StringifyPlatformUploadDocumentOptions {
  /** When true, adds `__documentStorageTruncated` so support can see the DB row was shrunk to fit the column. */
  documentStorageTruncated?: boolean;
}

/**
 * Executes stringify platform upload document for storage.
 * @param d - Input value for d.
 * @param options - Optional configuration values.
 * @returns The computed result.
 */
export function stringifyPlatformUploadDocumentForStorage(
  d: PlatformUploadDocumentStored,
  options?: StringifyPlatformUploadDocumentOptions
): string {
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
  if (options?.documentStorageTruncated === true) {
    payload.__documentStorageTruncated = true;
  }
  return JSON.stringify(payload);
}

const DOCUMENT_STORAGE_TRUNCATION_MARKER = ' … [truncated for Appwrite storage]';

/**
 * Provides platform upload document too large error behavior.
 */
export class PlatformUploadDocumentTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformUploadDocumentTooLargeError';
  }
}

/** Serialized JSON length in UTF-16 code units (`String#length`), not byte size. */
function jsonCharLengthForDocument(
  d: PlatformUploadDocumentStored,
  truncatedFlag: boolean
): number {
  return stringifyPlatformUploadDocumentForStorage(d, {
    documentStorageTruncated: truncatedFlag,
  }).length;
}

/** Largest tag count such that the serialized JSON fits the char limit (binary search). */
function maxTagCountFitting(doc: PlatformUploadDocumentStored, truncatedFlag: boolean): number {
  const tags = [...doc.tags];
  if (tags.length === 0) return 0;
  let lo = 0;
  let hi = tags.length;
  let best = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = { ...doc, tags: tags.slice(0, mid) };
    if (jsonCharLengthForDocument(candidate, truncatedFlag) <= MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** Largest title prefix (plus marker if truncated) such that serialized JSON fits the char limit. */
function shrinkTitleToFit(doc: PlatformUploadDocumentStored, truncatedFlag: boolean): string {
  const full = doc.title;
  if (jsonCharLengthForDocument(doc, truncatedFlag) <= MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS) {
    return full;
  }
  let lo = 0;
  let hi = full.length;
  let best = '';
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const prefix = full.slice(0, mid);
    const title = mid < full.length ? prefix + DOCUMENT_STORAGE_TRUNCATION_MARKER : prefix;
    const candidate = { ...doc, title };
    if (jsonCharLengthForDocument(candidate, truncatedFlag) <= MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS) {
      best = title;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** Largest description prefix (plus marker if truncated) such that serialized JSON fits the char limit. */
function shrinkDescriptionToFit(doc: PlatformUploadDocumentStored, truncatedFlag: boolean): string {
  const full = doc.description;
  if (jsonCharLengthForDocument(doc, truncatedFlag) <= MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS) {
    return full;
  }
  let lo = 0;
  let hi = full.length;
  let best = '';
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const prefix = full.slice(0, mid);
    const description = mid < full.length ? prefix + DOCUMENT_STORAGE_TRUNCATION_MARKER : prefix;
    const candidate = { ...doc, description };
    if (jsonCharLengthForDocument(candidate, truncatedFlag) <= MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS) {
      best = description;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * Serialize `platform_uploads.document` so it never exceeds {@link MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS}.
 * Order: drop optional audit snapshots (`draftYoutube` / `draftVimeo`), then shrink description, tags,
 * and title. Actual upload metadata still comes from the draft in the distribute route — this row is
 * primarily an audit snapshot.
 */
export function serializePlatformUploadDocumentForAppwrite(
  d: PlatformUploadDocumentStored
): string {
  let doc: PlatformUploadDocumentStored = {
    ...d,
    tags: [...d.tags],
  };
  let truncated = false;

  if (jsonCharLengthForDocument(doc, false) <= MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS) {
    return stringifyPlatformUploadDocumentForStorage(doc);
  }

  doc = {
    ...doc,
    draftYoutube: undefined,
    draftVimeo: undefined,
  };
  truncated = true;

  if (jsonCharLengthForDocument(doc, truncated) <= MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS) {
    return stringifyPlatformUploadDocumentForStorage(doc, { documentStorageTruncated: true });
  }

  doc = {
    ...doc,
    description: shrinkDescriptionToFit(doc, truncated),
  };

  if (jsonCharLengthForDocument(doc, truncated) <= MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS) {
    return stringifyPlatformUploadDocumentForStorage(doc, { documentStorageTruncated: true });
  }

  const tagCount = maxTagCountFitting(doc, truncated);
  doc = { ...doc, tags: doc.tags.slice(0, tagCount) };

  if (jsonCharLengthForDocument(doc, truncated) <= MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS) {
    return stringifyPlatformUploadDocumentForStorage(doc, { documentStorageTruncated: true });
  }

  doc = { ...doc, title: shrinkTitleToFit(doc, truncated) };

  if (jsonCharLengthForDocument(doc, truncated) <= MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS) {
    return stringifyPlatformUploadDocumentForStorage(doc, { documentStorageTruncated: true });
  }

  doc = {
    ...doc,
    categoryId: undefined,
    vimeoCategoryUri: undefined,
  };

  if (jsonCharLengthForDocument(doc, truncated) <= MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS) {
    return stringifyPlatformUploadDocumentForStorage(doc, { documentStorageTruncated: true });
  }

  throw new PlatformUploadDocumentTooLargeError(
    `platform_uploads.document still exceeds ${MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS} characters after ` +
      'dropping audit snapshots and truncating stored title/description/tags. Shorten the draft or reduce tag count.'
  );
}

/** Serialized `document` for a new `platform_uploads` row, guaranteed ≤ {@link MAX_PLATFORM_UPLOAD_DOCUMENT_CHARS}. */
export function platformUploadDocumentJsonForCreateRow(
  data: PlatformUploadRowDocumentInput
): string {
  const {
    title,
    description,
    tags,
    visibility,
    categoryId,
    madeForKids,
    vimeoCategoryUri,
    draftYoutube,
    draftVimeo,
  } = data;
  return serializePlatformUploadDocumentForAppwrite({
    title,
    description,
    tags: [...tags],
    visibility,
    ...(categoryId !== undefined ? { categoryId } : {}),
    ...(madeForKids !== undefined ? { madeForKids } : {}),
    ...(vimeoCategoryUri !== undefined ? { vimeoCategoryUri } : {}),
    ...(draftYoutube !== undefined ? { draftYoutube } : {}),
    ...(draftVimeo !== undefined ? { draftVimeo } : {}),
  });
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
