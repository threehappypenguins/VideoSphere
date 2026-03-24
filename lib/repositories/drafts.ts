// =============================================================================
// DRAFT REPOSITORY
// =============================================================================
// All draft (video metadata) data access goes through this module. API routes
// and Server Components should call these functions only — not the Appwrite
// SDK directly.
//
// Tables: `userId` (indexed, for list queries) + `document` (JSON blob:
// targets, title, description, visibility, tags, platforms).
// =============================================================================

import { ID, Query, TablesDB } from 'node-appwrite';
import type {
  ConnectedAccountPlatform,
  Draft,
  DraftPlatforms,
  PlatformUploadVisibility,
} from '@/types';
import appwriteClient from '@/lib/appwrite';
import { DATABASE_ID, DRAFTS_COLLECTION_ID } from '@/lib/appwrite-constants';
import {
  assertDraftDocumentJsonWithinLimit,
  DEFAULT_DRAFT_VISIBILITY,
  draftDocumentFromRow,
  mergeDraftPlatformsPatch,
  stringifyDraftDocumentForStorage,
} from '@/lib/draft-upload-metadata';
import { assertAppwriteRowTimestamps } from '@/lib/assert-appwrite-row-timestamps';

const tablesDb = new TablesDB(appwriteClient);

/** Map an Appwrite row to the shared Draft type. */
function rowToDraft(row: Record<string, unknown>): Draft {
  const doc = draftDocumentFromRow(row);
  const { $createdAt, $updatedAt } = assertAppwriteRowTimestamps(row);
  return {
    id: String(row.$id ?? row.id),
    userId: String(row.userId),
    targets: doc.targets,
    title: doc.title,
    description: doc.description,
    tags: doc.tags,
    visibility: doc.visibility,
    platforms: doc.platforms,
    $createdAt,
    $updatedAt,
  };
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export interface CreateDraftInput {
  userId: string;
  targets: ConnectedAccountPlatform[];
  title: string;
  description: string;
  /** Shared tags for all targets; default []. */
  tags?: string[];
  visibility?: PlatformUploadVisibility;
  platforms?: DraftPlatforms;
}

/**
 * Create a new draft.
 */
export async function createDraft(input: CreateDraftInput): Promise<Draft> {
  const visibility = input.visibility ?? DEFAULT_DRAFT_VISIBILITY;
  const platforms = input.platforms ?? {};
  const tags = input.tags ?? [];
  const documentJson = stringifyDraftDocumentForStorage({
    targets: input.targets,
    title: input.title,
    description: input.description,
    visibility,
    tags,
    platforms,
  });
  assertDraftDocumentJsonWithinLimit(documentJson);

  const row = await tablesDb.createRow({
    databaseId: DATABASE_ID,
    tableId: DRAFTS_COLLECTION_ID,
    rowId: ID.unique(),
    data: {
      userId: input.userId,
      document: documentJson,
    },
  });
  return rowToDraft(row as unknown as Record<string, unknown>);
}

// -----------------------------------------------------------------------------
// Read
// -----------------------------------------------------------------------------

/**
 * Fetch a draft by ID. Returns null if not found.
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
 * List drafts for a user, sorted by most recent (`$updatedAt` descending).
 */
export async function listDraftsByUser(userId: string): Promise<Draft[]> {
  const { rows } = await tablesDb.listRows({
    databaseId: DATABASE_ID,
    tableId: DRAFTS_COLLECTION_ID,
    queries: [Query.equal('userId', userId), Query.orderDesc('$updatedAt')],
    total: false,
  });
  return (rows ?? []).map((r) => rowToDraft(r as unknown as Record<string, unknown>));
}

/**
 * Count all active draft rows.
 * Drafts currently have no archived/deleted status, so "active" means existing rows.
 */
export async function countActiveDrafts(): Promise<number> {
  const result = await tablesDb.listRows({
    databaseId: DATABASE_ID,
    tableId: DRAFTS_COLLECTION_ID,
    queries: [Query.limit(1)],
    total: true,
  });
  return result.total ?? 0;
}

// -----------------------------------------------------------------------------
// Update
// -----------------------------------------------------------------------------

export interface UpdateDraftInput {
  targets?: ConnectedAccountPlatform[];
  title?: string;
  description?: string;
  tags?: string[];
  visibility?: PlatformUploadVisibility;
  /** Partial platforms object from PATCH; merged without wiping omitted fields. */
  platformsPatch?: unknown;
}

/**
 * Update an existing draft. Only provided fields are updated.
 */
export async function updateDraft(id: string, input: UpdateDraftInput): Promise<Draft | null> {
  const needsDocMerge =
    input.targets !== undefined ||
    input.title !== undefined ||
    input.description !== undefined ||
    input.tags !== undefined ||
    input.visibility !== undefined ||
    input.platformsPatch !== undefined;

  const data: Record<string, unknown> = {};

  if (needsDocMerge) {
    const current = await getDraftById(id);
    if (!current) return null;
    const mergedPlatforms =
      input.platformsPatch !== undefined
        ? mergeDraftPlatformsPatch(current.platforms, input.platformsPatch)
        : current.platforms;
    const documentJson = stringifyDraftDocumentForStorage({
      targets: input.targets ?? current.targets,
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      tags: input.tags ?? current.tags,
      visibility: input.visibility ?? current.visibility,
      platforms: mergedPlatforms,
    });
    assertDraftDocumentJsonWithinLimit(documentJson);
    data.document = documentJson;
  }

  if (Object.keys(data).length === 0) {
    return getDraftById(id);
  }

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
 * Remove a draft row by ID.
 */
export async function deleteDraft(id: string): Promise<void> {
  await tablesDb.deleteRow({
    databaseId: DATABASE_ID,
    tableId: DRAFTS_COLLECTION_ID,
    rowId: id,
  });
}
