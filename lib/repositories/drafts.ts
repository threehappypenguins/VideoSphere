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
    ...(doc.thumbnailR2Key ? { thumbnailR2Key: doc.thumbnailR2Key } : {}),
    ...(doc.thumbnailContentType ? { thumbnailContentType: doc.thumbnailContentType } : {}),
    ...(doc.usedInUploadAt ? { usedInUploadAt: doc.usedInUploadAt } : {}),
    $createdAt,
    $updatedAt,
  };
}

/**
 * Mark a draft as having been used in an upload job.
 * Stored inside the draft `document` JSON (denormalized) to keep Drafts page fast.
 *
 * Returns the updated draft, or null if not found.
 */
export async function markDraftUsedInUpload(
  id: string,
  usedAtIso: string = new Date().toISOString()
): Promise<Draft | null> {
  const isNotFoundError = (err: unknown): boolean => {
    const e = err as { code?: number };
    return e?.code === 404;
  };

  const buildDocumentJson = (draft: Draft, normalizedUsedAtIso: string) =>
    stringifyDraftDocumentForStorage({
      targets: draft.targets,
      title: draft.title,
      description: draft.description,
      visibility: draft.visibility,
      tags: draft.tags,
      platforms: draft.platforms,
      ...(draft.thumbnailR2Key ? { thumbnailR2Key: draft.thumbnailR2Key } : {}),
      ...(draft.thumbnailContentType ? { thumbnailContentType: draft.thumbnailContentType } : {}),
      usedInUploadAt: normalizedUsedAtIso,
    });

  const current = await getDraftById(id);
  if (!current) return null;

  const normalizeIso = (value: string | undefined): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const t = Date.parse(trimmed);
    if (Number.isNaN(t)) return null;
    return new Date(t).toISOString();
  };

  // Keep the earliest valid timestamp so "first used" remains stable even if
  // calls arrive out of order or prior data was set to a later value.
  const existingIso = normalizeIso(current.usedInUploadAt);
  const incomingIso = normalizeIso(usedAtIso) ?? new Date().toISOString();
  const usedInUploadAt =
    existingIso === null
      ? incomingIso
      : Date.parse(existingIso) <= Date.parse(incomingIso)
        ? existingIso
        : incomingIso;

  const documentJson = buildDocumentJson(current, usedInUploadAt);
  assertDraftDocumentJsonWithinLimit(documentJson);

  let row: unknown;
  try {
    row = await tablesDb.updateRow({
      databaseId: DATABASE_ID,
      tableId: DRAFTS_COLLECTION_ID,
      rowId: id,
      data: { document: documentJson },
    });
  } catch (err: unknown) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
  const updated = rowToDraft(row as unknown as Record<string, unknown>);

  // Best-effort race reconciliation: if a concurrent write stored a later value,
  // try once more using fresh state so "first used" converges back to earliest.
  const persistedIso = normalizeIso(updated.usedInUploadAt);
  if (persistedIso !== null && Date.parse(persistedIso) <= Date.parse(usedInUploadAt)) {
    return updated;
  }

  const latest = await getDraftById(id);
  if (!latest) return updated;
  const latestIso = normalizeIso(latest.usedInUploadAt);
  if (latestIso !== null && Date.parse(latestIso) <= Date.parse(usedInUploadAt)) {
    return latest;
  }

  const reconcileDocumentJson = buildDocumentJson(latest, usedInUploadAt);
  assertDraftDocumentJsonWithinLimit(reconcileDocumentJson);
  let reconciledRow: unknown;
  try {
    reconciledRow = await tablesDb.updateRow({
      databaseId: DATABASE_ID,
      tableId: DRAFTS_COLLECTION_ID,
      rowId: id,
      data: { document: reconcileDocumentJson },
    });
  } catch (err: unknown) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
  return rowToDraft(reconciledRow as unknown as Record<string, unknown>);
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

/**
 * Defines the shape of create draft input.
 */
export interface CreateDraftInput {
  userId: string;
  targets: ConnectedAccountPlatform[];
  title: string;
  description: string;
  /** Shared tags for all targets; default []. */
  tags?: string[];
  visibility?: PlatformUploadVisibility;
  platforms?: DraftPlatforms;
  thumbnailR2Key?: string;
  thumbnailContentType?: string;
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
    ...(input.thumbnailR2Key ? { thumbnailR2Key: input.thumbnailR2Key } : {}),
    ...(input.thumbnailContentType ? { thumbnailContentType: input.thumbnailContentType } : {}),
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

/** Max draft IDs per `listRows` call (Appwrite `equal` with an array is an IN query). */
const DRAFT_TITLES_BY_IDS_BATCH = 100;

/**
 * Titles for drafts referenced by upload jobs on the current page.
 * Only IDs that exist and belong to `userId` are included — one batched `listRows` per chunk of ids.
 */
export async function getDraftTitlesByIdsForUser(
  userId: string,
  draftIds: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const unique = [
    ...new Set(draftIds.filter((id): id is string => typeof id === 'string' && id !== '')),
  ];
  if (unique.length === 0) return new Map();

  const map = new Map<string, string>();
  for (let i = 0; i < unique.length; i += DRAFT_TITLES_BY_IDS_BATCH) {
    const chunk = unique.slice(i, i + DRAFT_TITLES_BY_IDS_BATCH);
    const { rows } = await tablesDb.listRows({
      databaseId: DATABASE_ID,
      tableId: DRAFTS_COLLECTION_ID,
      queries: [
        Query.equal('userId', userId),
        Query.equal('$id', chunk),
        Query.limit(chunk.length),
      ],
      total: false,
    });
    for (const r of rows ?? []) {
      const row = r as Record<string, unknown>;
      const draft = rowToDraft(row);
      map.set(draft.id, draft.title);
    }
  }
  return map;
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

/** Count all drafts for a user. */
export async function countDraftsByUser(userId: string): Promise<number> {
  const result = await tablesDb.listRows({
    databaseId: DATABASE_ID,
    tableId: DRAFTS_COLLECTION_ID,
    queries: [Query.equal('userId', userId), Query.limit(1)],
    total: true,
  });
  return typeof result.total === 'number' ? result.total : 0;
}

/**
 * Defines the shape of draft dashboard summary.
 */
export interface DraftDashboardSummary {
  readyDraftCount: number;
  previewDrafts: Draft[];
}

const APPWRITE_LIST_ROWS_MAX_LIMIT = 100;

function isDraftReadyToUpload(draft: Draft): boolean {
  return typeof draft.usedInUploadAt !== 'string' || draft.usedInUploadAt.trim() === '';
}

/**
 * Summarize drafts for the dashboard without materializing the user's full draft history.
 *
 * Because `usedInUploadAt` is stored inside the draft `document` JSON, Appwrite cannot
 * currently count "ready to upload" drafts server-side with an indexed query. We page
 * through rows and keep only the count plus the first few ready drafts needed for preview.
 *
 * To prevent runaway queries on large draft histories, we stop after scanning `maxRowsScanned`
 * rows (default 500). For users with fewer than this threshold, the count is exact; for those
 * with larger histories, it's an approximation based on the scanned prefix.
 *
 * Future: Move `usedInUploadAt` to an indexed column to enable bounded queries server-side.
 */
export async function getDraftDashboardSummaryByUser(
  userId: string,
  options?: { previewLimit?: number; pageSize?: number; maxRowsScanned?: number }
): Promise<DraftDashboardSummary> {
  const previewLimit = Math.max(0, options?.previewLimit ?? 5);
  const pageSize = Math.min(
    Math.max(1, options?.pageSize ?? APPWRITE_LIST_ROWS_MAX_LIMIT),
    APPWRITE_LIST_ROWS_MAX_LIMIT
  );
  const maxRowsScanned = Math.max(1, options?.maxRowsScanned ?? 500);

  let offset = 0;
  let rowsScanned = 0;
  let readyDraftCount = 0;
  const previewDrafts: Draft[] = [];

  while (rowsScanned < maxRowsScanned) {
    const remainingBudget = maxRowsScanned - rowsScanned;
    const limitForThisPage = Math.min(pageSize, remainingBudget);

    const { rows } = await tablesDb.listRows({
      databaseId: DATABASE_ID,
      tableId: DRAFTS_COLLECTION_ID,
      queries: [
        Query.equal('userId', userId),
        Query.orderDesc('$updatedAt'),
        Query.limit(limitForThisPage),
        Query.offset(offset),
      ],
      total: false,
    });

    const pageDrafts = (rows ?? []).map((r) => rowToDraft(r as unknown as Record<string, unknown>));

    for (const draft of pageDrafts) {
      if (!isDraftReadyToUpload(draft)) continue;
      readyDraftCount += 1;
      if (previewDrafts.length < previewLimit) {
        previewDrafts.push(draft);
      }
    }

    rowsScanned += pageDrafts.length;
    if (pageDrafts.length < limitForThisPage) break;
    if (pageDrafts.length === 0) break;
    offset += limitForThisPage;
  }

  return { readyDraftCount, previewDrafts };
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

/**
 * Defines the shape of update draft input.
 */
export interface UpdateDraftInput {
  targets?: ConnectedAccountPlatform[];
  title?: string;
  description?: string;
  tags?: string[];
  visibility?: PlatformUploadVisibility;
  /** Partial platforms object from PATCH; merged without wiping omitted fields. */
  platformsPatch?: unknown;
  /**
   * Pass `null` to atomically clear both `thumbnailR2Key` and `thumbnailContentType`.
   * Pass a string to set/replace the key (pair with `thumbnailContentType`).
   * Omit to leave the existing key unchanged.
   */
  thumbnailR2Key?: string | null;
  /** Ignored when `thumbnailR2Key` is `null` (both fields are cleared together). */
  thumbnailContentType?: string | null;
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
    input.platformsPatch !== undefined ||
    input.thumbnailR2Key !== undefined ||
    input.thumbnailContentType !== undefined;

  const data: Record<string, unknown> = {};

  if (needsDocMerge) {
    const current = await getDraftById(id);
    if (!current) return null;
    const mergedPlatforms =
      input.platformsPatch !== undefined
        ? mergeDraftPlatformsPatch(current.platforms, input.platformsPatch)
        : current.platforms;
    let nextThumbKey: string | undefined;
    let nextThumbType: string | undefined;
    if (input.thumbnailR2Key === null) {
      nextThumbKey = undefined;
      nextThumbType = undefined;
    } else if (input.thumbnailR2Key !== undefined) {
      nextThumbKey = input.thumbnailR2Key;
      nextThumbType =
        input.thumbnailContentType === undefined
          ? current.thumbnailContentType
          : input.thumbnailContentType === null
            ? undefined
            : input.thumbnailContentType;
    } else {
      nextThumbKey = current.thumbnailR2Key;
      nextThumbType =
        input.thumbnailContentType === undefined
          ? current.thumbnailContentType
          : input.thumbnailContentType === null
            ? undefined
            : input.thumbnailContentType;
    }
    const documentJson = stringifyDraftDocumentForStorage({
      targets: input.targets ?? current.targets,
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      tags: input.tags ?? current.tags,
      visibility: input.visibility ?? current.visibility,
      platforms: mergedPlatforms,
      ...(nextThumbKey !== undefined ? { thumbnailR2Key: nextThumbKey } : {}),
      ...(nextThumbType !== undefined ? { thumbnailContentType: nextThumbType } : {}),
      // Denormalized in document JSON; stringify omits empty/whitespace (see markDraftUsedInUpload).
      usedInUploadAt: current.usedInUploadAt,
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
