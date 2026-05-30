// =============================================================================
// PLATFORM UPLOADS REPOSITORY
// =============================================================================
// All platform upload (per-platform upload state for a job) data access goes
// through this module. API routes and Server Components should call these
// functions only.
//
// Uses Mongoose for the platform_uploads collection.
// =============================================================================

import { randomUUID } from 'crypto';
import type { PlatformUpload, ConnectedAccountPlatform, PlatformUploadStatus } from '@/types';
import { connectToDatabase } from '@/lib/mongodb';
import { PlatformUploadModel, type PlatformUploadDocument } from '@/lib/models/PlatformUpload';
import {
  platformUploadDocumentFromRow,
  platformUploadDocumentJsonForCreateRow,
  type PlatformUploadRowDocumentInput,
} from '@/lib/platform-upload-document';

/** Map a MongoDB document to the shared PlatformUpload type. */
export function rowToPlatformUpload(doc: PlatformUploadDocument): PlatformUpload {
  const parsed = platformUploadDocumentFromRow({ document: doc.document });
  return {
    id: String(doc._id),
    uploadJobId: String(doc.uploadJobId),
    platform: String(doc.platform) as ConnectedAccountPlatform,
    status: String(doc.status) as PlatformUploadStatus,
    platformVideoId: String(doc.platformVideoId ?? ''),
    platformUrl: String(doc.platformUrl ?? ''),
    title: parsed.title,
    description: parsed.description,
    tags: [...parsed.tags],
    visibility: parsed.visibility,
    scheduledAt: doc.scheduledAt != null && doc.scheduledAt !== '' ? String(doc.scheduledAt) : null,
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
  await connectToDatabase();

  const created = await PlatformUploadModel.create({
    _id: randomUUID(),
    uploadJobId: data.uploadJobId,
    platform: data.platform,
    status: 'pending',
    platformVideoId: '',
    platformUrl: '',
    document: platformUploadDocumentJsonForCreateRow(data),
    errorMessage: '',
    scheduledAt: data.scheduledAt != null && data.scheduledAt !== '' ? data.scheduledAt : '',
  });

  return rowToPlatformUpload(created.toObject());
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
  await connectToDatabase();

  const updated = await PlatformUploadModel.findByIdAndUpdate(
    id,
    {
      status: 'pending',
      platformVideoId: '',
      platformUrl: '',
      errorMessage: '',
      document: platformUploadDocumentJsonForCreateRow(data),
      scheduledAt: data.scheduledAt != null && data.scheduledAt !== '' ? data.scheduledAt : '',
    },
    { new: true, runValidators: true }
  ).lean<PlatformUploadDocument | null>();

  if (!updated) {
    throw new Error('Platform upload not found for retry reset');
  }

  return rowToPlatformUpload(updated);
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
  await connectToDatabase();

  const pageSize = 100;
  let offset = 0;
  const uploads: PlatformUpload[] = [];

  while (true) {
    const docs = await PlatformUploadModel.find({ uploadJobId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(pageSize)
      .lean<PlatformUploadDocument[]>();

    const pageUploads = docs.map(rowToPlatformUpload);
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
  await connectToDatabase();

  const data: Partial<PlatformUploadDocument> = { status };
  if (platformVideoId !== undefined) {
    data.platformVideoId = platformVideoId;
  }
  if (platformUrl !== undefined) {
    data.platformUrl = platformUrl;
  }
  if (errorMessage !== undefined) {
    data.errorMessage = errorMessage ?? '';
  }

  const updated = await PlatformUploadModel.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  }).lean<PlatformUploadDocument | null>();

  if (!updated) return null;
  return rowToPlatformUpload(updated);
}
