/**
 * Draft `document` JSON → per-platform upload metadata at distribute time.
 *
 * Stored shape:
 * - **Shared:** `targets`, `title`, `description`, `visibility`, `tags` (one list for all targets)
 * - **Per platform:** `platforms.youtube` / `platforms.vimeo` / `platforms.sermon_audio` (e.g. YouTube `categoryId`, Vimeo `categoryUris`, SermonAudio sermon fields);
 *   backup targets (`platforms.sftp` / `platforms.smb`) are carried through as empty objects until fields exist.
 */

import { normalizeDraftLabelList } from '@/lib/draft-labels';
import type { PlatformUploadMetadata } from '@/lib/platforms/types';
import { normalizeBackupFileNameSettings } from '@/lib/backup-filename';
import { formatSermonAudioKeywordsFromTags } from '@/lib/platforms/sermon-audio-tags';
import { normalizeSermonAudioCrossPublishSettings } from '@/lib/platforms/sermon-audio-cross-publish';
import { normalizeVimeoContentRatingCodes } from '@/lib/platforms/vimeo-content-rating';
import { uniqueTrimmedPlaylistTitles } from '@/lib/platforms/youtube';
import {
  CONNECTED_ACCOUNT_PLATFORMS,
  type BackupFileNameSettings,
  type ConnectedAccountPlatform,
  type Draft,
  type DraftPlatforms,
  type PlatformUploadVisibility,
  type VimeoVideoLicense,
  type YouTubeDraftFields,
  type VimeoDraftFields,
  type PerPlatformCopyOverrides,
  type PerPlatformOverrides,
  type SermonAudioDraftFields,
  type SftpDraftFields,
  type SmbDraftFields,
  type GoogleDriveDraftFields,
  type FacebookDraftFields,
} from '@/types';

/**
 * Defines the DEFAULT_DRAFT_VISIBILITY constant.
 */
export const DEFAULT_DRAFT_VISIBILITY: PlatformUploadVisibility = 'public';

export { MAX_DRAFT_TITLE_LENGTH } from '@/lib/youtube-metadata-limits';

export {
  DRAFT_TITLE_OVERRIDE_PLATFORM_ORDER,
  draftHasPersistableTitle,
  resolveDraftTitleForStorage,
  type ResolveDraftTitleInput,
} from '@/lib/draft-title';

/** String column max; entire `document` must serialize under this. */
export const MAX_DRAFT_DOCUMENT_CHARS = 16_383;

/**
 * Provides draft document too large error behavior.
 */
export class DraftDocumentTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DraftDocumentTooLargeError';
  }
}

/** Throws {@link DraftDocumentTooLargeError} if JSON is too large for the `drafts.document` column. */
export function assertDraftDocumentJsonWithinLimit(json: string): void {
  if (json.length > MAX_DRAFT_DOCUMENT_CHARS) {
    throw new DraftDocumentTooLargeError(
      `Draft document JSON is ${json.length} characters; storage allows at most ${MAX_DRAFT_DOCUMENT_CHARS} in the document column. Shorten description, tags, or platform-specific fields.`
    );
  }
}

const VISIBILITY_SET = new Set<PlatformUploadVisibility>(['public', 'unlisted', 'private']);

const PLATFORM_SET = new Set<string>(CONNECTED_ACCOUNT_PLATFORMS);

/**
 * Executes is connected account platform.
 * @param value - Input value for value.
 * @returns The computed result.
 */
export function isConnectedAccountPlatform(value: unknown): value is ConnectedAccountPlatform {
  return typeof value === 'string' && PLATFORM_SET.has(value);
}

/**
 * Executes is platform upload visibility.
 * @param value - Input value for value.
 * @returns The computed result.
 */
export function isPlatformUploadVisibility(value: unknown): value is PlatformUploadVisibility {
  return typeof value === 'string' && VISIBILITY_SET.has(value as PlatformUploadVisibility);
}

/** API / loose values → visibility (invalid → public). */
export function visibilityFromRow(value: unknown): PlatformUploadVisibility {
  return isPlatformUploadVisibility(value) ? value : DEFAULT_DRAFT_VISIBILITY;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((t): t is string => typeof t === 'string');
}

function parseTargetsFromDocument(value: unknown): ConnectedAccountPlatform[] {
  if (!Array.isArray(value)) return [];
  const out = value.filter(isConnectedAccountPlatform);
  return [...new Set(out)];
}

/**
 * Tags at document root. If missing, derive from legacy `platforms.*.tags` (first non-empty).
 */
function tagsFromDocumentObject(o: Record<string, unknown>): string[] {
  const top = normalizeTagList(o.tags);
  if (top.length > 0) return top;

  const platforms = o.platforms;
  if (!isPlainObject(platforms)) return [];

  const yt = platforms.youtube;
  if (isPlainObject(yt)) {
    const fromYt = normalizeTagList(yt.tags);
    if (fromYt.length > 0) return fromYt;
  }
  const vm = platforms.vimeo;
  if (isPlainObject(vm)) {
    const fromVm = normalizeTagList(vm.tags);
    if (fromVm.length > 0) return fromVm;
  }
  return [];
}

function trimStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/**
 * Normalizes a thumbnail override string when the key is present on stored draft JSON.
 * Preserves an explicit empty string so per-platform "no thumbnail" round-trips reliably.
 * @param v - Raw field value from draft document JSON.
 * @returns Trimmed key, `''` when explicitly empty, or `undefined` when not a string.
 */
function normalizePresentThumbnailOverrideString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? '' : trimmed;
}

function stringList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter(Boolean);
  return out;
}

function normalizePerPlatformTitleDescriptionOverrides(
  o: Record<string, unknown>
): Pick<PerPlatformCopyOverrides, 'titleOverride' | 'descriptionOverride'> {
  const titleOverride = trimStr(o.titleOverride);
  const descriptionOverride = trimStr(o.descriptionOverride);

  return {
    ...(titleOverride !== undefined ? { titleOverride } : {}),
    ...(descriptionOverride !== undefined ? { descriptionOverride } : {}),
  };
}

function normalizePerPlatformCopyOverrides(
  o: Record<string, unknown>
): Pick<PerPlatformCopyOverrides, 'titleOverride' | 'descriptionOverride' | 'tagsOverride'> {
  const titleOverride = trimStr(o.titleOverride);
  const descriptionOverride = trimStr(o.descriptionOverride);
  let tagsOverride: string[] | undefined;
  if (Array.isArray(o.tagsOverride)) {
    tagsOverride = normalizeTagList(o.tagsOverride)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return {
    ...(titleOverride !== undefined ? { titleOverride } : {}),
    ...(descriptionOverride !== undefined ? { descriptionOverride } : {}),
    ...(tagsOverride !== undefined ? { tagsOverride } : {}),
  };
}

function normalizeThumbnailOverrideFields(
  o: Record<string, unknown>
): Pick<PerPlatformOverrides, 'thumbnailR2KeyOverride' | 'thumbnailContentTypeOverride'> {
  const out: Pick<PerPlatformOverrides, 'thumbnailR2KeyOverride' | 'thumbnailContentTypeOverride'> =
    {};

  if ('thumbnailR2KeyOverride' in o) {
    const thumbnailR2KeyOverride = normalizePresentThumbnailOverrideString(
      o.thumbnailR2KeyOverride
    );
    if (thumbnailR2KeyOverride !== undefined) {
      out.thumbnailR2KeyOverride = thumbnailR2KeyOverride;
    }
  }
  if ('thumbnailContentTypeOverride' in o) {
    const thumbnailContentTypeOverride = normalizePresentThumbnailOverrideString(
      o.thumbnailContentTypeOverride
    );
    if (thumbnailContentTypeOverride !== undefined) {
      out.thumbnailContentTypeOverride = thumbnailContentTypeOverride;
    }
  }

  return out;
}

function normalizePerPlatformOverrideFields(
  o: Record<string, unknown>
): Pick<
  YouTubeDraftFields,
  | 'titleOverride'
  | 'descriptionOverride'
  | 'tagsOverride'
  | 'visibilityOverride'
  | 'thumbnailR2KeyOverride'
  | 'thumbnailContentTypeOverride'
> {
  const visibilityOverride = isPlatformUploadVisibility(o.visibilityOverride)
    ? o.visibilityOverride
    : undefined;

  return {
    ...normalizePerPlatformCopyOverrides(o),
    ...(visibilityOverride !== undefined ? { visibilityOverride } : {}),
    ...normalizeThumbnailOverrideFields(o),
  };
}

const YT_LICENSE = new Set(['youtube', 'creativeCommon']);

const VIMEO_LICENSE = new Set<VimeoVideoLicense>([
  'by',
  'by-nc',
  'by-nc-nd',
  'by-nc-sa',
  'by-nd',
  'by-sa',
  'cc0',
]);

function normalizeYoutubeFields(y: Record<string, unknown>): YouTubeDraftFields {
  const categoryId = trimStr(y.categoryId);
  const madeForKids = typeof y.madeForKids === 'boolean' ? y.madeForKids : undefined;
  const defaultLanguage = trimStr(y.defaultLanguage);
  const defaultAudioLanguage = trimStr(y.defaultAudioLanguage);
  const embeddable = typeof y.embeddable === 'boolean' ? y.embeddable : undefined;
  const lic = trimStr(y.license);
  const license = lic && YT_LICENSE.has(lic) ? (lic as YouTubeDraftFields['license']) : undefined;
  const notifySubscribers =
    typeof y.notifySubscribers === 'boolean' ? y.notifySubscribers : undefined;
  const publishAt = trimStr(y.publishAt);
  const recordingDate = trimStr(y.recordingDate);
  let playlistIds: string[] | undefined;
  if (Array.isArray(y.playlistIds)) {
    playlistIds = y.playlistIds
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  let playlistTitles: string[] | undefined;
  if (Array.isArray(y.playlistTitles)) {
    playlistTitles = y.playlistTitles
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return {
    ...normalizePerPlatformOverrideFields(y),
    ...(categoryId !== undefined ? { categoryId } : {}),
    ...(madeForKids !== undefined ? { madeForKids } : {}),
    ...(defaultLanguage !== undefined ? { defaultLanguage } : {}),
    ...(defaultAudioLanguage !== undefined ? { defaultAudioLanguage } : {}),
    ...(embeddable !== undefined ? { embeddable } : {}),
    ...(license !== undefined ? { license } : {}),
    ...(notifySubscribers !== undefined ? { notifySubscribers } : {}),
    ...(publishAt !== undefined ? { publishAt } : {}),
    ...(recordingDate !== undefined ? { recordingDate } : {}),
    ...(playlistIds !== undefined ? { playlistIds } : {}),
    ...(playlistTitles !== undefined ? { playlistTitles } : {}),
    ...(y.isShort === true ? { isShort: true } : {}),
  };
}

function normalizeVimeoContentRating(value: unknown): string[] | undefined {
  if (value === null) {
    return undefined;
  }
  return normalizeVimeoContentRatingCodes(value);
}

/** Trims, drops empties, and dedupes category URIs in first-seen order. */
function uniqueTrimmedVimeoCategoryUris(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const uris: string[] = [];

  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const uri = raw.trim();
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    uris.push(uri);
  }

  return uris;
}

function normalizeVimeoCategoryUris(v: Record<string, unknown>): string[] | undefined {
  if (!Array.isArray(v.categoryUris)) {
    return undefined;
  }

  const uris = uniqueTrimmedVimeoCategoryUris(v.categoryUris);
  return uris.length > 0 ? uris : undefined;
}

function normalizeVimeoFields(v: Record<string, unknown>): VimeoDraftFields {
  const categoryUris = normalizeVimeoCategoryUris(v);
  let license: VimeoVideoLicense | null | undefined;
  if (v.license === null) {
    license = null;
  } else {
    const licRaw = trimStr(v.license);
    license =
      licRaw && VIMEO_LICENSE.has(licRaw as VimeoVideoLicense)
        ? (licRaw as VimeoVideoLicense)
        : undefined;
  }
  const contentRating = normalizeVimeoContentRating(v.contentRating);

  return {
    ...normalizePerPlatformOverrideFields(v),
    ...(categoryUris !== undefined ? { categoryUris } : {}),
    ...(license !== undefined ? { license } : {}),
    ...(contentRating !== undefined ? { contentRating } : {}),
  };
}

function normalizeFacebookFields(f: Record<string, unknown>): FacebookDraftFields {
  const videoState =
    f.videoState === 'PUBLISHED' || f.videoState === 'SCHEDULED' ? f.videoState : undefined;
  const scheduledPublishTime =
    typeof f.scheduledPublishTime === 'number' && Number.isFinite(f.scheduledPublishTime)
      ? Math.floor(f.scheduledPublishTime)
      : undefined;

  return {
    ...normalizePerPlatformTitleDescriptionOverrides(f),
    ...normalizeThumbnailOverrideFields(f),
    ...(videoState !== undefined ? { videoState } : {}),
    ...(scheduledPublishTime !== undefined ? { scheduledPublishTime } : {}),
  };
}

function resolveSermonAudioAutoPublishOnProcessed(
  fields: Pick<SermonAudioDraftFields, 'autoPublishOnProcessed'> | undefined
): boolean {
  return fields?.autoPublishOnProcessed !== false;
}

function normalizeSermonAudioFields(sa: Record<string, unknown>): SermonAudioDraftFields {
  const speakerName = trimStr(sa.speakerName);
  const speakerID =
    typeof sa.speakerID === 'number' && Number.isInteger(sa.speakerID) && sa.speakerID > 0
      ? sa.speakerID
      : undefined;
  const preachDate = trimStr(sa.preachDate);
  const eventType = trimStr(sa.eventType);
  const subtitle = trimStr(sa.subtitle);
  const seriesID =
    typeof sa.seriesID === 'number' && Number.isInteger(sa.seriesID) && sa.seriesID > 0
      ? sa.seriesID
      : undefined;
  const bibleText = trimStr(sa.bibleText);
  const displayTitle = trimStr(sa.displayTitle);
  const languageCode = trimStr(sa.languageCode);
  const autoPublishOnProcessed =
    typeof sa.autoPublishOnProcessed === 'boolean' ? sa.autoPublishOnProcessed : undefined;
  const publishDate = trimStr(sa.publishDate);
  const crossPublish = normalizeSermonAudioCrossPublishSettings(sa.crossPublish);

  return {
    ...normalizePerPlatformCopyOverrides(sa),
    ...normalizeThumbnailOverrideFields(sa),
    ...(speakerName !== undefined ? { speakerName } : {}),
    ...(speakerID !== undefined ? { speakerID } : {}),
    ...(preachDate !== undefined ? { preachDate } : {}),
    ...(eventType !== undefined ? { eventType } : {}),
    ...(subtitle !== undefined ? { subtitle } : {}),
    ...(seriesID !== undefined ? { seriesID } : {}),
    ...(bibleText !== undefined ? { bibleText } : {}),
    ...(displayTitle !== undefined ? { displayTitle } : {}),
    ...(languageCode !== undefined ? { languageCode } : {}),
    ...(autoPublishOnProcessed !== undefined ? { autoPublishOnProcessed } : {}),
    ...(publishDate !== undefined ? { publishDate } : {}),
    ...(crossPublish !== undefined ? { crossPublish } : {}),
  };
}

/** Normalizes backup destination title override fields. */
function normalizeBackupTitleOverrideFields(
  value: Record<string, unknown>
): Pick<PerPlatformCopyOverrides, 'titleOverride'> {
  const titleOverride = trimStr(value.titleOverride);
  return {
    ...(titleOverride !== undefined ? { titleOverride } : {}),
  };
}

/** Backup destinations; preserve `{}` when sent by clients with no overrides. */
function normalizeGoogleDriveFields(value: Record<string, unknown>): GoogleDriveDraftFields {
  return normalizeBackupTitleOverrideFields(value);
}

/** Backup destinations; preserve `{}` when sent by clients with no overrides. */
function normalizeSftpFields(value: Record<string, unknown>): SftpDraftFields {
  return normalizeBackupTitleOverrideFields(value);
}

/** Backup destinations; preserve `{}` when sent by clients with no overrides. */
function normalizeSmbFields(value: Record<string, unknown>): SmbDraftFields {
  return normalizeBackupTitleOverrideFields(value);
}

/**
 * Executes normalize draft platforms.
 * @param value - Input value for value.
 * @returns The computed result.
 */
export function normalizeDraftPlatforms(value: unknown): DraftPlatforms {
  if (!isPlainObject(value)) return {};
  const out: DraftPlatforms = {};

  if (isPlainObject(value.youtube)) {
    const yb = normalizeYoutubeFields(value.youtube);
    out.youtube = Object.keys(yb).length > 0 ? yb : undefined;
  }

  if (isPlainObject(value.vimeo)) {
    const vm = normalizeVimeoFields(value.vimeo);
    out.vimeo = Object.keys(vm).length > 0 ? vm : undefined;
  }

  if (isPlainObject(value.sermon_audio)) {
    const sa = normalizeSermonAudioFields(value.sermon_audio);
    out.sermon_audio = Object.keys(sa).length > 0 ? sa : undefined;
  }

  if (isPlainObject(value.facebook)) {
    const fb = normalizeFacebookFields(value.facebook);
    out.facebook = Object.keys(fb).length > 0 ? fb : undefined;
  }

  if (isPlainObject(value.google_drive)) {
    const gd = normalizeGoogleDriveFields(value.google_drive);
    out.google_drive = Object.keys(gd).length > 0 ? gd : {};
  }

  if (isPlainObject(value.sftp)) {
    const sftp = normalizeSftpFields(value.sftp);
    out.sftp = Object.keys(sftp).length > 0 ? sftp : {};
  }

  if (isPlainObject(value.smb)) {
    const smb = normalizeSmbFields(value.smb);
    out.smb = Object.keys(smb).length > 0 ? smb : {};
  }

  return out;
}

/** Shape stored in the `document` column (JSON). */
export interface DraftDocumentStored {
  targets: readonly ConnectedAccountPlatform[];
  title: string;
  description: string;
  visibility: PlatformUploadVisibility;
  tags: string[];
  /** Organizational draft labels (VideoSphere-only; not sent to platforms). */
  labels: string[];
  platforms: DraftPlatforms;
  backupNaming?: BackupFileNameSettings;
  /** R2 key for draft thumbnail; omitted when unset. */
  thumbnailR2Key?: string;
  thumbnailContentType?: string;
  /**
   * When this draft was first used to create an upload job.
   * Stored in the draft `document` JSON to avoid an expensive usage scan.
   */
  usedInUploadAt?: string;
}

/**
 * Executes stringify draft document for storage.
 * @param d - Input value for d.
 * @returns The computed result.
 */
export function stringifyDraftDocumentForStorage(d: DraftDocumentStored): string {
  return JSON.stringify({
    targets: d.targets,
    title: d.title,
    description: d.description,
    visibility: d.visibility,
    tags: d.tags,
    ...(d.labels.length > 0 ? { labels: d.labels } : {}),
    platforms: d.platforms,
    ...(d.backupNaming !== undefined ? { backupNaming: d.backupNaming } : {}),
    ...(typeof d.thumbnailR2Key === 'string' && d.thumbnailR2Key.trim() !== ''
      ? {
          thumbnailR2Key: d.thumbnailR2Key.trim(),
          ...(typeof d.thumbnailContentType === 'string' && d.thumbnailContentType.trim() !== ''
            ? { thumbnailContentType: d.thumbnailContentType.trim() }
            : {}),
        }
      : {}),
    ...(typeof d.usedInUploadAt === 'string' && d.usedInUploadAt.trim() !== ''
      ? { usedInUploadAt: d.usedInUploadAt }
      : {}),
  });
}

function emptyDraftDocument(): DraftDocumentStored {
  return {
    targets: [],
    title: '',
    description: '',
    visibility: DEFAULT_DRAFT_VISIBILITY,
    tags: [],
    labels: [],
    platforms: {},
    backupNaming: normalizeBackupFileNameSettings(undefined),
  };
}

/** Parse `drafts.document` (current schema; tolerates legacy per-platform `tags`). */
export function draftDocumentFromRow(row: Record<string, unknown>): DraftDocumentStored {
  const raw = row.document;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return emptyDraftDocument();
  }
  try {
    const o = JSON.parse(raw) as unknown;
    if (!isPlainObject(o)) {
      return emptyDraftDocument();
    }
    const thumbKey =
      typeof o.thumbnailR2Key === 'string' && o.thumbnailR2Key.trim() !== ''
        ? o.thumbnailR2Key.trim()
        : undefined;
    const thumbType =
      typeof o.thumbnailContentType === 'string' && o.thumbnailContentType.trim() !== ''
        ? o.thumbnailContentType.trim()
        : undefined;
    return {
      targets: parseTargetsFromDocument(o.targets),
      title: typeof o.title === 'string' ? o.title : '',
      description: typeof o.description === 'string' ? o.description : '',
      visibility: visibilityFromRow(o.visibility),
      tags: tagsFromDocumentObject(o),
      labels: normalizeDraftLabelList(o.labels),
      platforms: normalizeDraftPlatforms(o.platforms),
      backupNaming: normalizeBackupFileNameSettings(o.backupNaming),
      ...(thumbKey !== undefined ? { thumbnailR2Key: thumbKey } : {}),
      ...(thumbType !== undefined ? { thumbnailContentType: thumbType } : {}),
      usedInUploadAt: typeof o.usedInUploadAt === 'string' ? o.usedInUploadAt : undefined,
    };
  } catch {
    return emptyDraftDocument();
  }
}

/**
 * Validate `targets` from POST/PATCH body: non-empty, known platforms only.
 */
export function parseDraftTargetsFromRequestBody(
  value: unknown
): { ok: true; value: ConnectedAccountPlatform[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'targets must be a non-empty array of platform ids' };
  }
  const platforms = value.filter(isConnectedAccountPlatform);
  const unique = [...new Set(platforms)];
  if (unique.length === 0) {
    return {
      ok: false,
      error: `targets must include at least one of: ${CONNECTED_ACCOUNT_PLATFORMS.join(', ')}`,
    };
  }
  return { ok: true, value: unique };
}

/** Targets for minimal draft creation or PATCH that allows an empty selection until save. */
export function parseDraftTargetsAllowEmpty(
  value: unknown
): { ok: true; value: ConnectedAccountPlatform[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'targets must be an array of platform ids' };
  }
  const platforms = value.filter(isConnectedAccountPlatform);
  if (platforms.length !== value.length) {
    return { ok: false, error: 'targets contains unknown platform ids' };
  }
  return { ok: true, value: [...new Set(platforms)] };
}

/** Optional `tags` array on API bodies: strings only; unknown entries dropped. */
export function parseTagsFromRequestBody(
  value: unknown
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) {
    return { ok: false, error: 'tags must be an array of strings' };
  }
  return { ok: true, value: value.filter((t): t is string => typeof t === 'string') };
}

/**
 * Validate optional `platforms` on **POST** bodies: trims strings, drops empties, full normalized snapshot.
 * For **PATCH**, use {@link parseDraftPlatformsPatchBody} so fields like `categoryUris: []` still reach
 * {@link mergeDraftPlatformsPatch} and can clear stored values.
 */
export function parsePlatformsFromRequestBody(
  value: unknown
): { ok: true; value: DraftPlatforms } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: {} };
  if (value === null) return { ok: true, value: {} };
  if (!isPlainObject(value)) {
    return { ok: false, error: 'platforms must be a JSON object' };
  }
  return { ok: true, value: normalizeDraftPlatforms(value) };
}

/**
 * Validate `platforms` on **PATCH** bodies: must be a plain object or `null` (treated as `{}`).
 * Returns the raw value (no `normalizeDraftPlatforms`) so merge semantics — including clearing
 * with empty strings — match {@link mergeDraftPlatformsPatch}.
 */
export function parseDraftPlatformsPatchBody(
  value: unknown
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (value === null || value === undefined) {
    return { ok: true, value: {} };
  }
  if (!isPlainObject(value)) {
    return { ok: false, error: 'platforms must be a JSON object' };
  }
  return { ok: true, value };
}

/**
 * Executes merge draft platforms.
 * @param base - Input value for base.
 * @param patch - Input value for patch.
 * @returns The computed result.
 */
export function mergeDraftPlatforms(base: DraftPlatforms, patch: DraftPlatforms): DraftPlatforms {
  const next: DraftPlatforms = { ...base };
  if (patch.youtube !== undefined) {
    next.youtube = { ...base.youtube, ...patch.youtube };
  }
  if (patch.vimeo !== undefined) {
    next.vimeo = { ...base.vimeo, ...patch.vimeo };
  }
  if (patch.sermon_audio !== undefined) {
    next.sermon_audio = { ...base.sermon_audio, ...patch.sermon_audio };
  }
  if (patch.google_drive !== undefined) {
    next.google_drive = { ...base.google_drive, ...patch.google_drive };
  }
  if (patch.sftp !== undefined) {
    next.sftp = { ...base.sftp, ...patch.sftp };
  }
  if (patch.smb !== undefined) {
    next.smb = { ...base.smb, ...patch.smb };
  }
  return next;
}

/**
 * Merge a partial `platforms` object from PATCH JSON into the stored shape.
 * Only keys present on the patch object update that field.
 */
export function mergeDraftPlatformsPatch(base: DraftPlatforms, patch: unknown): DraftPlatforms {
  if (!isPlainObject(patch)) return base;
  const next: DraftPlatforms = { ...base };

  if (isPlainObject(patch.youtube)) {
    const p = patch.youtube;
    const yb = { ...base.youtube };
    if ('categoryId' in p) {
      const c = p.categoryId;
      yb.categoryId = typeof c === 'string' && c.trim() !== '' ? c.trim() : undefined;
    }
    if ('madeForKids' in p) {
      yb.madeForKids = typeof p.madeForKids === 'boolean' ? p.madeForKids : undefined;
    }
    if ('defaultLanguage' in p) {
      const s = p.defaultLanguage;
      yb.defaultLanguage = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('defaultAudioLanguage' in p) {
      const s = p.defaultAudioLanguage;
      yb.defaultAudioLanguage = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('embeddable' in p) {
      yb.embeddable = typeof p.embeddable === 'boolean' ? p.embeddable : undefined;
    }
    if ('license' in p) {
      const lic = p.license;
      yb.license = lic === 'youtube' || lic === 'creativeCommon' ? lic : undefined;
    }
    if ('notifySubscribers' in p) {
      yb.notifySubscribers =
        typeof p.notifySubscribers === 'boolean' ? p.notifySubscribers : undefined;
    }
    if ('publishAt' in p) {
      const s = p.publishAt;
      yb.publishAt = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('recordingDate' in p) {
      const s = p.recordingDate;
      yb.recordingDate = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('isShort' in p) {
      yb.isShort = p.isShort === true ? true : undefined;
    }
    if ('playlistIds' in p) {
      if (Array.isArray(p.playlistIds)) {
        yb.playlistIds = p.playlistIds
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        yb.playlistIds = undefined;
      }
    }
    if ('playlistTitles' in p) {
      if (Array.isArray(p.playlistTitles)) {
        yb.playlistTitles = p.playlistTitles
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        yb.playlistTitles = undefined;
      }
    }
    if ('titleOverride' in p) {
      const s = p.titleOverride;
      yb.titleOverride = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('descriptionOverride' in p) {
      const s = p.descriptionOverride;
      yb.descriptionOverride = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('tagsOverride' in p) {
      if (Array.isArray(p.tagsOverride)) {
        yb.tagsOverride = p.tagsOverride
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        yb.tagsOverride = undefined;
      }
    }
    if ('visibilityOverride' in p) {
      const v = p.visibilityOverride;
      yb.visibilityOverride = isPlatformUploadVisibility(v) ? v : undefined;
    }
    next.youtube = applyThumbnailOverridePatch(yb, p);
  }

  if (isPlainObject(patch.vimeo)) {
    const p = patch.vimeo;
    const vm = { ...base.vimeo };
    if ('categoryUris' in p) {
      if (Array.isArray(p.categoryUris)) {
        const uris = uniqueTrimmedVimeoCategoryUris(p.categoryUris);
        vm.categoryUris = uris.length > 0 ? uris : undefined;
      } else {
        vm.categoryUris = undefined;
      }
    }
    if ('license' in p) {
      if (p.license === null) {
        vm.license = null;
      } else {
        const lic = trimStr(p.license);
        vm.license =
          lic && VIMEO_LICENSE.has(lic as VimeoVideoLicense)
            ? (lic as VimeoVideoLicense)
            : undefined;
      }
    }
    if ('contentRating' in p) {
      if (p.contentRating === null) {
        vm.contentRating = undefined;
      } else {
        vm.contentRating = normalizeVimeoContentRating(p.contentRating);
      }
    }
    if ('titleOverride' in p) {
      const s = p.titleOverride;
      vm.titleOverride = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('descriptionOverride' in p) {
      const s = p.descriptionOverride;
      vm.descriptionOverride = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('tagsOverride' in p) {
      if (Array.isArray(p.tagsOverride)) {
        vm.tagsOverride = p.tagsOverride
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        vm.tagsOverride = undefined;
      }
    }
    if ('visibilityOverride' in p) {
      const v = p.visibilityOverride;
      vm.visibilityOverride = isPlatformUploadVisibility(v) ? v : undefined;
    }
    next.vimeo = applyThumbnailOverridePatch(vm, p);
  }

  if (isPlainObject(patch.sermon_audio)) {
    const p = patch.sermon_audio;
    const sa = { ...base.sermon_audio };
    if ('speakerName' in p) {
      const s = p.speakerName;
      sa.speakerName = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('speakerID' in p) {
      const id = p.speakerID;
      sa.speakerID = typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : undefined;
    }
    if ('preachDate' in p) {
      const s = p.preachDate;
      sa.preachDate = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('eventType' in p) {
      const s = p.eventType;
      sa.eventType = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('subtitle' in p) {
      const s = p.subtitle;
      sa.subtitle = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
      if (!sa.subtitle && !('seriesID' in p)) {
        sa.seriesID = undefined;
      }
    }
    if ('seriesID' in p) {
      const id = p.seriesID;
      sa.seriesID = typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : undefined;
    }
    if ('bibleText' in p) {
      const s = p.bibleText;
      sa.bibleText = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('displayTitle' in p) {
      const s = p.displayTitle;
      sa.displayTitle = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('languageCode' in p) {
      const s = p.languageCode;
      sa.languageCode = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('autoPublishOnProcessed' in p) {
      sa.autoPublishOnProcessed =
        typeof p.autoPublishOnProcessed === 'boolean' ? p.autoPublishOnProcessed : undefined;
    }
    if ('publishDate' in p) {
      const s = p.publishDate;
      sa.publishDate = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('crossPublish' in p) {
      sa.crossPublish = normalizeSermonAudioCrossPublishSettings(p.crossPublish);
    }
    if ('titleOverride' in p) {
      const s = p.titleOverride;
      sa.titleOverride = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('descriptionOverride' in p) {
      const s = p.descriptionOverride;
      sa.descriptionOverride = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('tagsOverride' in p) {
      if (Array.isArray(p.tagsOverride)) {
        sa.tagsOverride = p.tagsOverride
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        sa.tagsOverride = undefined;
      }
    }
    next.sermon_audio = applyThumbnailOverridePatch(sa, p);
  }

  if (isPlainObject(patch.facebook)) {
    const p = patch.facebook;
    const fb = { ...base.facebook };
    if ('videoState' in p) {
      const vs = p.videoState;
      fb.videoState = vs === 'PUBLISHED' || vs === 'SCHEDULED' ? vs : undefined;
    }
    if ('scheduledPublishTime' in p) {
      const ts = p.scheduledPublishTime;
      fb.scheduledPublishTime =
        typeof ts === 'number' && Number.isFinite(ts) ? Math.floor(ts) : undefined;
    }
    if ('titleOverride' in p) {
      const s = p.titleOverride;
      fb.titleOverride = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('descriptionOverride' in p) {
      const s = p.descriptionOverride;
      fb.descriptionOverride = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    next.facebook = applyThumbnailOverridePatch(fb, p);
  }

  if (isPlainObject(patch.sftp)) {
    const p = patch.sftp;
    const sftp = { ...base.sftp };
    if ('titleOverride' in p) {
      const s = p.titleOverride;
      sftp.titleOverride = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    next.sftp = sftp;
  }

  if (isPlainObject(patch.smb)) {
    const p = patch.smb;
    const smb = { ...base.smb };
    if ('titleOverride' in p) {
      const s = p.titleOverride;
      smb.titleOverride = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    next.smb = smb;
  }

  if (isPlainObject(patch.google_drive)) {
    const p = patch.google_drive;
    const gd = { ...base.google_drive };
    if ('titleOverride' in p) {
      const s = p.titleOverride;
      gd.titleOverride = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    next.google_drive = gd;
  }

  return next;
}

function resolveDraftCopyForPlatform(
  draft: Draft,
  platformFields?: {
    titleOverride?: string;
    descriptionOverride?: string;
    tagsOverride?: string[];
    visibilityOverride?: PlatformUploadVisibility;
  }
): { title: string; description: string; tags: string[] } {
  const title = platformFields?.titleOverride?.trim() || draft.title.trim();
  const description = platformFields?.descriptionOverride?.trim() || draft.description.trim();
  const tagSource = platformFields?.tagsOverride ?? draft.tags;
  const tags = tagSource.map((t) => t.trim()).filter((t) => t.length > 0);
  return { title, description, tags };
}

function resolveVisibilityForPlatform(
  draft: Draft,
  platformFields?: { visibilityOverride?: PlatformUploadVisibility }
): PlatformUploadVisibility {
  return platformFields?.visibilityOverride ?? draft.visibility;
}

function resolveThumbnailForPlatform(
  draft: Draft,
  platformFields?: Pick<
    PerPlatformOverrides,
    'thumbnailR2KeyOverride' | 'thumbnailContentTypeOverride'
  >
): { thumbnailR2Key?: string; thumbnailContentType?: string } {
  if (platformFields && 'thumbnailR2KeyOverride' in platformFields) {
    const rawOverride = platformFields.thumbnailR2KeyOverride;
    if (rawOverride !== null && rawOverride !== undefined) {
      const overrideKey = rawOverride.trim();
      if (overrideKey === '') {
        return {};
      }
      const rawType = platformFields.thumbnailContentTypeOverride;
      const overrideType = typeof rawType === 'string' ? rawType.trim() : '';
      return {
        thumbnailR2Key: overrideKey,
        ...(overrideType ? { thumbnailContentType: overrideType } : {}),
      };
    }
  }
  const thumbnailR2Key = draft.thumbnailR2Key?.trim() || undefined;
  const thumbnailContentType = draft.thumbnailContentType?.trim() || undefined;
  return { thumbnailR2Key, thumbnailContentType };
}

function applyThumbnailOverridePatch<T extends PerPlatformOverrides>(
  fields: T,
  patch: Record<string, unknown>
): T {
  const next = { ...fields };
  if ('thumbnailR2KeyOverride' in patch) {
    const s = patch.thumbnailR2KeyOverride;
    if (typeof s === 'string') {
      const trimmed = s.trim();
      next.thumbnailR2KeyOverride = trimmed === '' ? '' : trimmed;
    } else {
      delete next.thumbnailR2KeyOverride;
    }
  }
  if ('thumbnailContentTypeOverride' in patch) {
    const s = patch.thumbnailContentTypeOverride;
    if (typeof s === 'string') {
      const trimmed = s.trim();
      next.thumbnailContentTypeOverride = trimmed === '' ? '' : trimmed;
    } else {
      delete next.thumbnailContentTypeOverride;
    }
  }
  return next;
}

/**
 * Executes build metadata for platform.
 * @param draft - Input value for draft.
 * @param platform - Input value for platform.
 * @returns The computed result.
 */
export function buildMetadataForPlatform(
  draft: Draft,
  platform: ConnectedAccountPlatform
): PlatformUploadMetadata {
  if (platform === 'youtube') {
    const yt = draft.platforms.youtube;
    const { title, description, tags } = resolveDraftCopyForPlatform(draft, yt);
    const visibility = resolveVisibilityForPlatform(draft, yt);
    const { thumbnailR2Key, thumbnailContentType } = resolveThumbnailForPlatform(draft, yt);
    const playlistTitles =
      yt?.playlistTitles !== undefined && yt.playlistTitles.length > 0
        ? uniqueTrimmedPlaylistTitles(yt.playlistTitles)
        : undefined;
    return {
      title,
      description,
      tags,
      visibility,
      thumbnailR2Key,
      thumbnailContentType,
      categoryId: yt?.categoryId?.trim() || undefined,
      madeForKids: yt?.madeForKids,
      defaultLanguage: yt?.defaultLanguage,
      defaultAudioLanguage: yt?.defaultAudioLanguage,
      embeddable: yt?.embeddable,
      license: yt?.license,
      notifySubscribers: yt?.notifySubscribers,
      publishAt: yt?.publishAt,
      recordingDate: yt?.recordingDate,
      playlistIds: yt?.playlistIds,
      ...(playlistTitles !== undefined && playlistTitles.length > 0 ? { playlistTitles } : {}),
      isShort: yt?.isShort,
    };
  }
  if (platform === 'vimeo') {
    const vm = draft.platforms.vimeo;
    const { title, description, tags } = resolveDraftCopyForPlatform(draft, vm);
    const visibility = resolveVisibilityForPlatform(draft, vm);
    const { thumbnailR2Key, thumbnailContentType } = resolveThumbnailForPlatform(draft, vm);
    return {
      title,
      description,
      tags,
      visibility,
      thumbnailR2Key,
      thumbnailContentType,
      vimeoCategoryUris:
        vm?.categoryUris && vm.categoryUris.length > 0
          ? vm.categoryUris.map((uri) => uri.trim()).filter(Boolean)
          : undefined,
      vimeo: vm,
    };
  }
  if (platform === 'sermon_audio') {
    const sa = draft.platforms.sermon_audio;
    const { title, description, tags } = resolveDraftCopyForPlatform(draft, sa);
    const keywords = formatSermonAudioKeywordsFromTags(tags);
    const visibility = draft.visibility;
    const { thumbnailR2Key, thumbnailContentType } = resolveThumbnailForPlatform(draft, sa);

    return {
      title,
      description,
      tags,
      visibility,
      thumbnailR2Key,
      thumbnailContentType,
      fullTitle: title,
      ...(sa?.displayTitle?.trim() ? { displayTitle: sa.displayTitle.trim() } : {}),
      ...(sa?.subtitle?.trim() ? { subtitle: sa.subtitle.trim() } : {}),
      ...(sa?.seriesID !== undefined ? { seriesID: sa.seriesID } : {}),
      ...(sa?.speakerName?.trim() ? { speakerName: sa.speakerName.trim() } : {}),
      ...(sa?.speakerID !== undefined ? { speakerID: sa.speakerID } : {}),
      ...(sa?.preachDate?.trim() ? { preachDate: sa.preachDate.trim() } : {}),
      ...(sa?.eventType?.trim() ? { eventType: sa.eventType.trim() } : {}),
      ...(sa?.bibleText?.trim() ? { bibleText: sa.bibleText.trim() } : {}),
      moreInfoText: description,
      keywords,
      ...(sa?.languageCode?.trim() ? { languageCode: sa.languageCode.trim() } : {}),
      acceptCopyright: true,
      autoPublishOnProcessed: resolveSermonAudioAutoPublishOnProcessed(sa),
      // TODO(sermon-audio-schedule): Include publishDate when SermonAudio API supports scheduling.
      ...(sa?.crossPublish !== undefined ? { crossPublish: sa.crossPublish } : {}),
    };
  }
  if (platform === 'facebook') {
    const fb = draft.platforms.facebook;
    const { title, description } = resolveDraftCopyForPlatform(draft, fb);
    const { thumbnailR2Key, thumbnailContentType } = resolveThumbnailForPlatform(draft, fb);
    return {
      title,
      description,
      tags: [],
      visibility: draft.visibility,
      thumbnailR2Key,
      thumbnailContentType,
      facebookVideoState: fb?.videoState,
      facebookScheduledPublishTime: fb?.scheduledPublishTime,
    };
  }

  if (platform === 'google_drive') {
    const gd = draft.platforms.google_drive;
    const { title, description, tags } = resolveDraftCopyForPlatform(draft, gd);
    const visibility = draft.visibility;
    const { thumbnailR2Key, thumbnailContentType } = resolveThumbnailForPlatform(draft);
    return {
      title,
      description,
      tags,
      visibility,
      thumbnailR2Key,
      thumbnailContentType,
      backupNaming: draft.backupNaming,
    };
  }

  if (platform === 'sftp') {
    const sftp = draft.platforms.sftp;
    const { title, description, tags } = resolveDraftCopyForPlatform(draft, sftp);
    const visibility = draft.visibility;
    const { thumbnailR2Key, thumbnailContentType } = resolveThumbnailForPlatform(draft);
    return {
      title,
      description,
      tags,
      visibility,
      thumbnailR2Key,
      thumbnailContentType,
      backupNaming: draft.backupNaming,
    };
  }

  if (platform === 'smb') {
    const smb = draft.platforms.smb;
    const { title, description, tags } = resolveDraftCopyForPlatform(draft, smb);
    const visibility = draft.visibility;
    const { thumbnailR2Key, thumbnailContentType } = resolveThumbnailForPlatform(draft);
    return {
      title,
      description,
      tags,
      visibility,
      thumbnailR2Key,
      thumbnailContentType,
      backupNaming: draft.backupNaming,
    };
  }

  const { title, description, tags } = resolveDraftCopyForPlatform(draft);
  const visibility = draft.visibility;
  const { thumbnailR2Key, thumbnailContentType } = resolveThumbnailForPlatform(draft);
  return {
    title,
    description,
    tags,
    visibility,
    thumbnailR2Key,
    thumbnailContentType,
    backupNaming: draft.backupNaming,
  };
}

/**
 * Validate optional `backupNaming` on POST/PATCH bodies.
 * @param value - Raw request body value.
 * @returns Parsed settings or an error message.
 */
export function parseBackupNamingFromRequestBody(
  value: unknown
): { ok: true; value: BackupFileNameSettings } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, value: normalizeBackupFileNameSettings(undefined) };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'backupNaming must be an object' };
  }
  return { ok: true, value: normalizeBackupFileNameSettings(value) };
}
