// =============================================================================
// DRAFT REPOSITORY
// =============================================================================
// All draft (video metadata) data access goes through this module. API routes
// and Server Components should call these functions only — not the Appwrite
// SDK directly.
//
// Uses Appwrite Server SDK (Tables API) for the drafts table.
// Tags are stored as a JSON string; we JSON.stringify on write and JSON.parse on read.
// =============================================================================

import { ID, Query, TablesDB } from 'node-appwrite';
import type { Draft } from '@/types';
import appwriteClient from '@/lib/appwrite';
import { DATABASE_ID, DRAFTS_COLLECTION_ID } from '@/lib/appwrite-constants';

const tablesDb = new TablesDB(appwriteClient);

/** Parse tags from stored JSON string to string[]. Returns [] if invalid or missing. */
function parseTags(value: unknown): string[] {
  if (value == null || value === '') return [];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

/** Map an Appwrite row to the shared Draft type (tags parsed from JSON). */
function rowToDraft(row: Record<string, unknown>): Draft {
  return {
    id: String(row.$id ?? row.id),
    userId: String(row.userId),
    title: String(row.title),
    description: String(row.description),
    tags: parseTags(row.tags),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export interface CreateDraftInput {
  userId: string;
  title: string;
  description: string;
  tags: string[];
}

/**
 * Create a new draft. Tags are JSON-stringified before write.
 * Returns the created draft with id and timestamps.
 */
export async function createDraft(input: CreateDraftInput): Promise<Draft> {
  const now = new Date().toISOString();
  const row = await tablesDb.createRow({
    databaseId: DATABASE_ID,
    tableId: DRAFTS_COLLECTION_ID,
    rowId: ID.unique(),
    data: {
      userId: input.userId,
      title: input.title,
      description: input.description,
      tags: JSON.stringify(input.tags ?? []),
      createdAt: now,
      updatedAt: now,
    },
  });
  return rowToDraft(row as unknown as Record<string, unknown>);
}

// -----------------------------------------------------------------------------
// Read
// -----------------------------------------------------------------------------

/**
 * Fetch a draft by ID. Returns a typed Draft with tags parsed as string[].
 * Returns null if not found.
 */
export async function getDraftById(id: string): Promise<Draft | null> {
  try {
    const row = await tablesDb.getRow({
      databaseId: DATABASE_ID,
      tableId: DRAFTS_COLLECTION_ID,
      rowId: id,
    });
    return rowToDraft(row as unknown as Record<string, unknown>);
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e.code === 404) return null;
    throw err;
  }
}

/**
 * List drafts for a user, sorted by most recent (updatedAt descending).
 */
export async function listDraftsByUser(userId: string): Promise<Draft[]> {
  const { rows } = await tablesDb.listRows({
    databaseId: DATABASE_ID,
    tableId: DRAFTS_COLLECTION_ID,
    queries: [Query.equal('userId', userId), Query.orderDesc('updatedAt')],
    total: false,
  });
  return (rows ?? []).map((r) => rowToDraft(r as unknown as Record<string, unknown>));
}

// -----------------------------------------------------------------------------
// Update
// -----------------------------------------------------------------------------

export interface UpdateDraftInput {
  title?: string;
  description?: string;
  tags?: string[];
}

/**
 * Update an existing draft. Only provided fields are updated.
 * Tags, if provided, are JSON-stringified before write.
 * Returns the updated draft or null if not found.
 */
export async function updateDraft(id: string, input: UpdateDraftInput): Promise<Draft | null> {
  const data: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.tags !== undefined) data.tags = JSON.stringify(input.tags);

  try {
    const row = await tablesDb.updateRow({
      databaseId: DATABASE_ID,
      tableId: DRAFTS_COLLECTION_ID,
      rowId: id,
      data,
    });
    return rowToDraft(row as unknown as Record<string, unknown>);
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e.code === 404) return null;
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Delete
// -----------------------------------------------------------------------------

/**
 * Remove a draft document by ID.
 */
export async function deleteDraft(id: string): Promise<void> {
  await tablesDb.deleteRow({
    databaseId: DATABASE_ID,
    tableId: DRAFTS_COLLECTION_ID,
    rowId: id,
  });
}
