// =============================================================================
// UPLOAD JOB REPOSITORY
// =============================================================================
// All upload job (video upload/distribution status) data access goes through
// this module. API routes and Server Components should call these functions
// only — not the Appwrite SDK directly.
//
// Implementation will use Appwrite Database for persistence.
// =============================================================================

import type { UploadJob, UploadJobStatus } from '@/types';

export interface CreateUploadJobInput {
  userId: string;
  draftId: string | null;
}

/**
 * Create a new upload job (e.g. when user starts an upload). Status defaults to pending.
 */
export async function createUploadJob(input: CreateUploadJobInput): Promise<UploadJob> {
  // TODO: Implement with Appwrite (create document in UploadJobs collection).
  throw new Error('Not implemented');
}

/**
 * Fetch an upload job by ID. Returns null if not found.
 */
export async function getUploadJob(id: string): Promise<UploadJob | null> {
  // TODO: Implement with Appwrite (get document by ID).
  throw new Error('getUploadJob is not implemented yet.');
}

/**
 * List upload jobs for a user (e.g. for dashboard). Optionally filter by status.
 */
export async function listUploadJobsByUserId(
  userId: string,
  status?: UploadJobStatus
): Promise<UploadJob[]> {
  // TODO: Implement with Appwrite (query UploadJobs by userId; filter by status if provided).
  throw new Error('listUploadJobsByUserId is not implemented yet.');
}

/**
 * Update the status of an upload job (e.g. uploading → distributing → completed).
 * Optionally set errorMessage when status is 'failed'. Returns updated job or null.
 */
export async function updateUploadJobStatus(
  id: string,
  status: UploadJobStatus,
  errorMessage?: string | null
): Promise<UploadJob | null> {
  // TODO: Implement with Appwrite (update document).
  throw new Error('updateUploadJobStatus is not implemented yet.');
}
