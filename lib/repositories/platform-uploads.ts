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
import type {
  PlatformUpload,
  ConnectedAccountPlatform,
  PlatformUploadStatus,
  PlatformUploadVisibility,
} from '@/types';
import appwriteClient from '@/lib/appwrite';
import { DATABASE_ID, PLATFORM_UPLOADS_COLLECTION_ID } from '@/lib/appwrite-constants';
import { rowToPlatformUpload } from '@/lib/repositories/upload-jobs';

const tablesDb = new TablesDB(appwriteClient);

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export interface CreatePlatformUploadInput {
  uploadJobId: string;
  platform: ConnectedAccountPlatform;
  title: string;
  description: string;
  tags: string;
  visibility: PlatformUploadVisibility;
  scheduledAt?: string | null;
}

/**
 * Create a new platform upload record linked to an upload job.
 * Status defaults to 'pending'. Returns the created platform upload.
 */
export async function createPlatformUpload(
  data: CreatePlatformUploadInput
): Promise<PlatformUpload> {
  const now = new Date().toISOString();
  const rowData: Record<string, unknown> = {
    uploadJobId: data.uploadJobId,
    platform: data.platform,
    status: 'pending',
    platformVideoId: '',
    platformUrl: '',
    title: data.title,
    description: data.description,
    tags: data.tags,
    visibility: data.visibility,
    errorMessage: '',
    createdAt: now,
    updatedAt: now,
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

// -----------------------------------------------------------------------------
// Read
// -----------------------------------------------------------------------------

/**
 * Return all platform uploads for a given upload job, ordered by createdAt descending.
 */
export async function getPlatformUploadsByJob(uploadJobId: string): Promise<PlatformUpload[]> {
  const { rows } = await tablesDb.listRows({
    databaseId: DATABASE_ID,
    tableId: PLATFORM_UPLOADS_COLLECTION_ID,
    queries: [Query.equal('uploadJobId', uploadJobId), Query.orderDesc('createdAt')],
    total: false,
  });
  return (rows ?? []).map((r) => rowToPlatformUpload(r as unknown as Record<string, unknown>));
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
    updatedAt: new Date().toISOString(),
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
