// =============================================================================
// SHARED TYPE DEFINITIONS
// =============================================================================
// Place your shared TypeScript types and interfaces in this file.
// Types that are used across multiple components or pages belong here.
//
// STUDENT: Add your own types as you build features. For example:
//   - User type for your auth system
//   - Product/Item types for your core data
//   - API response types
//
// Types specific to a single component can stay in that component's file.
// =============================================================================

// =============================================================================
// VideoSphere entity types (used by lib/repositories and API routes)
// =============================================================================

export type UserRole = 'user' | 'admin';

export interface UploadUsage {
  userId: string;
  /** Current month in "YYYY-MM" format. */
  month: string;
  uploadCount: number;
}

export interface User {
  /** User identifier; aligns with user_profiles.userId in Appwrite. */
  userId: string;
  email: string;
  isSupporter: boolean;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface Draft {
  id: string;
  userId: string;
  title: string;
  description: string;
  /** In-app: array of tag strings. Persisted in Appwrite as a single string column (JSON); repository layer must JSON.stringify on write and JSON.parse on read. */
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type UploadJobStatus = 'pending' | 'uploading' | 'distributing' | 'completed' | 'failed';

export interface UploadJob {
  id: string;
  userId: string;
  draftId: string | null;
  /** R2 object key for the uploaded video file. Null until the presign step records it. */
  r2Key: string | null;
  status: UploadJobStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Platform identifier; shared with ConnectedAccount and PlatformUpload. */
export type ConnectedAccountPlatform = 'youtube' | 'vimeo';

/** Platform upload status (PRD: pending, uploading, completed, failed). */
export type PlatformUploadStatus = 'pending' | 'uploading' | 'completed' | 'failed';

/** Per-platform visibility (PRD: public, unlisted, private). */
export type PlatformUploadVisibility = 'public' | 'unlisted' | 'private';

/** Platform upload (one per target platform per upload job). See PRD Platform Upload. */
export interface PlatformUpload {
  id: string;
  uploadJobId: string;
  platform: ConnectedAccountPlatform;
  status: PlatformUploadStatus;
  platformVideoId: string;
  platformUrl: string;
  title: string;
  description: string;
  tags: string;
  visibility: PlatformUploadVisibility;
  scheduledAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Upload job with its related platform uploads (for dashboard/APIs). */
export interface UploadJobWithPlatformUploads extends UploadJob {
  platformUploads: PlatformUpload[];
}

/**
 * Safe shape for listing and API responses. No OAuth tokens.
 * Use this for GET /api/platforms/connections, UI, and any response sent to the client.
 */
export interface ConnectedAccountPublic {
  id: string;
  userId: string;
  platform: ConnectedAccountPlatform;
  tokenExpiry: string;
  platformUserId: string;
  platformName: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Full connected account including OAuth tokens. Use only server-side when calling
 * platform APIs (upload, token refresh). Do not expose in API responses or client.
 */
export interface ConnectedAccount extends ConnectedAccountPublic {
  accessToken: string;
  refreshToken: string;
}

// =============================================================================
// Example type — demonstrates the pattern for defining shared types.
// =============================================================================

export interface ExampleItem {
  id: string;
  title: string;
  description: string;
  createdAt: string;
}

/**
 * Standard API response wrapper.
 * Use this pattern to keep your API responses consistent.
 */
export interface ApiResponse<T> {
  data: T;
  message?: string;
}

/**
 * Standard API error response.
 */
export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}
