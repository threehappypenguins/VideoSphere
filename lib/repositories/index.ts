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
  listUsers,
  countUsersWithRole,
  persistGoogleAuthForUser,
  revertGoogleAuthToPassword,
  getUserAuthProviderById,
  revokeStoredGoogleAuthForUser,
  deleteUserById,
} from './users';
export type {
  CreateUserData,
  UpdateUserData,
  ListUsersOptions,
  ListUsersResult,
  UserAuthProvider,
  PersistGoogleAuthOptions,
} from './users';

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

export {
  createInviteToken,
  listInviteTokens,
  isInviteTokenValid,
  isSetupTokenValid,
  consumeInviteToken,
  consumeSetupToken,
  releaseInviteToken,
  releaseSetupToken,
  revokeInviteToken,
  ensureSetupTokenForFirstRun,
  hasAnyUsers,
} from './invites';
export type {
  InviteTokenRecord,
  CreateInviteTokenInput,
  ListInviteTokensOptions,
  SetupTokenBootstrapResult,
  ConsumedInviteToken,
  InviteTokenReleaseSnapshot,
} from './invites';
