// =============================================================================
// YOUTUBE IMPORT JOB REPOSITORY
// =============================================================================
// All YouTube import/trim job data access goes through this module. API routes
// and Server Components should call these functions only.
//
// Uses Mongoose for the youtube_import_jobs collection.
// =============================================================================

import { randomUUID } from 'node:crypto';
import type { YoutubeImportJob, YoutubeImportJobStatus } from '@/types';
import { connectToDatabase } from '@/lib/mongodb';
import {
  YoutubeImportJobModel,
  type YoutubeImportJobDocument,
} from '@/lib/models/YoutubeImportJob';

const ACTIVE_YOUTUBE_IMPORT_JOB_STATUSES: readonly YoutubeImportJobStatus[] = [
  'pending',
  'downloading',
  'trimming',
  'uploading',
];

/**
 * Thrown when a user already has an active YouTube import job (Mongo duplicate key).
 */
export class YoutubeImportJobAlreadyActiveError extends Error {
  /** User id that already has an in-progress import job. */
  readonly userId: string;

  /**
   * @param userId - User who already has an active import job.
   */
  constructor(userId: string) {
    super(`User already has an active YouTube import job`);
    this.name = 'YoutubeImportJobAlreadyActiveError';
    this.userId = userId;
  }
}

/** Map a MongoDB document to the shared YoutubeImportJob type. */
function rowToYoutubeImportJob(doc: YoutubeImportJobDocument): YoutubeImportJob {
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    draftId: String(doc.draftId),
    sourceUrl: String(doc.sourceUrl),
    youtubeVideoId: String(doc.youtubeVideoId),
    livestreamId:
      doc.livestreamId != null && doc.livestreamId !== '' ? String(doc.livestreamId) : null,
    startSeconds: doc.startSeconds,
    endSeconds: doc.endSeconds,
    status: String(doc.status) as YoutubeImportJobStatus,
    progressPercent: doc.progressPercent,
    errorMessage:
      doc.errorMessage != null && doc.errorMessage !== '' ? String(doc.errorMessage) : null,
    r2Key: doc.r2Key != null && doc.r2Key !== '' ? String(doc.r2Key) : null,
    uploadJobId: doc.uploadJobId != null && doc.uploadJobId !== '' ? String(doc.uploadJobId) : null,
    $createdAt: new Date(doc.createdAt).toISOString(),
    $updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

/**
 * Input for creating a new YouTube import job.
 */
export interface CreateYoutubeImportJobInput {
  userId: string;
  draftId: string;
  sourceUrl: string;
  youtubeVideoId: string;
  /** Past livestream id when picked from history; omit or pass empty for pasted links. */
  livestreamId?: string;
  startSeconds: number;
  endSeconds: number;
}

/**
 * Partial fields accepted by {@link updateYoutubeImportJobStatus}.
 */
export interface UpdateYoutubeImportJobStatusPatch {
  status?: YoutubeImportJobStatus;
  progressPercent?: number;
  errorMessage?: string | null;
  r2Key?: string | null;
  uploadJobId?: string | null;
}

/**
 * Create a new YouTube import job. Status defaults to `pending`.
 * @param input - Job creation fields.
 * @returns The created import job.
 * @throws {YoutubeImportJobAlreadyActiveError} When the user already has an active job.
 */
export async function createYoutubeImportJob(
  input: CreateYoutubeImportJobInput
): Promise<YoutubeImportJob> {
  await connectToDatabase();

  try {
    const created = await YoutubeImportJobModel.create({
      _id: randomUUID(),
      userId: input.userId,
      draftId: input.draftId,
      sourceUrl: input.sourceUrl,
      youtubeVideoId: input.youtubeVideoId,
      livestreamId: input.livestreamId ?? '',
      startSeconds: input.startSeconds,
      endSeconds: input.endSeconds,
      status: 'pending',
      progressPercent: 0,
      errorMessage: '',
      r2Key: '',
      uploadJobId: '',
    });

    return rowToYoutubeImportJob(created.toObject());
  } catch (error) {
    const duplicateKeyError =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000;

    if (duplicateKeyError) {
      throw new YoutubeImportJobAlreadyActiveError(input.userId);
    }

    throw error;
  }
}

/**
 * Fetch a YouTube import job by id.
 * @param id - Import job id.
 * @returns The job, or null when not found.
 */
export async function getYoutubeImportJobById(id: string): Promise<YoutubeImportJob | null> {
  await connectToDatabase();
  const doc = await YoutubeImportJobModel.findById(id).lean<YoutubeImportJobDocument | null>();
  if (!doc) return null;
  return rowToYoutubeImportJob(doc);
}

/**
 * Return the user's current in-progress import job, if any.
 * @param userId - Owner user id.
 * @returns The active job, or null when none is in progress.
 */
export async function getActiveYoutubeImportJobForUser(
  userId: string
): Promise<YoutubeImportJob | null> {
  await connectToDatabase();
  const doc = await YoutubeImportJobModel.findOne({
    userId,
    status: { $in: [...ACTIVE_YOUTUBE_IMPORT_JOB_STATUSES] },
  })
    .sort({ createdAt: -1 })
    .lean<YoutubeImportJobDocument | null>();

  if (!doc) return null;
  return rowToYoutubeImportJob(doc);
}

/**
 * Apply a partial status/progress patch to an import job.
 * @param id - Import job id.
 * @param patch - Fields to update; omitted keys are left unchanged.
 */
export async function updateYoutubeImportJobStatus(
  id: string,
  patch: UpdateYoutubeImportJobStatusPatch
): Promise<void> {
  await connectToDatabase();

  const data: Partial<YoutubeImportJobDocument> = {};
  if (patch.status !== undefined) {
    data.status = patch.status;
  }
  if (patch.progressPercent !== undefined) {
    data.progressPercent = patch.progressPercent;
  }
  if (patch.errorMessage !== undefined) {
    data.errorMessage = patch.errorMessage ?? '';
  }
  if (patch.r2Key !== undefined) {
    data.r2Key = patch.r2Key ?? '';
  }
  if (patch.uploadJobId !== undefined) {
    data.uploadJobId = patch.uploadJobId ?? '';
  }

  if (Object.keys(data).length === 0) {
    return;
  }

  await YoutubeImportJobModel.findByIdAndUpdate(id, data, {
    runValidators: true,
  });
}

/**
 * Delete a YouTube import job row (e.g. after the client consumes a terminal state).
 * @param id - Import job id.
 */
export async function deleteYoutubeImportJob(id: string): Promise<void> {
  await connectToDatabase();
  await YoutubeImportJobModel.deleteOne({ _id: id });
}
