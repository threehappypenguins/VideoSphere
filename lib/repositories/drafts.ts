// =============================================================================
// DRAFT REPOSITORY
// =============================================================================
// All draft (video metadata) data access goes through this module. API routes
// and Server Components should call these functions only — not the Appwrite
// SDK directly.
//
// Implementation will use Appwrite Database for persistence.
// =============================================================================

import type { Draft } from '@/types';

export interface CreateDraftInput {
  userId: string;
  title: string;
  description: string;
  tags: string[];
}

export interface UpdateDraftInput {
  title?: string;
  description?: string;
  tags?: string[];
}

/**
 * Create a new draft. Returns the created draft with id and timestamps.
 */
export async function createDraft(input: CreateDraftInput): Promise<Draft> {
  // TODO: Implement with Appwrite (create document in Drafts collection).
  throw new Error('Not implemented');
}

/**
 * Fetch a draft by ID. Returns null if not found.
 */
export async function getDraft(id: string): Promise<Draft | null> {
  // TODO: Implement with Appwrite (get document by ID).
  return null;
}

/**
 * List drafts for a user, optionally ordered by updatedAt descending.
 */
export async function listDraftsByUserId(userId: string): Promise<Draft[]> {
  // TODO: Implement with Appwrite (query Drafts by userId).
  return [];
}

/**
 * Update an existing draft. Returns the updated draft or null if not found.
 */
export async function updateDraft(id: string, input: UpdateDraftInput): Promise<Draft | null> {
  // TODO: Implement with Appwrite (update document).
  return null;
}
