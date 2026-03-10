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

const tablesDb = new TablesDB(appwriteClient);

/** Map an Appwrite row to the shared UploadJob type. */
function rowToUploadJob(row: Record<string, unknown>): UploadJob {
  return {
    id: String(row.$id ?? row.id),
    userId: String(row.userId),
    draftId: row.draftId != null && row.draftId !== '' ? String(row.draftId) : null,
    status: String(row.status) as UploadJobStatus,
    errorMessage:
      row.errorMessage != null && row.errorMessage !== '' ? String(row.errorMessage) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

/** Map an Appwrite row to the shared PlatformUpload type. */
function rowToPlatformUpload(row: Record<string, unknown>): PlatformUpload {
  return {
    id: String(row.$id ?? row.id),
    uploadJobId: String(row.uploadJobId),
    platform: String(row.platform),
    status: String(row.status),
    platformVideoId: String(row.platformVideoId ?? ''),
    platformUrl: String(row.platformUrl ?? ''),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    tags: String(row.tags ?? ''),
    visibility: String(row.visibility ?? 'public'),
    scheduledAt: row.scheduledAt != null && row.scheduledAt !== '' ? String(row.scheduledAt) : null,
    errorMessage:
      row.errorMessage != null && row.errorMessage !== '' ? String(row.errorMessage) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export interface CreateUploadJobInput {
  userId: string;
  draftId: string | null;
}

/**
 * Create a new upload job (e.g. when user starts an upload). Status defaults to pending.
 */
export async function createUploadJob(input: CreateUploadJobInput): Promise<UploadJob> {
  const now = new Date().toISOString();
  const row = await tablesDb.createRow({
    databaseId: DATABASE_ID,
    tableId: UPLOAD_JOBS_COLLECTION_ID,
    rowId: ID.unique(),
    data: {
      userId: input.userId,
      draftId: input.draftId ?? '',
      status: 'pending',
      errorMessage: '',
      createdAt: now,
      updatedAt: now,
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
  status?: UploadJobStatus
): Promise<UploadJob[]> {
  const queries = [Query.equal('userId', userId), Query.orderDesc('createdAt')];
  if (status != null) {
    queries.push(Query.equal('status', status));
  }
  const { rows } = await tablesDb.listRows({
    databaseId: DATABASE_ID,
    tableId: UPLOAD_JOBS_COLLECTION_ID,
    queries,
    total: false,
  });
  return (rows ?? []).map((r) => rowToUploadJob(r as unknown as Record<string, unknown>));
}

/**
 * List upload jobs for a user with their related platform uploads populated.
 * Sorted by most recent first.
 */
export async function getUploadJobsWithPlatformUploads(
  userId: string
): Promise<UploadJobWithPlatformUploads[]> {
  const jobs = await listUploadJobsByUser(userId);
  const result: UploadJobWithPlatformUploads[] = [];

  for (const job of jobs) {
    let platformUploads: PlatformUpload[] = [];
    try {
      const { rows } = await tablesDb.listRows({
        databaseId: DATABASE_ID,
        tableId: PLATFORM_UPLOADS_COLLECTION_ID,
        queries: [Query.equal('uploadJobId', job.id), Query.orderDesc('createdAt')],
        total: false,
      });
      platformUploads = (rows ?? []).map((r) =>
        rowToPlatformUpload(r as unknown as Record<string, unknown>)
      );
    } catch {
      // Table may not exist yet; return job with empty platformUploads
    }
    result.push({ ...job, platformUploads });
  }

  return result;
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
    updatedAt: new Date().toISOString(),
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
