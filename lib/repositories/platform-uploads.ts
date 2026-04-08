// =============================================================================
// PLATFORM UPLOADS REPOSITORY
// =============================================================================
// All platform upload (per-platform upload state for a job) data access goes
// through this module. API routes and Server Components should call these
// functions only — not the Appwrite SDK directly.
//
// Uses Appwrite Server SDK (Tables API) for the platform_uploads table.
// =============================================================================

import { ID, Query, TablesDB } from 'node-appwrite';
import type { PlatformUpload, ConnectedAccountPlatform, PlatformUploadStatus } from '@/types';
import appwriteClient from '@/lib/appwrite';
import { DATABASE_ID, PLATFORM_UPLOADS_COLLECTION_ID } from '@/lib/appwrite-constants';
import { assertAppwriteRowTimestamps } from '@/lib/assert-appwrite-row-timestamps';
import {
  platformUploadDocumentFromRow,
  platformUploadDocumentJsonForCreateRow,
  type PlatformUploadRowDocumentInput,
} from '@/lib/platform-upload-document';

const tablesDb = new TablesDB(appwriteClient);

/** Map an Appwrite row to the shared PlatformUpload type. */
export function rowToPlatformUpload(row: Record<string, unknown>): PlatformUpload {
  const { $createdAt, $updatedAt } = assertAppwriteRowTimestamps(row);
  const doc = platformUploadDocumentFromRow(row);
  return {
    id: String(row.$id ?? row.id),
    uploadJobId: String(row.uploadJobId),
    platform: String(row.platform) as ConnectedAccountPlatform,
    status: String(row.status) as PlatformUploadStatus,
    platformVideoId: String(row.platformVideoId ?? ''),
    platformUrl: String(row.platformUrl ?? ''),
    title: doc.title,
    description: doc.description,
    tags: [...doc.tags],
    visibility: doc.visibility,
    scheduledAt: row.scheduledAt != null && row.scheduledAt !== '' ? String(row.scheduledAt) : null,
    errorMessage:
      row.errorMessage != null && row.errorMessage !== '' ? String(row.errorMessage) : null,
    $createdAt,
    $updatedAt,
  };
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

/**
 * Defines the shape of create platform upload input.
 */
export interface CreatePlatformUploadInput extends PlatformUploadRowDocumentInput {
  uploadJobId: string;
  platform: ConnectedAccountPlatform;
  scheduledAt?: string | null;
}

/**
 * Create a new platform upload record linked to an upload job.
 * Status defaults to 'pending'. Returns the created platform upload.
 */
export async function createPlatformUpload(
  data: CreatePlatformUploadInput
): Promise<PlatformUpload> {
  const rowData: Record<string, unknown> = {
    uploadJobId: data.uploadJobId,
    platform: data.platform,
    status: 'pending',
    platformVideoId: '',
    platformUrl: '',
    document: platformUploadDocumentJsonForCreateRow(data),
    errorMessage: '',
  };
  if (data.scheduledAt != null && data.scheduledAt !== '') {
    rowData.scheduledAt = data.scheduledAt;
  }
  const row = await tablesDb.createRow({
    databaseId: DATABASE_ID,
    tableId: PLATFORM_UPLOADS_COLLECTION_ID,
    rowId: ID.unique(),
    data: rowData,
  });
  return rowToPlatformUpload(row as unknown as Record<string, unknown>);
}

/** Newest row per platform (input must be ordered with newest first, as from {@link getPlatformUploadsByJob}). */
function latestPlatformUploadPerPlatform(
  uploads: PlatformUpload[]
): Map<ConnectedAccountPlatform, PlatformUpload> {
  const map = new Map<ConnectedAccountPlatform, PlatformUpload>();
  for (const pu of uploads) {
    if (!map.has(pu.platform)) {
      map.set(pu.platform, pu);
    }
  }
  return map;
}

/** First input wins per `platform` so callers cannot trigger parallel work for the same (job, platform). */
function dedupeCreatePlatformUploadInputsByPlatform(
  inputs: CreatePlatformUploadInput[]
): CreatePlatformUploadInput[] {
  const seen = new Set<ConnectedAccountPlatform>();
  const out: CreatePlatformUploadInput[] = [];
  for (const input of inputs) {
    if (seen.has(input.platform)) continue;
    seen.add(input.platform);
    out.push(input);
  }
  return out;
}

/**
 * Reset an existing row for a new distribution attempt (same job + platform).
 * Clears outcome fields and replaces `document` with the latest draft snapshot.
 */
export async function resetPlatformUploadForRetry(
  id: string,
  data: CreatePlatformUploadInput
): Promise<PlatformUpload> {
  const document = platformUploadDocumentJsonForCreateRow(data);
  const rowData: Record<string, unknown> = {
    status: 'pending',
    platformVideoId: '',
    platformUrl: '',
    errorMessage: '',
    document,
  };
  if (data.scheduledAt != null && data.scheduledAt !== '') {
    rowData.scheduledAt = data.scheduledAt;
  } else {
    rowData.scheduledAt = '';
  }
  const row = await tablesDb.updateRow({
    databaseId: DATABASE_ID,
    tableId: PLATFORM_UPLOADS_COLLECTION_ID,
    rowId: id,
    data: rowData,
  });
  return rowToPlatformUpload(row as unknown as Record<string, unknown>);
}

/**
 * Ensures one `platform_uploads` row per target platform for this job: reuses the newest
 * existing row per platform (reset to pending) or creates a new row. Keeps distribute retries idempotent
 * under the unique (uploadJobId, platform) index.
 *
 * Duplicate `platform` values in `inputs` are deduped (first occurrence kept) to avoid concurrent
 * creates/resets for the same key.
 */
export async function ensurePlatformUploadsForJobTargets(
  inputs: CreatePlatformUploadInput[]
): Promise<PlatformUpload[]> {
  if (inputs.length === 0) return [];
  const jobId = inputs[0].uploadJobId;
  for (const input of inputs) {
    if (input.uploadJobId !== jobId) {
      throw new Error(
        'ensurePlatformUploadsForJobTargets: all inputs must share the same uploadJobId'
      );
    }
  }
  const uniqueByPlatform = dedupeCreatePlatformUploadInputsByPlatform(inputs);
  const existing = await getPlatformUploadsByJob(jobId);
  const latestByPlatform = latestPlatformUploadPerPlatform(existing);

  return Promise.all(
    uniqueByPlatform.map(async (input) => {
      const prev = latestByPlatform.get(input.platform);
      if (prev) {
        return resetPlatformUploadForRetry(prev.id, input);
      }
      return createPlatformUpload(input);
    })
  );
}

// -----------------------------------------------------------------------------
// Read
// -----------------------------------------------------------------------------

/**
 * Return all platform uploads for a given upload job, ordered by `$createdAt` descending.
 */
export async function getPlatformUploadsByJob(uploadJobId: string): Promise<PlatformUpload[]> {
  const pageSize = 100;
  let offset = 0;
  const uploads: PlatformUpload[] = [];

  while (true) {
    const { rows } = await tablesDb.listRows({
      databaseId: DATABASE_ID,
      tableId: PLATFORM_UPLOADS_COLLECTION_ID,
      queries: [
        Query.equal('uploadJobId', uploadJobId),
        Query.orderDesc('$createdAt'),
        Query.limit(pageSize),
        Query.offset(offset),
      ],
      total: false,
    });

    const pageUploads = (rows ?? []).map((r) =>
      rowToPlatformUpload(r as unknown as Record<string, unknown>)
    );
    uploads.push(...pageUploads);

    if (pageUploads.length < pageSize) break;
    if (pageUploads.length === 0) break;
    offset += pageSize;
  }

  return uploads;
}

// -----------------------------------------------------------------------------
// Update
// -----------------------------------------------------------------------------

/**
 * Update a platform upload's status and optional result fields.
 * Use platformVideoId and platformUrl when status is 'completed';
 * use errorMessage when status is 'failed'. Returns the updated record or null if not found.
 */
export async function updatePlatformUploadStatus(
  id: string,
  status: PlatformUploadStatus,
  platformVideoId?: string,
  platformUrl?: string,
  errorMessage?: string | null
): Promise<PlatformUpload | null> {
  const data: Record<string, unknown> = {
    status,
  };
  if (platformVideoId !== undefined) {
    data.platformVideoId = platformVideoId;
  }
  if (platformUrl !== undefined) {
    data.platformUrl = platformUrl;
  }
  if (errorMessage !== undefined) {
    data.errorMessage = errorMessage ?? '';
  }
  try {
    const row = await tablesDb.updateRow({
      databaseId: DATABASE_ID,
      tableId: PLATFORM_UPLOADS_COLLECTION_ID,
      rowId: id,
      data,
    });
    return rowToPlatformUpload(row as unknown as Record<string, unknown>);
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e.code === 404) return null;
    throw err;
  }
}
