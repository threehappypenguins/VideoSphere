// =============================================================================
// REPOSITORIES — single entry point for data access
// =============================================================================
// Import from '@/lib/repositories' or '@/lib/repositories/users', etc.
// All persistence (and future R2/API) access is behind this layer.
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

export {
  createDraft,
  getDraftById,
  getDraftTitlesByIdsForUser,
  listDraftsByUser,
  updateDraft,
  deleteDraft,
} from './drafts';
export type { CreateDraftInput, UpdateDraftInput } from './drafts';

export {
  createUploadJob,
  countUploadJobsByUser,
  findUploadJobForDistribution,
  getUploadJobById,
  listUploadJobsByUser,
  getUploadJobsWithPlatformUploads,
  getUploadJobsWithPlatformUploadsPage,
  getUploadJobsWithPlatformUploadsForDraft,
  updateUploadJobStatus,
} from './upload-jobs';
export type { CreateUploadJobInput, GetUploadJobsWithPlatformUploadsOptions } from './upload-jobs';

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

export {
  claimStripeWebhookEvent,
  markStripeWebhookEventBookkeepingFailed,
  markStripeWebhookEventCompleted,
  markStripeWebhookEventFailed,
  markStripeWebhookEventNonRetryableFailed,
  deleteStripeWebhookEvent,
} from './webhook-events';
export type { StripeWebhookProcessingClaimResult } from './webhook-events';
