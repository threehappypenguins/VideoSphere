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
  status: UploadJobStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ConnectedAccountPlatform = 'youtube' | 'vimeo';

export interface ConnectedAccount {
  id: string;
  userId: string;
  platform: ConnectedAccountPlatform;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: string;
  platformUserId: string;
  platformName: string;
  createdAt: string;
  updatedAt: string;
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
