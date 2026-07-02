// =============================================================================
// LIVESTREAM REPOSITORY
// =============================================================================
// All livestream (scheduled broadcast metadata) data access goes through this
// module. API routes and Server Components should call these functions only.
//
// Uses Mongoose for the livestreams collection.
// =============================================================================

import { randomUUID } from 'crypto';
import type {
  ConnectedAccountPlatform,
  Livestream,
  LivestreamKeySlot,
  LivestreamPlatforms,
  LivestreamStatus,
  PlatformUploadVisibility,
} from '@/types';
import { normalizeAutoPromoteToMainKeyMinutes } from '@/lib/livestreams/auto-promote-main-key';
import {
  encryptFacebookStreamUrlForStorage,
  readFacebookStreamUrlFromStorage,
} from '@/lib/livestreams/facebook-stream-url-storage';
import { mergeLivestreamPlatformsPatch } from '@/lib/livestream-upload-metadata';
import { connectToDatabase } from '@/lib/mongodb';
import { LivestreamModel, type LivestreamDocument } from '@/lib/models/Livestream';
import {
  filterStreamedLivestreams,
  filterYoutubeImportLivestreams,
  paginateLivestreams,
} from '@/lib/livestreams/livestream-list-filters';

/** Default visibility for new livestreams when omitted at creation. */
export const DEFAULT_LIVESTREAM_VISIBILITY: PlatformUploadVisibility = 'public';

/** String column max; entire `document` must serialize under this. */
export const MAX_LIVESTREAM_DOCUMENT_CHARS = 16_383;

const ARMED_LIVESTREAM_STATUSES = new Set<LivestreamStatus>(['scheduled', 'live']);

/**
 * JSON payload stored in the livestreams `document` column.
 * @property status - Livestream lifecycle status.
 * @property title - Shared title for distribution targets.
 * @property description - Shared description for distribution targets.
 * @property tags - Shared tag list for distribution targets.
 * @property visibility - Shared visibility for distribution targets.
 * @property targets - Platform toggles for this livestream.
 * @property platforms - Per-platform-only metadata.
 */
interface StoredLivestreamDocument {
  status: LivestreamStatus;
  title: string;
  description: string;
  tags: string[];
  visibility: PlatformUploadVisibility;
  targets: ConnectedAccountPlatform[];
  platforms: LivestreamPlatforms;
  scheduledStartTime?: string;
  scheduledStartTimeZone?: string;
  thumbnailR2Key?: string;
  thumbnailContentType?: string;
  youtubeBroadcastId?: string;
  youtubeBoundStreamId?: string;
  keySlot?: LivestreamKeySlot;
  keySwapPromotedAt?: string;
  keySlotStaleAt?: string;
  autoPromoteToMainKey?: boolean;
  autoPromoteToMainKeyMinutes?: number;
  youtubeLifecycleStatus?: string;
  facebookLiveVideoId?: string;
  /** Encrypted Facebook RTMPS ingest URL at rest (see {@link encryptFacebookStreamUrlForStorage}). */
  facebookStreamUrl?: string;
  facebookArmedAt?: string;
  facebookLifecycleStatus?: string;
}

/**
 * Throws when serialized livestream JSON exceeds the Mongo column limit.
 */
export class LivestreamDocumentTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LivestreamDocumentTooLargeError';
  }
}

function assertLivestreamDocumentJsonWithinLimit(json: string): void {
  if (json.length > MAX_LIVESTREAM_DOCUMENT_CHARS) {
    throw new LivestreamDocumentTooLargeError(
      `Livestream document JSON is ${json.length} characters; storage allows at most ${MAX_LIVESTREAM_DOCUMENT_CHARS} in the document column.`
    );
  }
}

function parseStoredLivestreamDocument(
  raw: string,
  livestreamId = 'unknown'
): StoredLivestreamDocument {
  const parsed = JSON.parse(raw) as Partial<StoredLivestreamDocument>;
  const facebookStreamUrl =
    typeof parsed.facebookStreamUrl === 'string' && parsed.facebookStreamUrl.trim() !== ''
      ? readFacebookStreamUrlFromStorage(parsed.facebookStreamUrl, livestreamId)
      : undefined;
  return {
    status: parsed.status ?? 'draft',
    title: typeof parsed.title === 'string' ? parsed.title : '',
    description: typeof parsed.description === 'string' ? parsed.description : '',
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    visibility:
      parsed.visibility === 'public' ||
      parsed.visibility === 'unlisted' ||
      parsed.visibility === 'private'
        ? parsed.visibility
        : DEFAULT_LIVESTREAM_VISIBILITY,
    targets: Array.isArray(parsed.targets)
      ? parsed.targets.filter(
          (target): target is ConnectedAccountPlatform => typeof target === 'string'
        )
      : [],
    platforms: parsed.platforms && typeof parsed.platforms === 'object' ? parsed.platforms : {},
    ...(typeof parsed.scheduledStartTime === 'string' && parsed.scheduledStartTime.trim() !== ''
      ? { scheduledStartTime: parsed.scheduledStartTime.trim() }
      : {}),
    ...(typeof parsed.scheduledStartTimeZone === 'string' &&
    parsed.scheduledStartTimeZone.trim() !== ''
      ? { scheduledStartTimeZone: parsed.scheduledStartTimeZone.trim() }
      : {}),
    ...(typeof parsed.thumbnailR2Key === 'string' && parsed.thumbnailR2Key.trim() !== ''
      ? { thumbnailR2Key: parsed.thumbnailR2Key.trim() }
      : {}),
    ...(typeof parsed.thumbnailContentType === 'string' && parsed.thumbnailContentType.trim() !== ''
      ? { thumbnailContentType: parsed.thumbnailContentType.trim() }
      : {}),
    ...(typeof parsed.youtubeBroadcastId === 'string' && parsed.youtubeBroadcastId.trim() !== ''
      ? { youtubeBroadcastId: parsed.youtubeBroadcastId.trim() }
      : {}),
    ...(typeof parsed.youtubeBoundStreamId === 'string' && parsed.youtubeBoundStreamId.trim() !== ''
      ? { youtubeBoundStreamId: parsed.youtubeBoundStreamId.trim() }
      : {}),
    ...(parsed.keySlot === 'main' || parsed.keySlot === 'temp' ? { keySlot: parsed.keySlot } : {}),
    ...(typeof parsed.keySwapPromotedAt === 'string' && parsed.keySwapPromotedAt.trim() !== ''
      ? { keySwapPromotedAt: parsed.keySwapPromotedAt.trim() }
      : {}),
    ...(typeof parsed.keySlotStaleAt === 'string' && parsed.keySlotStaleAt.trim() !== ''
      ? { keySlotStaleAt: parsed.keySlotStaleAt.trim() }
      : {}),
    ...(parsed.autoPromoteToMainKey === true || parsed.autoPromoteToMainKey === false
      ? { autoPromoteToMainKey: parsed.autoPromoteToMainKey }
      : {}),
    ...(typeof parsed.autoPromoteToMainKeyMinutes === 'number'
      ? {
          autoPromoteToMainKeyMinutes: normalizeAutoPromoteToMainKeyMinutes(
            parsed.autoPromoteToMainKeyMinutes
          ),
        }
      : {}),
    ...(typeof parsed.youtubeLifecycleStatus === 'string' &&
    parsed.youtubeLifecycleStatus.trim() !== ''
      ? { youtubeLifecycleStatus: parsed.youtubeLifecycleStatus.trim() }
      : {}),
    ...(typeof parsed.facebookLiveVideoId === 'string' && parsed.facebookLiveVideoId.trim() !== ''
      ? { facebookLiveVideoId: parsed.facebookLiveVideoId.trim() }
      : {}),
    ...(facebookStreamUrl ? { facebookStreamUrl } : {}),
    ...(typeof parsed.facebookArmedAt === 'string' && parsed.facebookArmedAt.trim() !== ''
      ? { facebookArmedAt: parsed.facebookArmedAt.trim() }
      : {}),
    ...(typeof parsed.facebookLifecycleStatus === 'string' &&
    parsed.facebookLifecycleStatus.trim() !== ''
      ? { facebookLifecycleStatus: parsed.facebookLifecycleStatus.trim() }
      : {}),
  };
}

function stringifyLivestreamDocumentForStorage(doc: StoredLivestreamDocument): string {
  return JSON.stringify(doc);
}

function storedDocumentFromLivestream(livestream: Livestream): StoredLivestreamDocument {
  return {
    status: livestream.status,
    title: livestream.title,
    description: livestream.description,
    tags: livestream.tags,
    visibility: livestream.visibility,
    targets: [...livestream.targets],
    platforms: livestream.platforms,
    ...(livestream.scheduledStartTime ? { scheduledStartTime: livestream.scheduledStartTime } : {}),
    ...(livestream.scheduledStartTimeZone
      ? { scheduledStartTimeZone: livestream.scheduledStartTimeZone }
      : {}),
    ...(livestream.thumbnailR2Key ? { thumbnailR2Key: livestream.thumbnailR2Key } : {}),
    ...(livestream.thumbnailContentType
      ? { thumbnailContentType: livestream.thumbnailContentType }
      : {}),
    ...(livestream.youtubeBroadcastId ? { youtubeBroadcastId: livestream.youtubeBroadcastId } : {}),
    ...(livestream.youtubeBoundStreamId
      ? { youtubeBoundStreamId: livestream.youtubeBoundStreamId }
      : {}),
    ...(livestream.keySlot ? { keySlot: livestream.keySlot } : {}),
    ...(livestream.keySwapPromotedAt ? { keySwapPromotedAt: livestream.keySwapPromotedAt } : {}),
    ...(livestream.keySlotStaleAt ? { keySlotStaleAt: livestream.keySlotStaleAt } : {}),
    ...(livestream.autoPromoteToMainKey === true || livestream.autoPromoteToMainKey === false
      ? { autoPromoteToMainKey: livestream.autoPromoteToMainKey }
      : {}),
    ...(livestream.autoPromoteToMainKeyMinutes != null
      ? {
          autoPromoteToMainKeyMinutes: normalizeAutoPromoteToMainKeyMinutes(
            livestream.autoPromoteToMainKeyMinutes
          ),
        }
      : {}),
    ...(livestream.youtubeLifecycleStatus
      ? { youtubeLifecycleStatus: livestream.youtubeLifecycleStatus }
      : {}),
    ...(livestream.facebookLiveVideoId
      ? { facebookLiveVideoId: livestream.facebookLiveVideoId }
      : {}),
    ...(livestream.facebookStreamUrl
      ? { facebookStreamUrl: encryptFacebookStreamUrlForStorage(livestream.facebookStreamUrl) }
      : {}),
    ...(livestream.facebookArmedAt ? { facebookArmedAt: livestream.facebookArmedAt } : {}),
    ...(livestream.facebookLifecycleStatus
      ? { facebookLifecycleStatus: livestream.facebookLifecycleStatus }
      : {}),
  };
}

/** Map a MongoDB document to the shared Livestream type. */
function mongoDocToLivestream(doc: LivestreamDocument): Livestream {
  const parsed = parseStoredLivestreamDocument(doc.document, String(doc._id));
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    status: parsed.status,
    title: parsed.title,
    description: parsed.description,
    tags: parsed.tags,
    visibility: parsed.visibility,
    targets: parsed.targets,
    platforms: parsed.platforms,
    ...(parsed.scheduledStartTime ? { scheduledStartTime: parsed.scheduledStartTime } : {}),
    ...(parsed.scheduledStartTimeZone
      ? { scheduledStartTimeZone: parsed.scheduledStartTimeZone }
      : {}),
    ...(parsed.thumbnailR2Key ? { thumbnailR2Key: parsed.thumbnailR2Key } : {}),
    ...(parsed.thumbnailContentType ? { thumbnailContentType: parsed.thumbnailContentType } : {}),
    ...(parsed.youtubeBroadcastId ? { youtubeBroadcastId: parsed.youtubeBroadcastId } : {}),
    ...(parsed.youtubeBoundStreamId ? { youtubeBoundStreamId: parsed.youtubeBoundStreamId } : {}),
    ...(parsed.keySlot ? { keySlot: parsed.keySlot } : {}),
    ...(parsed.keySwapPromotedAt ? { keySwapPromotedAt: parsed.keySwapPromotedAt } : {}),
    ...(parsed.keySlotStaleAt ? { keySlotStaleAt: parsed.keySlotStaleAt } : {}),
    ...(parsed.autoPromoteToMainKey === true || parsed.autoPromoteToMainKey === false
      ? { autoPromoteToMainKey: parsed.autoPromoteToMainKey }
      : {}),
    ...(parsed.autoPromoteToMainKeyMinutes != null
      ? { autoPromoteToMainKeyMinutes: parsed.autoPromoteToMainKeyMinutes }
      : {}),
    ...(parsed.youtubeLifecycleStatus
      ? { youtubeLifecycleStatus: parsed.youtubeLifecycleStatus }
      : {}),
    ...(parsed.facebookLiveVideoId ? { facebookLiveVideoId: parsed.facebookLiveVideoId } : {}),
    ...(parsed.facebookStreamUrl ? { facebookStreamUrl: parsed.facebookStreamUrl } : {}),
    ...(parsed.facebookArmedAt ? { facebookArmedAt: parsed.facebookArmedAt } : {}),
    ...(parsed.facebookLifecycleStatus
      ? { facebookLifecycleStatus: parsed.facebookLifecycleStatus }
      : {}),
    $createdAt: new Date(doc.createdAt).toISOString(),
    $updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

function isArmedYouTubeLivestream(livestream: Livestream): boolean {
  return (
    livestream.targets.includes('youtube') &&
    ARMED_LIVESTREAM_STATUSES.has(livestream.status) &&
    livestream.keySlot != null
  );
}

function isArmedFacebookLivestream(livestream: Livestream): boolean {
  return (
    livestream.targets.includes('facebook') &&
    ARMED_LIVESTREAM_STATUSES.has(livestream.status) &&
    Boolean(livestream.facebookLiveVideoId?.trim())
  );
}

function isScheduledOrLiveFacebookLivestream(livestream: Livestream): boolean {
  return (
    livestream.targets.includes('facebook') && ARMED_LIVESTREAM_STATUSES.has(livestream.status)
  );
}

function isPendingFacebookDeferredArm(livestream: Livestream): boolean {
  if (livestream.status !== 'scheduled' || !livestream.targets.includes('facebook')) {
    return false;
  }
  if (livestream.facebookLiveVideoId?.trim()) {
    return false;
  }
  if (livestream.autoPromoteToMainKey === false) {
    return false;
  }
  return livestream.autoPromoteToMainKey === true || livestream.autoPromoteToMainKeyMinutes != null;
}

function compareScheduledStartAsc(a: Livestream, b: Livestream): number {
  const aMs = Date.parse(a.scheduledStartTime ?? '');
  const bMs = Date.parse(b.scheduledStartTime ?? '');
  const aTime = Number.isNaN(aMs) ? Number.POSITIVE_INFINITY : aMs;
  const bTime = Number.isNaN(bMs) ? Number.POSITIVE_INFINITY : bMs;
  return aTime - bTime;
}

function compareFacebookArmedAtDesc(a: Livestream, b: Livestream): number {
  const aMs = Date.parse(a.facebookArmedAt ?? '');
  const bMs = Date.parse(b.facebookArmedAt ?? '');
  const aTime = Number.isNaN(aMs) ? Number.NEGATIVE_INFINITY : aMs;
  const bTime = Number.isNaN(bMs) ? Number.NEGATIVE_INFINITY : bMs;
  return bTime - aTime;
}

async function listLivestreamsForUser(userId: string): Promise<Livestream[]> {
  await connectToDatabase();
  const docs = await LivestreamModel.find({ userId }).lean<LivestreamDocument[]>();
  return docs.map(mongoDocToLivestream);
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

/**
 * Fields for creating a new livestream draft row.
 */
export interface CreateLivestreamFields {
  title: string;
  description: string;
  tags?: string[];
  visibility?: PlatformUploadVisibility;
  targets: ConnectedAccountPlatform[];
  platforms?: LivestreamPlatforms;
  scheduledStartTime?: string;
  scheduledStartTimeZone?: string;
  thumbnailR2Key?: string;
  thumbnailContentType?: string;
}

/**
 * Creates a new livestream in `draft` status without a schedule time or key slot.
 * @param userId - Owner user id.
 * @param fields - Initial livestream metadata.
 * @returns Persisted livestream row.
 */
export async function createLivestream(
  userId: string,
  fields: CreateLivestreamFields
): Promise<Livestream> {
  const documentJson = stringifyLivestreamDocumentForStorage({
    status: 'draft',
    title: fields.title,
    description: fields.description,
    tags: fields.tags ?? [],
    visibility: fields.visibility ?? DEFAULT_LIVESTREAM_VISIBILITY,
    targets: fields.targets,
    platforms: fields.platforms ?? {},
    ...(fields.scheduledStartTime ? { scheduledStartTime: fields.scheduledStartTime } : {}),
    ...(fields.scheduledStartTimeZone
      ? { scheduledStartTimeZone: fields.scheduledStartTimeZone }
      : {}),
    ...(fields.thumbnailR2Key ? { thumbnailR2Key: fields.thumbnailR2Key } : {}),
    ...(fields.thumbnailContentType ? { thumbnailContentType: fields.thumbnailContentType } : {}),
  });
  assertLivestreamDocumentJsonWithinLimit(documentJson);

  await connectToDatabase();
  const created = await LivestreamModel.create({
    _id: randomUUID(),
    userId,
    document: documentJson,
  });
  return mongoDocToLivestream(created.toObject());
}

// -----------------------------------------------------------------------------
// Read
// -----------------------------------------------------------------------------

/**
 * Fetch a livestream by ID. Returns null if not found.
 * @param id - Livestream row id.
 * @returns Livestream row, or null when missing.
 */
export async function getLivestreamById(id: string): Promise<Livestream | null> {
  await connectToDatabase();
  const doc = await LivestreamModel.findById(id).lean<LivestreamDocument | null>();
  if (!doc) return null;
  return mongoDocToLivestream(doc);
}

/**
 * Lists livestreams for a user, sorted by most recently updated first.
 * @param userId - Owner user id.
 * @returns Livestream rows for the user.
 */
export async function listLivestreamsByUser(userId: string): Promise<Livestream[]> {
  await connectToDatabase();
  const docs = await LivestreamModel.find({ userId })
    .sort({ updatedAt: -1 })
    .lean<LivestreamDocument[]>();
  return docs.map(mongoDocToLivestream);
}

/**
 * Counts streamed livestreams (ended or failed) for a user.
 * @param userId - Owner user id.
 * @returns Total streamed livestream count.
 */
export async function countStreamedLivestreamsByUser(userId: string): Promise<number> {
  const livestreams = await listLivestreamsByUser(userId);
  return filterStreamedLivestreams(livestreams).length;
}

/**
 * Lists a paginated page of streamed livestreams for a user, most recently updated first.
 * @param userId - Owner user id.
 * @param options - Pagination options.
 * @param options.limit - Maximum rows to return.
 * @param options.offset - Number of rows to skip.
 * @returns Streamed livestream rows for the requested page.
 */
export async function listStreamedLivestreamsByUserPage(
  userId: string,
  options: { limit: number; offset: number }
): Promise<Livestream[]> {
  const livestreams = await listLivestreamsByUser(userId);
  return paginateLivestreams(filterStreamedLivestreams(livestreams), options.offset, options.limit);
}

/**
 * Counts past YouTube livestreams that can be used as import sources.
 * @param userId - Owner user id.
 * @returns Total importable YouTube livestream count.
 */
export async function countYoutubeImportLivestreamsByUser(userId: string): Promise<number> {
  const livestreams = await listLivestreamsByUser(userId);
  return filterYoutubeImportLivestreams(livestreams).length;
}

/**
 * Lists a paginated page of YouTube-importable livestreams for a user.
 * @param userId - Owner user id.
 * @param options - Pagination options.
 * @param options.limit - Maximum rows to return.
 * @param options.offset - Number of rows to skip.
 * @returns Importable YouTube livestream rows for the requested page.
 */
export async function listYoutubeImportLivestreamsByUserPage(
  userId: string,
  options: { limit: number; offset: number }
): Promise<Livestream[]> {
  const livestreams = await listLivestreamsByUser(userId);
  return paginateLivestreams(
    filterYoutubeImportLivestreams(livestreams),
    options.offset,
    options.limit
  );
}

/**
 * Returns armed YouTube livestreams for a user (holding a key slot, scheduled or live).
 * @param userId - Owner user id.
 * @returns Armed livestreams ordered by scheduled start time ascending.
 */
export async function listArmedYouTubeLivestreamsForUser(userId: string): Promise<Livestream[]> {
  const livestreams = await listLivestreamsForUser(userId);
  return livestreams.filter(isArmedYouTubeLivestream).sort(compareScheduledStartAsc);
}

/**
 * Returns the armed livestream currently holding the main key slot, if any.
 * @param userId - Owner user id.
 * @returns Main-slot livestream, or null when none is armed.
 */
export async function getArmedMainSlotLivestreamForUser(
  userId: string
): Promise<Livestream | null> {
  const armed = await listArmedYouTubeLivestreamsForUser(userId);
  return armed.find((livestream) => livestream.keySlot === 'main') ?? null;
}

/**
 * Returns the armed Facebook livestream for a user, if any.
 * At most one row should exist; when multiple match, returns the most recently armed.
 * @param userId - Owner user id.
 * @returns Armed Facebook livestream, or null when none is armed.
 */
export async function getArmedFacebookLivestreamForUser(
  userId: string
): Promise<Livestream | null> {
  const livestreams = await listLivestreamsForUser(userId);
  const armed = livestreams.filter(isArmedFacebookLivestream);
  if (armed.length === 0) {
    return null;
  }
  if (armed.length === 1) {
    return armed[0]!;
  }
  return [...armed].sort(compareFacebookArmedAtDesc)[0] ?? null;
}

/**
 * Returns scheduled or live Facebook-targeted livestreams for a user.
 * @param userId - Owner user id.
 * @param excludeLivestreamId - Optional livestream id to omit (for new schedule decisions).
 * @returns Rows ordered by scheduled start time ascending.
 */
export async function listScheduledOrLiveFacebookLivestreamsForUser(
  userId: string,
  excludeLivestreamId?: string
): Promise<Livestream[]> {
  const livestreams = await listLivestreamsForUser(userId);
  return livestreams
    .filter(isScheduledOrLiveFacebookLivestream)
    .filter((livestream) => livestream.id !== excludeLivestreamId)
    .sort(compareScheduledStartAsc);
}

/**
 * Returns scheduled Facebook livestreams waiting for deferred LiveVideo creation.
 * @param userId - Owner user id.
 * @returns Pending rows ordered by scheduled start time ascending.
 */
export async function listPendingFacebookDeferredArmsForUser(
  userId: string
): Promise<Livestream[]> {
  const livestreams = await listLivestreamsForUser(userId);
  return livestreams.filter(isPendingFacebookDeferredArm).sort(compareScheduledStartAsc);
}

/**
 * Returns all queued Facebook livestreams awaiting deferred arm, grouped by owner id.
 * Each user's list is ordered by scheduled start time ascending.
 * @returns Map of user id to pending deferred-arm rows for that user.
 */
export async function listAllPendingFacebookDeferredArms(): Promise<Map<string, Livestream[]>> {
  await connectToDatabase();
  const docs = await LivestreamModel.find({}).lean<LivestreamDocument[]>();
  const grouped = new Map<string, Livestream[]>();

  for (const doc of docs) {
    const livestream = mongoDocToLivestream(doc);
    if (!isPendingFacebookDeferredArm(livestream)) continue;
    const existing = grouped.get(livestream.userId) ?? [];
    existing.push(livestream);
    grouped.set(livestream.userId, existing);
  }

  for (const [userId, livestreams] of grouped) {
    livestreams.sort(compareScheduledStartAsc);
    grouped.set(userId, livestreams);
  }

  return grouped;
}

/**
 * Returns armed temp-slot livestreams for a user, ordered by scheduled start ascending.
 * @param userId - Owner user id.
 * @returns Temp-slot livestreams queued for promotion.
 */
export async function listArmedTempSlotLivestreamsForUser(userId: string): Promise<Livestream[]> {
  const armed = await listArmedYouTubeLivestreamsForUser(userId);
  return armed.filter((livestream) => livestream.keySlot === 'temp');
}

/**
 * Returns all armed YouTube livestreams across every user, grouped by owner id.
 * Each user's list is ordered by scheduled start time ascending.
 * @returns Map of user id to armed livestream rows for that user.
 */
export async function listAllArmedYouTubeLivestreams(): Promise<Map<string, Livestream[]>> {
  await connectToDatabase();
  const docs = await LivestreamModel.find({}).lean<LivestreamDocument[]>();
  const grouped = new Map<string, Livestream[]>();

  for (const doc of docs) {
    const livestream = mongoDocToLivestream(doc);
    if (!isArmedYouTubeLivestream(livestream)) continue;
    const existing = grouped.get(livestream.userId) ?? [];
    existing.push(livestream);
    grouped.set(livestream.userId, existing);
  }

  for (const [userId, livestreams] of grouped) {
    livestreams.sort(compareScheduledStartAsc);
    grouped.set(userId, livestreams);
  }

  return grouped;
}

/**
 * Returns all armed Facebook livestreams across every user, grouped by owner id.
 * Each user's list is ordered by scheduled start time ascending.
 * @returns Map of user id to armed Facebook livestream rows for that user.
 */
export async function listAllArmedFacebookLivestreams(): Promise<Map<string, Livestream[]>> {
  await connectToDatabase();
  const docs = await LivestreamModel.find({}).lean<LivestreamDocument[]>();
  const grouped = new Map<string, Livestream[]>();

  for (const doc of docs) {
    const livestream = mongoDocToLivestream(doc);
    if (!isArmedFacebookLivestream(livestream)) continue;
    const existing = grouped.get(livestream.userId) ?? [];
    existing.push(livestream);
    grouped.set(livestream.userId, existing);
  }

  for (const [userId, livestreams] of grouped) {
    livestreams.sort(compareScheduledStartAsc);
    grouped.set(userId, livestreams);
  }

  return grouped;
}

// -----------------------------------------------------------------------------
// Update
// -----------------------------------------------------------------------------

/**
 * Partial update payload for an existing livestream document.
 */
export interface UpdateLivestreamPatch {
  status?: LivestreamStatus;
  title?: string;
  description?: string;
  tags?: string[];
  visibility?: PlatformUploadVisibility;
  targets?: ConnectedAccountPlatform[];
  platforms?: LivestreamPlatforms;
  /** Partial platforms merge (PATCH bodies); merged via {@link mergeLivestreamPlatformsPatch}. */
  platformsPatch?: unknown;
  scheduledStartTime?: string | null;
  scheduledStartTimeZone?: string | null;
  thumbnailR2Key?: string | null;
  thumbnailContentType?: string | null;
  youtubeBroadcastId?: string | null;
  youtubeBoundStreamId?: string | null;
  keySlot?: LivestreamKeySlot | null;
  keySwapPromotedAt?: string | null;
  keySlotStaleAt?: string | null;
  autoPromoteToMainKey?: boolean | null;
  autoPromoteToMainKeyMinutes?: number | null;
  youtubeLifecycleStatus?: string | null;
  facebookLiveVideoId?: string | null;
  facebookStreamUrl?: string | null;
  facebookArmedAt?: string | null;
  facebookLifecycleStatus?: string | null;
}

function applyNullableStringPatch(
  current: string | undefined,
  patch: string | null | undefined
): string | undefined {
  if (patch === undefined) return current;
  if (patch === null) return undefined;
  const trimmed = patch.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Updates an existing livestream. Only provided patch fields are changed.
 * @param id - Livestream row id.
 * @param patch - Partial document update.
 * @returns Updated livestream, or null when the row does not exist.
 */
export async function updateLivestream(
  id: string,
  patch: UpdateLivestreamPatch
): Promise<Livestream | null> {
  const current = await getLivestreamById(id);
  if (!current) return null;

  const mergedPlatforms =
    patch.platformsPatch !== undefined
      ? mergeLivestreamPlatformsPatch(current.platforms, patch.platformsPatch)
      : patch.platforms !== undefined
        ? patch.platforms
        : current.platforms;

  const next: Livestream = {
    ...current,
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
    ...(patch.targets !== undefined ? { targets: patch.targets } : {}),
    platforms: mergedPlatforms,
    scheduledStartTime: applyNullableStringPatch(
      current.scheduledStartTime,
      patch.scheduledStartTime
    ),
    scheduledStartTimeZone: applyNullableStringPatch(
      current.scheduledStartTimeZone,
      patch.scheduledStartTimeZone
    ),
    thumbnailR2Key: applyNullableStringPatch(current.thumbnailR2Key, patch.thumbnailR2Key),
    thumbnailContentType: applyNullableStringPatch(
      current.thumbnailContentType,
      patch.thumbnailContentType
    ),
    youtubeBroadcastId: applyNullableStringPatch(
      current.youtubeBroadcastId,
      patch.youtubeBroadcastId
    ),
    youtubeBoundStreamId: applyNullableStringPatch(
      current.youtubeBoundStreamId,
      patch.youtubeBoundStreamId
    ),
    keySlot:
      patch.keySlot === undefined
        ? current.keySlot
        : patch.keySlot === null
          ? undefined
          : patch.keySlot,
    keySwapPromotedAt: applyNullableStringPatch(current.keySwapPromotedAt, patch.keySwapPromotedAt),
    keySlotStaleAt: applyNullableStringPatch(current.keySlotStaleAt, patch.keySlotStaleAt),
    autoPromoteToMainKey:
      patch.autoPromoteToMainKey === undefined
        ? current.autoPromoteToMainKey
        : patch.autoPromoteToMainKey === null
          ? undefined
          : patch.autoPromoteToMainKey,
    autoPromoteToMainKeyMinutes:
      patch.autoPromoteToMainKeyMinutes === undefined
        ? current.autoPromoteToMainKeyMinutes
        : patch.autoPromoteToMainKeyMinutes === null
          ? undefined
          : normalizeAutoPromoteToMainKeyMinutes(patch.autoPromoteToMainKeyMinutes),
    youtubeLifecycleStatus: applyNullableStringPatch(
      current.youtubeLifecycleStatus,
      patch.youtubeLifecycleStatus
    ),
    facebookLiveVideoId: applyNullableStringPatch(
      current.facebookLiveVideoId,
      patch.facebookLiveVideoId
    ),
    facebookStreamUrl: applyNullableStringPatch(current.facebookStreamUrl, patch.facebookStreamUrl),
    facebookArmedAt: applyNullableStringPatch(current.facebookArmedAt, patch.facebookArmedAt),
    facebookLifecycleStatus: applyNullableStringPatch(
      current.facebookLifecycleStatus,
      patch.facebookLifecycleStatus
    ),
  };

  const documentJson = stringifyLivestreamDocumentForStorage(storedDocumentFromLivestream(next));
  assertLivestreamDocumentJsonWithinLimit(documentJson);

  await connectToDatabase();
  const updated = await LivestreamModel.findByIdAndUpdate(
    id,
    { document: documentJson },
    { returnDocument: 'after', runValidators: true }
  ).lean<LivestreamDocument | null>();
  if (!updated) return null;
  return mongoDocToLivestream(updated);
}

/**
 * Clears YouTube broadcast linkage fields from draft livestreams for a user.
 * Used after YouTube disconnect or channel change so drafts do not reuse stale broadcast ids.
 * @param userId - Owner user id.
 * @returns Number of draft rows updated.
 */
export async function clearDraftLivestreamYouTubeBroadcastLinksForUser(
  userId: string
): Promise<number> {
  const livestreams = await listLivestreamsByUser(userId);
  let cleared = 0;

  for (const livestream of livestreams) {
    if (livestream.status !== 'draft') {
      continue;
    }

    const hasBroadcastLink =
      Boolean(livestream.youtubeBroadcastId?.trim()) ||
      Boolean(livestream.youtubeBoundStreamId?.trim()) ||
      Boolean(livestream.youtubeLifecycleStatus?.trim());

    if (!hasBroadcastLink) {
      continue;
    }

    const updated = await updateLivestream(livestream.id, {
      youtubeBroadcastId: null,
      youtubeBoundStreamId: null,
      youtubeLifecycleStatus: null,
    });

    if (updated) {
      cleared += 1;
    }
  }

  return cleared;
}

// -----------------------------------------------------------------------------
// Delete
// -----------------------------------------------------------------------------

/**
 * Removes a livestream document by ID.
 * @param id - Livestream row id.
 */
export async function deleteLivestream(id: string): Promise<void> {
  await connectToDatabase();
  await LivestreamModel.deleteOne({ _id: id });
}
