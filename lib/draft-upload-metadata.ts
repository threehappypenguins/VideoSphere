/**
 * Draft `document` JSON → per-platform upload metadata at distribute time.
 *
 * Stored shape:
 * - **Shared:** `targets`, `title`, `description`, `visibility`, `tags` (one list for all targets)
 * - **Per platform:** `platforms.youtube` / `platforms.vimeo` / `platforms.sermon_audio` (e.g. YouTube `categoryId`, Vimeo `categoryUri`, SermonAudio sermon fields);
 *   backup targets (`platforms.sftp` / `platforms.smb`) are carried through as empty objects until fields exist.
 */

import type { PlatformUploadMetadata } from '@/lib/platforms/types';
import { formatSermonAudioKeywordsFromTags } from '@/lib/platforms/sermon-audio-tags';
import { normalizeSermonAudioCrossPublishSettings } from '@/lib/platforms/sermon-audio-cross-publish';
import { uniqueTrimmedPlaylistTitles } from '@/lib/platforms/youtube';
import {
  CONNECTED_ACCOUNT_PLATFORMS,
  type ConnectedAccountPlatform,
  type Draft,
  type DraftPlatforms,
  type PlatformUploadVisibility,
  type VimeoDraftEmbed,
  type VimeoDraftPrivacy,
  type VimeoVideoLicense,
  type YouTubeDraftFields,
  type VimeoDraftFields,
  type PerPlatformCopyOverrides,
  type SermonAudioDraftFields,
  type SftpDraftFields,
  type SmbDraftFields,
} from '@/types';

/**
 * Defines the DEFAULT_DRAFT_VISIBILITY constant.
 */
export const DEFAULT_DRAFT_VISIBILITY: PlatformUploadVisibility = 'public';

/** Matches YouTube Data API `videos.snippet.title` maximum length. */
export const MAX_DRAFT_TITLE_LENGTH = 100;

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

function parseCoordinate(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    return undefined;
  }
  return v;
}

function stringList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter(Boolean);
  return out;
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

function normalizePerPlatformOverrideFields(
  o: Record<string, unknown>
): Pick<
  YouTubeDraftFields,
  'titleOverride' | 'descriptionOverride' | 'tagsOverride' | 'visibilityOverride'
> {
  const visibilityOverride = isPlatformUploadVisibility(o.visibilityOverride)
    ? o.visibilityOverride
    : undefined;

  return {
    ...normalizePerPlatformCopyOverrides(o),
    ...(visibilityOverride !== undefined ? { visibilityOverride } : {}),
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

const VIMEO_VIEW = new Set<string>([
  'anybody',
  'contacts',
  'disable',
  'nobody',
  'password',
  'unlisted',
  'users',
]);
const VIMEO_COMMENTS = new Set<string>(['anybody', 'contacts', 'nobody']);
const VIMEO_EMBED = new Set<string>(['private', 'public', 'whitelist']);
const TITLE_BAR = new Set<string>(['hide', 'show', 'user']);

function normalizeVimeoEmbed(e: unknown): VimeoDraftEmbed | undefined {
  if (!isPlainObject(e)) return undefined;
  const out: VimeoDraftEmbed = {};
  if (typeof e.playbar === 'boolean') out.playbar = e.playbar;
  if (typeof e.volume === 'boolean') out.volume = e.volume;
  if (isPlainObject(e.buttons)) {
    const b = e.buttons;
    const buttons: NonNullable<VimeoDraftEmbed['buttons']> = {};
    let anyBtn = false;
    for (const k of [
      'like',
      'share',
      'embed',
      'fullscreen',
      'hd',
      'watchlater',
      'scaling',
    ] as const) {
      if (typeof b[k] === 'boolean') {
        buttons[k] = b[k];
        anyBtn = true;
      }
    }
    if (anyBtn) out.buttons = buttons;
  }
  if (isPlainObject(e.title)) {
    const t = e.title;
    const title: NonNullable<VimeoDraftEmbed['title']> = {};
    let anyT = false;
    for (const k of ['name', 'owner', 'portrait'] as const) {
      const x = t[k];
      if (typeof x === 'string' && TITLE_BAR.has(x)) {
        title[k] = x as 'hide' | 'show' | 'user';
        anyT = true;
      }
    }
    if (anyT) out.title = title;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeVimeoPrivacy(p: unknown): VimeoDraftPrivacy | undefined {
  if (!isPlainObject(p)) return undefined;
  const out: VimeoDraftPrivacy = {};
  const view = trimStr(p.view);
  if (view && VIMEO_VIEW.has(view)) out.view = view as VimeoDraftPrivacy['view'];
  const comments = trimStr(p.comments);
  if (comments && VIMEO_COMMENTS.has(comments))
    out.comments = comments as VimeoDraftPrivacy['comments'];
  const embed = trimStr(p.embed);
  if (embed && VIMEO_EMBED.has(embed)) out.embed = embed as VimeoDraftPrivacy['embed'];
  if (p.download === true) out.download = true;
  if (typeof p.add === 'boolean') out.add = p.add;
  return Object.keys(out).length > 0 ? out : undefined;
}

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
  };
}

function normalizeVimeoFields(v: Record<string, unknown>): VimeoDraftFields {
  const categoryUri = trimStr(v.categoryUri);
  const licRaw = trimStr(v.license);
  const license =
    licRaw && VIMEO_LICENSE.has(licRaw as VimeoVideoLicense)
      ? (licRaw as VimeoVideoLicense)
      : undefined;
  const locale = trimStr(v.locale);
  const contentRating = stringList(v.contentRating);
  const password = trimStr(v.password);
  const reviewPage =
    isPlainObject(v.reviewPage) && typeof v.reviewPage.active === 'boolean'
      ? { active: v.reviewPage.active }
      : undefined;
  const privacy = normalizeVimeoPrivacy(v.privacy);
  const embed = normalizeVimeoEmbed(v.embed);

  return {
    ...normalizePerPlatformOverrideFields(v),
    ...(categoryUri !== undefined ? { categoryUri } : {}),
    ...(license !== undefined ? { license } : {}),
    ...(locale !== undefined ? { locale } : {}),
    ...(contentRating !== undefined && contentRating.length > 0 ? { contentRating } : {}),
    ...(password !== undefined ? { password } : {}),
    ...(reviewPage !== undefined ? { reviewPage } : {}),
    ...(privacy !== undefined ? { privacy } : {}),
    ...(embed !== undefined ? { embed } : {}),
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
  const crossPublish = normalizeSermonAudioCrossPublishSettings(sa.crossPublish);

  return {
    ...normalizePerPlatformCopyOverrides(sa),
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
    ...(crossPublish !== undefined ? { crossPublish } : {}),
  };
}

/** Backup destinations with no publish-specific fields yet; preserve `{}` when sent by clients. */
function normalizeSftpFields(_value: Record<string, unknown>): SftpDraftFields {
  return {};
}

/** Backup destinations with no publish-specific fields yet; preserve `{}` when sent by clients. */
function normalizeSmbFields(_value: Record<string, unknown>): SmbDraftFields {
  return {};
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

  if (isPlainObject(value.sftp)) {
    out.sftp = normalizeSftpFields(value.sftp);
  }

  if (isPlainObject(value.smb)) {
    out.smb = normalizeSmbFields(value.smb);
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
  platforms: DraftPlatforms;
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
    platforms: d.platforms,
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

const EMPTY_DOC: DraftDocumentStored = {
  targets: [],
  title: '',
  description: '',
  visibility: DEFAULT_DRAFT_VISIBILITY,
  tags: [],
  platforms: {},
};

/** Parse `drafts.document` (current schema; tolerates legacy per-platform `tags`). */
export function draftDocumentFromRow(row: Record<string, unknown>): DraftDocumentStored {
  const raw = row.document;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ...EMPTY_DOC };
  }
  try {
    const o = JSON.parse(raw) as unknown;
    if (!isPlainObject(o)) {
      return { ...EMPTY_DOC };
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
      platforms: normalizeDraftPlatforms(o.platforms),
      ...(thumbKey !== undefined ? { thumbnailR2Key: thumbKey } : {}),
      ...(thumbType !== undefined ? { thumbnailContentType: thumbType } : {}),
      usedInUploadAt: typeof o.usedInUploadAt === 'string' ? o.usedInUploadAt : undefined,
    };
  } catch {
    return { ...EMPTY_DOC };
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
 * For **PATCH**, use {@link parseDraftPlatformsPatchBody} so fields like `categoryUri: ""` still reach
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
    next.youtube = yb;
  }

  if (isPlainObject(patch.vimeo)) {
    const p = patch.vimeo;
    const vm = { ...base.vimeo };
    if ('categoryUri' in p) {
      const u = p.categoryUri;
      vm.categoryUri = typeof u === 'string' && u.trim() !== '' ? u.trim() : undefined;
    }
    if ('license' in p) {
      const lic = trimStr(p.license);
      vm.license =
        lic && VIMEO_LICENSE.has(lic as VimeoVideoLicense) ? (lic as VimeoVideoLicense) : undefined;
    }
    if ('locale' in p) {
      const s = p.locale;
      vm.locale = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('contentRating' in p) {
      vm.contentRating = Array.isArray(p.contentRating)
        ? p.contentRating
            .filter((x): x is string => typeof x === 'string')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
    }
    if ('password' in p) {
      const s = p.password;
      vm.password = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('reviewPage' in p) {
      vm.reviewPage =
        isPlainObject(p.reviewPage) && typeof p.reviewPage.active === 'boolean'
          ? { active: p.reviewPage.active }
          : undefined;
    }
    if ('privacy' in p) {
      vm.privacy = normalizeVimeoPrivacy(p.privacy);
    }
    if ('embed' in p) {
      vm.embed = normalizeVimeoEmbed(p.embed);
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
    next.vimeo = vm;
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
    next.sermon_audio = sa;
  }

  if (isPlainObject(patch.sftp)) {
    next.sftp = { ...base.sftp, ...normalizeSftpFields(patch.sftp) };
  }

  if (isPlainObject(patch.smb)) {
    next.smb = { ...base.smb, ...normalizeSmbFields(patch.smb) };
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
  const thumbnailR2Key = draft.thumbnailR2Key?.trim() || undefined;
  const thumbnailContentType = draft.thumbnailContentType?.trim() || undefined;

  if (platform === 'youtube') {
    const yt = draft.platforms.youtube;
    const { title, description, tags } = resolveDraftCopyForPlatform(draft, yt);
    const visibility = resolveVisibilityForPlatform(draft, yt);
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
    };
  }
  if (platform === 'vimeo') {
    const vm = draft.platforms.vimeo;
    const { title, description, tags } = resolveDraftCopyForPlatform(draft, vm);
    const visibility = resolveVisibilityForPlatform(draft, vm);
    return {
      title,
      description,
      tags,
      visibility,
      thumbnailR2Key,
      thumbnailContentType,
      vimeoCategoryUri: vm?.categoryUri?.trim() || undefined,
      vimeo: vm,
    };
  }
  if (platform === 'sermon_audio') {
    const sa = draft.platforms.sermon_audio;
    const { title, description, tags } = resolveDraftCopyForPlatform(draft, sa);
    const keywords = formatSermonAudioKeywordsFromTags(tags);
    const visibility = draft.visibility;

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
      ...(sa?.crossPublish !== undefined ? { crossPublish: sa.crossPublish } : {}),
    };
  }

  const { title, description, tags } = resolveDraftCopyForPlatform(draft);
  const visibility = draft.visibility;
  return {
    title,
    description,
    tags,
    visibility,
    thumbnailR2Key,
    thumbnailContentType,
  };
}
