// =============================================================================
// DATABASE & COLLECTION IDS
// =============================================================================
// Single source of truth for database and collection IDs. Use these in
// lib/repositories and API routes so IDs stay consistent.
//
// "Collections" and "tables" refer to the same logical data container.
// =============================================================================

/**
 * Defines the DATABASE_ID constant.
 */
export const DATABASE_ID = 'videosphere';

/**
 * Defines the USER_PROFILES_COLLECTION_ID constant.
 */
export const USER_PROFILES_COLLECTION_ID = 'user_profiles';
/**
 * Defines the DRAFTS_COLLECTION_ID constant.
 */
export const DRAFTS_COLLECTION_ID = 'drafts';
/**
 * Defines the UPLOAD_JOBS_COLLECTION_ID constant.
 */
export const UPLOAD_JOBS_COLLECTION_ID = 'upload_jobs';
/**
 * Defines the PLATFORM_UPLOADS_COLLECTION_ID constant.
 */
export const PLATFORM_UPLOADS_COLLECTION_ID = 'platform_uploads';
/**
 * Defines the CONNECTED_ACCOUNTS_COLLECTION_ID constant.
 */
export const CONNECTED_ACCOUNTS_COLLECTION_ID = 'connected_accounts';
/**
 * Defines the UPLOAD_USAGE_COLLECTION_ID constant.
 */
export const UPLOAD_USAGE_COLLECTION_ID = 'upload_usage';
/**
 * Defines the PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID constant.
 */
export const PROCESSED_WEBHOOK_EVENTS_COLLECTION_ID = 'processed_webhook_events';
