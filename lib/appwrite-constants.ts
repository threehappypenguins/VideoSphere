// =============================================================================
// APPWRITE DATABASE & COLLECTION IDS
// =============================================================================
// Single source of truth for database and collection IDs. Use these in
// lib/repositories and API routes so IDs stay consistent.
//
// In Appwrite, "collections" (Databases API) and "tables" (Tables API) refer
// to the same container; see docs/appwrite-databases.md.
// =============================================================================

export const DATABASE_ID = 'videosphere';

export const USER_PROFILES_COLLECTION_ID = 'user_profiles';
export const DRAFTS_COLLECTION_ID = 'drafts';
export const UPLOAD_JOBS_COLLECTION_ID = 'upload_jobs';
export const PLATFORM_UPLOADS_COLLECTION_ID = 'platform_uploads';
export const CONNECTED_ACCOUNTS_COLLECTION_ID = 'connected_accounts';
