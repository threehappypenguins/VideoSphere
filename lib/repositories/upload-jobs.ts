// =============================================================================
// UPLOAD JOB REPOSITORY
// =============================================================================
// All upload job (video upload/distribution status) data access goes through
// this module. API routes and Server Components should call these functions
// only — not the Appwrite SDK directly.
//
// Uses Appwrite Server SDK (Tables API) for the upload_jobs and
// platform_uploads tables.
// =============================================================================

import { ID, Query, TablesDB } from 'node-appwrite';
import type {
  UploadJob,
  UploadJobStatus,
  UploadJobWithPlatformUploads,
  PlatformUpload,
} from '@/types';
import appwriteClient from '@/lib/appwrite';
import {
  DATABASE_ID,
  UPLOAD_JOBS_COLLECTION_ID,
  PLATFORM_UPLOADS_COLLECTION_ID,
} from '@/lib/appwrite-constants';
import { assertAppwriteRowTimestamps } from '@/lib/assert-appwrite-row-timestamps';
import { rowToPlatformUpload } from '@/lib/repositories/platform-uploads';

const tablesDb = new TablesDB(appwriteClient);

/** Map an Appwrite row to the shared UploadJob type. */
function rowToUploadJob(row: Record<string, unknown>): UploadJob {
  const { $createdAt, $updatedAt } = assertAppwriteRowTimestamps(row);
  const quotaRaw = row.quotaClaimMonth;
  return {
    id: String(row.$id ?? row.id),
    userId: String(row.userId),
    draftId: row.draftId != null && row.draftId !== '' ? String(row.draftId) : null,
    r2Key: row.r2Key != null && row.r2Key !== '' ? String(row.r2Key) : null,
    status: String(row.status) as UploadJobStatus,
    errorMessage:
      row.errorMessage != null && row.errorMessage !== '' ? String(row.errorMessage) : null,
    quotaClaimMonth: quotaRaw === undefined || quotaRaw === null ? null : String(quotaRaw),
    $createdAt,
    $updatedAt,
  };
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export interface CreateUploadJobInput {
  userId: string;
  draftId: string | null;
  /** R2 object key for the video file (from the presign step). */
  r2Key: string;
  /**
   * Month "YYYY-MM" when a free-tier slot was claimed at presign, or "" if the user
   * was unlimited at presign (supporter/admin).
   */
  quotaClaimMonth: string;
}

/**
 * Create a new upload job (e.g. when user starts an upload). Status defaults to pending.
 */
export async function createUploadJob(input: CreateUploadJobInput): Promise<UploadJob> {
  const row = await tablesDb.createRow({
    databaseId: DATABASE_ID,
    tableId: UPLOAD_JOBS_COLLECTION_ID,
    rowId: ID.unique(),
    data: {
      userId: input.userId,
      draftId: input.draftId ?? '',
      r2Key: input.r2Key,
      status: 'pending',
      errorMessage: '',
      quotaClaimMonth: input.quotaClaimMonth,
    },
  });
  return rowToUploadJob(row as unknown as Record<string, unknown>);
}

// -----------------------------------------------------------------------------
// Read
// -----------------------------------------------------------------------------

/**
 * Fetch an upload job by ID. Returns null if not found.
 */
export async function getUploadJobById(id: string): Promise<UploadJob | null> {
  try {
    const row = await tablesDb.getRow({
      databaseId: DATABASE_ID,
      tableId: UPLOAD_JOBS_COLLECTION_ID,
      rowId: id,
    });
    return rowToUploadJob(row as unknown as Record<string, unknown>);
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e.code === 404) return null;
    throw err;
  }
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
  const pageSize = options?.pageSize ?? 100;
  // Safety cap: most callers (dashboards, status pages) don't need full history.
  // Callers that truly need unbounded history should pass maxRows: Infinity.
  const maxRows = options?.maxRows ?? 1000;
  let offset = 0;
  const jobs: UploadJob[] = [];

  while (true) {
    const remaining = Number.isFinite(maxRows) ? Math.max(0, maxRows - jobs.length) : Infinity;
    const thisPageLimit = Math.min(pageSize, remaining);
    if (!Number.isFinite(thisPageLimit) || thisPageLimit <= 0) break;

    const queries = [
      Query.equal('userId', userId),
      Query.orderDesc('$createdAt'),
      Query.limit(thisPageLimit),
      Query.offset(offset),
    ];
    if (status != null) {
      queries.push(Query.equal('status', status));
    }

    const { rows } = await tablesDb.listRows({
      databaseId: DATABASE_ID,
      tableId: UPLOAD_JOBS_COLLECTION_ID,
      queries,
      total: false,
    });

    const pageJobs = (rows ?? []).map((r) =>
      rowToUploadJob(r as unknown as Record<string, unknown>)
    );
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
  options?: { pageSize?: number; maxRows?: number }
): Promise<UploadJob[]> {
  const uniqueDraftIds = [...new Set(draftIds.filter((id) => typeof id === 'string' && id !== ''))];
  if (uniqueDraftIds.length === 0) return [];

  const pageSize = options?.pageSize ?? 100;
  const maxRows = options?.maxRows ?? 5000;
  let offset = 0;
  const jobs: UploadJob[] = [];
  const seenDraftIds = new Set<string>();

  while (true) {
    const remaining = Number.isFinite(maxRows) ? Math.max(0, maxRows - jobs.length) : Infinity;
    const thisPageLimit = Math.min(pageSize, remaining);
    if (!Number.isFinite(thisPageLimit) || thisPageLimit <= 0) break;

    const { rows } = await tablesDb.listRows({
      databaseId: DATABASE_ID,
      tableId: UPLOAD_JOBS_COLLECTION_ID,
      queries: [
        Query.equal('userId', userId),
        // Appwrite "equal" supports passing an array as an "IN" query.
        Query.equal('draftId', uniqueDraftIds),
        Query.orderAsc('$createdAt'),
        Query.limit(thisPageLimit),
        Query.offset(offset),
      ],
      total: false,
    });

    const pageJobs = (rows ?? []).map((r) =>
      rowToUploadJob(r as unknown as Record<string, unknown>)
    );
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
 * status that allows starting or resuming distribution. Uses indexed filters + limit 1
 * instead of scanning the first page of all jobs for the user.
 */
export async function findUploadJobForDistribution(input: {
  userId: string;
  draftId: string;
  r2Key: string;
}): Promise<UploadJob | null> {
  const { rows } = await tablesDb.listRows({
    databaseId: DATABASE_ID,
    tableId: UPLOAD_JOBS_COLLECTION_ID,
    queries: [
      Query.equal('userId', input.userId),
      Query.equal('draftId', input.draftId),
      Query.equal('r2Key', input.r2Key),
      Query.equal('status', [...UPLOAD_JOB_STATUSES_FOR_DISTRIBUTE]),
      Query.orderDesc('$createdAt'),
      Query.limit(1),
    ],
    total: false,
  });
  const row = rows?.[0];
  if (!row) return null;
  return rowToUploadJob(row as unknown as Record<string, unknown>);
}

/**
 * List upload jobs for a user with their related platform uploads populated.
 * Sorted by most recent first. Fetches all platform_uploads for the user's jobs
 * in a single query and groups in memory to avoid N+1.
 */
export async function getUploadJobsWithPlatformUploads(
  userId: string
): Promise<UploadJobWithPlatformUploads[]> {
  const jobs = await listUploadJobsByUser(userId);
  return getUploadJobsWithPlatformUploadsFromJobs(jobs);
}

async function getUploadJobsWithPlatformUploadsFromJobs(
  jobs: UploadJob[]
): Promise<UploadJobWithPlatformUploads[]> {
  if (jobs.length === 0) return [];

  const jobIds = jobs.map((j) => j.id);
  let uploadsByJobId = new Map<string, PlatformUpload[]>();

  try {
    const pageSize = 100;
    let offset = 0;

    // Fetch all platform uploads in explicit pages so Appwrite's default paging
    // can't silently truncate platform status history for drafts with many jobs.
    while (true) {
      const { rows } = await tablesDb.listRows({
        databaseId: DATABASE_ID,
        tableId: PLATFORM_UPLOADS_COLLECTION_ID,
        queries: [
          Query.equal('uploadJobId', jobIds),
          Query.orderDesc('$createdAt'),
          Query.limit(pageSize),
          Query.offset(offset),
        ],
        total: false,
      });

      const pageRows = (rows ?? []) as Array<Record<string, unknown>>;
      for (const r of pageRows) {
        const pu = rowToPlatformUpload(r as Record<string, unknown>);
        const list = uploadsByJobId.get(pu.uploadJobId) ?? [];
        list.push(pu);
        uploadsByJobId.set(pu.uploadJobId, list);
      }

      if (pageRows.length < pageSize) break;
      offset += pageSize;
      if (pageRows.length === 0) break;
    }
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e.code === 404) {
      // Table/collection may not exist yet; treat as no platform uploads
      uploadsByJobId = new Map();
    } else {
      // Re-throw unexpected errors (e.g., permission issues, outages)
      throw err;
    }
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
  const pageSize = options?.pageSize ?? 100;
  const jobs: UploadJob[] = [];
  let offset = options?.offset ?? 0;

  while (true) {
    const remaining = options?.limit != null ? options.limit - jobs.length : Infinity;
    const thisPageLimit = Math.min(pageSize, remaining);

    if (!Number.isFinite(thisPageLimit) || thisPageLimit <= 0) break;

    const { rows } = await tablesDb.listRows({
      databaseId: DATABASE_ID,
      tableId: UPLOAD_JOBS_COLLECTION_ID,
      queries: [
        Query.equal('userId', userId),
        Query.equal('draftId', draftId),
        Query.orderDesc('$createdAt'),
        Query.limit(thisPageLimit),
        Query.offset(offset),
      ],
      total: false,
    });

    const pageJobs = (rows ?? []).map((r) =>
      rowToUploadJob(r as unknown as Record<string, unknown>)
    );
    jobs.push(...pageJobs);

    if (pageJobs.length < thisPageLimit) break;
    offset += thisPageLimit;

    if (pageJobs.length === 0) break;
    if (options?.limit != null && jobs.length >= options.limit) break;
  }

  return getUploadJobsWithPlatformUploadsFromJobs(jobs);
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
  const data: Record<string, unknown> = {
    status,
  };
  if (errorMessage !== undefined) {
    data.errorMessage = errorMessage ?? '';
  }
  try {
    const row = await tablesDb.updateRow({
      databaseId: DATABASE_ID,
      tableId: UPLOAD_JOBS_COLLECTION_ID,
      rowId: id,
      data,
    });
    return rowToUploadJob(row as unknown as Record<string, unknown>);
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e.code === 404) return null;
    throw err;
  }
}
