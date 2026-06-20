// =============================================================================
// UPLOAD JOB REPOSITORY
// =============================================================================
// All upload job (video upload/distribution status) data access goes through
// this module. API routes and Server Components should call these functions
// only.
//
// Uses Mongoose for the upload_jobs and platform_uploads collections.
// =============================================================================

import { randomUUID } from 'crypto';
import type {
  UploadJob,
  UploadJobStatus,
  UploadJobWithPlatformUploads,
  PlatformUpload,
} from '@/types';
import { connectToDatabase } from '@/lib/mongodb';
import { UploadJobModel, type UploadJobDocument } from '@/lib/models/UploadJob';
import { PlatformUploadModel, type PlatformUploadDocument } from '@/lib/models/PlatformUpload';
import { rowToPlatformUpload } from '@/lib/repositories/platform-uploads';

/** Map a MongoDB document to the shared UploadJob type. */
function rowToUploadJob(doc: UploadJobDocument): UploadJob {
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    draftId: doc.draftId != null && doc.draftId !== '' ? String(doc.draftId) : null,
    r2Key: doc.r2Key != null && doc.r2Key !== '' ? String(doc.r2Key) : null,
    status: String(doc.status) as UploadJobStatus,
    errorMessage:
      doc.errorMessage != null && doc.errorMessage !== '' ? String(doc.errorMessage) : null,
    $createdAt: new Date(doc.createdAt).toISOString(),
    $updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

/**
 * Defines the shape of create upload job input.
 */
export interface CreateUploadJobInput {
  userId: string;
  draftId: string | null;
  /** R2 object key for the video file (from the presign step). */
  r2Key: string;
}

/**
 * Create a new upload job (e.g. when user starts an upload). Status defaults to pending.
 */
export async function createUploadJob(input: CreateUploadJobInput): Promise<UploadJob> {
  await connectToDatabase();
  const created = await UploadJobModel.create({
    _id: randomUUID(),
    userId: input.userId,
    draftId: input.draftId ?? '',
    r2Key: input.r2Key,
    status: 'pending',
    errorMessage: '',
  });
  return rowToUploadJob(created.toObject());
}

// -----------------------------------------------------------------------------
// Read
// -----------------------------------------------------------------------------

/**
 * Fetch an upload job by ID. Returns null if not found.
 */
export async function getUploadJobById(id: string): Promise<UploadJob | null> {
  await connectToDatabase();
  const doc = await UploadJobModel.findById(id).lean<UploadJobDocument | null>();
  if (!doc) return null;
  return rowToUploadJob(doc);
}

/**
 * List upload jobs for a user (e.g. for dashboard), sorted by most recent first.
 * Optionally filter by status.
 */
export async function listUploadJobsByUser(
  userId: string,
  status?: UploadJobStatus,
  options?: { pageSize?: number; maxRows?: number }
): Promise<UploadJob[]> {
  await connectToDatabase();

  const pageSize = options?.pageSize ?? 100;
  const maxRows = options?.maxRows ?? 1000;
  let offset = 0;
  const jobs: UploadJob[] = [];

  while (true) {
    const remaining = Number.isFinite(maxRows) ? Math.max(0, maxRows - jobs.length) : Infinity;
    const thisPageLimit = Math.min(pageSize, remaining);
    if (!Number.isFinite(thisPageLimit) || thisPageLimit <= 0) break;

    const query: Partial<Pick<UploadJobDocument, 'userId' | 'status'>> = { userId };
    if (status != null) {
      query.status = status;
    }

    const docs = await UploadJobModel.find(query)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(thisPageLimit)
      .lean<UploadJobDocument[]>();

    const pageJobs = docs.map(rowToUploadJob);
    jobs.push(...pageJobs);

    if (pageJobs.length < thisPageLimit) break;
    if (pageJobs.length === 0) break;
    offset += thisPageLimit;
  }

  return jobs;
}

/**
 * List upload jobs for a user filtered to a set of draft ids.
 * Sorted by oldest first so callers can easily pick "first used" timestamps.
 *
 * This is intentionally draft-scoped (not a full user scan) so endpoints like
 * GET /api/drafts can cheaply determine which drafts have ever been used.
 */
export async function listUploadJobsByUserForDraftIds(
  userId: string,
  draftIds: string[],
  /** `maxRows` defaults to 5000; pass `Number.POSITIVE_INFINITY` to page until every draft id is seen (e.g. GET /api/drafts backfill). */
  options?: { pageSize?: number; maxRows?: number; signal?: AbortSignal }
): Promise<UploadJob[]> {
  await connectToDatabase();

  const throwIfAborted = (signal?: AbortSignal) => {
    if (!signal?.aborted) return;
    const abortErr = new Error('Upload jobs scan aborted');
    abortErr.name = 'AbortError';
    throw abortErr;
  };

  const uniqueDraftIds = [...new Set(draftIds.filter((id) => typeof id === 'string' && id !== ''))];
  if (uniqueDraftIds.length === 0) return [];

  const pageSize = options?.pageSize ?? 100;
  const maxRows = options?.maxRows ?? 5000;
  const signal = options?.signal;
  let offset = 0;
  const jobs: UploadJob[] = [];
  const seenDraftIds = new Set<string>();

  while (true) {
    throwIfAborted(signal);

    const remaining = Number.isFinite(maxRows) ? Math.max(0, maxRows - jobs.length) : Infinity;
    const thisPageLimit = Math.min(pageSize, remaining);
    if (!Number.isFinite(thisPageLimit) || thisPageLimit <= 0) break;

    const docs = await UploadJobModel.find({
      userId,
      draftId: { $in: uniqueDraftIds },
    })
      .sort({ createdAt: 1 })
      .skip(offset)
      .limit(thisPageLimit)
      .lean<UploadJobDocument[]>();

    throwIfAborted(signal);

    const pageJobs = docs.map(rowToUploadJob);
    jobs.push(...pageJobs);

    for (const j of pageJobs) {
      if (j.draftId) seenDraftIds.add(j.draftId);
    }

    if (seenDraftIds.size >= uniqueDraftIds.length) break;
    if (pageJobs.length < thisPageLimit) break;
    if (pageJobs.length === 0) break;
    offset += thisPageLimit;
  }

  return jobs;
}

const UPLOAD_JOB_STATUSES_FOR_DISTRIBUTE: readonly UploadJobStatus[] = [
  'pending',
  'uploading',
  'distributing',
];

/**
 * Find the upload job for POST /api/uploads/distribute: same user, draft, R2 key, and a
 * status that allows starting or resuming distribution.
 */
export async function findUploadJobForDistribution(input: {
  userId: string;
  draftId: string;
  r2Key: string;
}): Promise<UploadJob | null> {
  await connectToDatabase();
  const doc = await UploadJobModel.findOne({
    userId: input.userId,
    draftId: input.draftId,
    r2Key: input.r2Key,
    status: { $in: [...UPLOAD_JOB_STATUSES_FOR_DISTRIBUTE] },
  })
    .sort({ createdAt: -1 })
    .lean<UploadJobDocument | null>();

  if (!doc) return null;
  return rowToUploadJob(doc);
}

/**
 * Total number of upload jobs for a user (for pagination `meta.total`).
 */
export async function countUploadJobsByUser(userId: string): Promise<number> {
  await connectToDatabase();
  return UploadJobModel.countDocuments({ userId });
}

/**
 * Count upload jobs for a user filtered to one or more statuses.
 */
export async function countUploadJobsByUserWithStatuses(
  userId: string,
  statuses: UploadJobStatus | readonly UploadJobStatus[]
): Promise<number> {
  await connectToDatabase();
  const normalizedStatuses = Array.isArray(statuses) ? [...statuses] : [statuses];
  return UploadJobModel.countDocuments({ userId, status: { $in: normalizedStatuses } });
}

/**
 * One page of upload jobs for a user (newest first) with platform uploads populated.
 * Does not load the full job list into memory.
 */
export async function getUploadJobsWithPlatformUploadsPage(
  userId: string,
  options: { limit: number; offset: number }
): Promise<UploadJobWithPlatformUploads[]> {
  await connectToDatabase();
  const docs = await UploadJobModel.find({ userId })
    .sort({ createdAt: -1 })
    .skip(options.offset)
    .limit(options.limit)
    .lean<UploadJobDocument[]>();

  const jobs = docs.map(rowToUploadJob);
  return getUploadJobsWithPlatformUploadsFromJobs(jobs);
}

/** Options for {@link getUploadJobsWithPlatformUploads}. */
export interface GetUploadJobsWithPlatformUploadsOptions {
  /** Forwarded to {@link listUploadJobsByUser} `pageSize`. */
  pageSize?: number;
  /**
   * Max upload job rows to load. Defaults to 1000 (same as {@link listUploadJobsByUser}).
   * Full-history callers (e.g. dashboard upload history) should pass `Number.POSITIVE_INFINITY`
   * so `meta.total` and pagination are not silently truncated.
   */
  maxRows?: number;
}

/**
 * List upload jobs for a user with their related platform uploads populated.
 * Sorted by most recent first.
 */
export async function getUploadJobsWithPlatformUploads(
  userId: string,
  options?: GetUploadJobsWithPlatformUploadsOptions
): Promise<UploadJobWithPlatformUploads[]> {
  const jobs = await listUploadJobsByUser(userId, undefined, {
    pageSize: options?.pageSize,
    maxRows: options?.maxRows ?? 1000,
  });
  return getUploadJobsWithPlatformUploadsFromJobs(jobs);
}

async function getUploadJobsWithPlatformUploadsFromJobs(
  jobs: UploadJob[]
): Promise<UploadJobWithPlatformUploads[]> {
  if (jobs.length === 0) return [];

  await connectToDatabase();

  const jobIds = jobs.map((j) => j.id);
  const uploadsByJobId = new Map<string, PlatformUpload[]>();

  const pageSize = 100;
  let offset = 0;

  while (true) {
    const docs = await PlatformUploadModel.find({ uploadJobId: { $in: jobIds } })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(pageSize)
      .lean<PlatformUploadDocument[]>();

    for (const doc of docs) {
      const pu = rowToPlatformUpload(doc);
      const list = uploadsByJobId.get(pu.uploadJobId) ?? [];
      list.push(pu);
      uploadsByJobId.set(pu.uploadJobId, list);
    }

    if (docs.length < pageSize) break;
    offset += pageSize;
    if (docs.length === 0) break;
  }

  return jobs.map((job) => ({
    ...job,
    platformUploads: uploadsByJobId.get(job.id) ?? [],
  }));
}

/**
 * List upload jobs for one user and one draft, with platform uploads populated.
 * Sorted by most recent first.
 */
export async function getUploadJobsWithPlatformUploadsForDraft(
  userId: string,
  draftId: string,
  options?: { limit?: number; offset?: number; pageSize?: number }
): Promise<UploadJobWithPlatformUploads[]> {
  await connectToDatabase();

  const pageSize = options?.pageSize ?? 100;
  const jobs: UploadJob[] = [];
  let offset = options?.offset ?? 0;

  while (true) {
    const remaining = options?.limit != null ? options.limit - jobs.length : Infinity;
    const thisPageLimit = Math.min(pageSize, remaining);

    if (!Number.isFinite(thisPageLimit) || thisPageLimit <= 0) break;

    const docs = await UploadJobModel.find({ userId, draftId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(thisPageLimit)
      .lean<UploadJobDocument[]>();

    const pageJobs = docs.map(rowToUploadJob);
    jobs.push(...pageJobs);

    if (pageJobs.length < thisPageLimit) break;
    offset += thisPageLimit;

    if (pageJobs.length === 0) break;
    if (options?.limit != null && jobs.length >= options.limit) break;
  }

  return getUploadJobsWithPlatformUploadsFromJobs(jobs);
}

const STALE_UPLOAD_JOB_STATUSES: readonly UploadJobStatus[] = [
  'pending',
  'uploading',
  'distributing',
];

/**
 * Lists upload jobs still in a non-terminal in-progress status whose `updatedAt`
 * is older than `updatedBefore` (e.g. after a server restart during distribution).
 * @param updatedBefore - Cutoff instant; rows updated at or after this time are excluded.
 * @param options - Optional paging controls.
 * @returns Matching upload jobs, oldest first.
 */
export async function listStaleUploadJobs(
  updatedBefore: Date,
  options?: { pageSize?: number }
): Promise<UploadJob[]> {
  await connectToDatabase();

  const pageSize = options?.pageSize ?? 100;
  let offset = 0;
  const jobs: UploadJob[] = [];

  while (true) {
    const docs = await UploadJobModel.find({
      status: { $in: [...STALE_UPLOAD_JOB_STATUSES] },
      updatedAt: { $lt: updatedBefore },
    })
      .sort({ updatedAt: 1 })
      .skip(offset)
      .limit(pageSize)
      .lean<UploadJobDocument[]>();

    const pageJobs = docs.map(rowToUploadJob);
    jobs.push(...pageJobs);

    if (pageJobs.length < pageSize) break;
    if (pageJobs.length === 0) break;
    offset += pageSize;
  }

  return jobs;
}

// -----------------------------------------------------------------------------
// Update
// -----------------------------------------------------------------------------

/**
 * Update the status of an upload job (e.g. uploading → distributing → completed).
 * Optionally set errorMessage when status is 'failed'. Returns updated job or null.
 */
export async function updateUploadJobStatus(
  id: string,
  status: UploadJobStatus,
  errorMessage?: string | null
): Promise<UploadJob | null> {
  await connectToDatabase();

  const data: Partial<UploadJobDocument> = { status };
  if (errorMessage !== undefined) {
    data.errorMessage = errorMessage ?? '';
  }

  const updated = await UploadJobModel.findByIdAndUpdate(id, data, {
    returnDocument: 'after',
    runValidators: true,
  }).lean<UploadJobDocument | null>();

  if (!updated) return null;
  return rowToUploadJob(updated);
}
