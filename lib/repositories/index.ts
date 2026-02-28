// =============================================================================
// REPOSITORIES — single entry point for data access
// =============================================================================
// Import from '@/lib/repositories' or '@/lib/repositories/users', etc.
// All Appwrite (and future R2/API) access is behind this layer.
// =============================================================================

export { getUserById, setSupporterStatus, listUsers } from './users';

export { createDraft, getDraft, listDraftsByUserId, updateDraft } from './drafts';
export type { CreateDraftInput, UpdateDraftInput } from './drafts';

export {
  createUploadJob,
  getUploadJob,
  listUploadJobsByUserId,
  updateUploadJobStatus,
} from './upload-jobs';
export type { CreateUploadJobInput } from './upload-jobs';
