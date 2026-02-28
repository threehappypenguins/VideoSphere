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
  id: string;
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
