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
  YouTubeDraftFields,
  VimeoDraftFields,
} from '@/types';
import appwriteClient from '@/lib/appwrite';
import { DATABASE_ID, PLATFORM_UPLOADS_COLLECTION_ID } from '@/lib/appwrite-constants';
import { assertAppwriteRowTimestamps } from '@/lib/assert-appwrite-row-timestamps';
import {
  stringifyPlatformUploadDocumentForStorage,
  platformUploadDocumentFromRow,
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

export interface CreatePlatformUploadInput {
  uploadJobId: string;
  platform: ConnectedAccountPlatform;
  title: string;
  description: string;
  tags: string[];
  visibility: PlatformUploadVisibility;
  /** YouTube: stored in `document` when set. */
  categoryId?: string;
  madeForKids?: boolean;
  /** Vimeo: stored in `document` when set. */
  vimeoCategoryUri?: string;
  /** Full `platforms.youtube` snapshot for this upload row. */
  draftYoutube?: YouTubeDraftFields;
  /** Full `platforms.vimeo` snapshot for this upload row. */
  draftVimeo?: VimeoDraftFields;
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
    document: stringifyPlatformUploadDocumentForStorage({
      title: data.title,
      description: data.description,
      tags: data.tags,
      visibility: data.visibility,
      ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
      ...(data.madeForKids !== undefined ? { madeForKids: data.madeForKids } : {}),
      ...(data.vimeoCategoryUri !== undefined ? { vimeoCategoryUri: data.vimeoCategoryUri } : {}),
      ...(data.draftYoutube !== undefined ? { draftYoutube: data.draftYoutube } : {}),
      ...(data.draftVimeo !== undefined ? { draftVimeo: data.draftVimeo } : {}),
    }),
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

// -----------------------------------------------------------------------------
// Read
// -----------------------------------------------------------------------------

/**
 * Return all platform uploads for a given upload job, ordered by `$createdAt` descending.
 */
export async function getPlatformUploadsByJob(uploadJobId: string): Promise<PlatformUpload[]> {
  const { rows } = await tablesDb.listRows({
    databaseId: DATABASE_ID,
    tableId: PLATFORM_UPLOADS_COLLECTION_ID,
    queries: [Query.equal('uploadJobId', uploadJobId), Query.orderDesc('$createdAt')],
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
