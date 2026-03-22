// =============================================================================
// REPOSITORIES — single entry point for data access
// =============================================================================
// Import from '@/lib/repositories' or '@/lib/repositories/users', etc.
// All Appwrite (and future R2/API) access is behind this layer.
// =============================================================================

export {
  createUser,
  getUserById,
  getUserByEmail,
  updateUser,
  setSupporterStatus,
  listUsers,
} from './users';
export type { CreateUserData, UpdateUserData, ListUsersOptions, ListUsersResult } from './users';

export { createDraft, getDraftById, listDraftsByUser, updateDraft, deleteDraft } from './drafts';
export type { CreateDraftInput, UpdateDraftInput } from './drafts';

export {
  createUploadJob,
  findUploadJobForDistribution,
  getUploadJobById,
  listUploadJobsByUser,
  getUploadJobsWithPlatformUploads,
  updateUploadJobStatus,
} from './upload-jobs';
export type { CreateUploadJobInput } from './upload-jobs';

export {
  createPlatformUpload,
  ensurePlatformUploadsForJobTargets,
  getPlatformUploadsByJob,
  resetPlatformUploadForRetry,
  updatePlatformUploadStatus,
} from './platform-uploads';
export type { CreatePlatformUploadInput } from './platform-uploads';

export {
  createConnectedAccount,
  getConnectedAccountsByUser,
  getConnectedAccount,
  getConnectedAccountWithTokens,
  deleteConnectedAccount,
  updateTokens,
} from './connected-accounts';
export type { CreateConnectedAccountData } from './connected-accounts';

export { getMonthlyUsage, incrementUsage, canUpload } from './upload-usage';
