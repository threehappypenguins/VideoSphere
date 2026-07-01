// =============================================================================
// DRAFT REPOSITORY
// =============================================================================
// All draft (video metadata) data access goes through this module. API routes
// and Server Components should call these functions only.
//
// Uses Mongoose for the drafts collection.
// =============================================================================

import { randomUUID } from 'crypto';
import type {
  ConnectedAccountPlatform,
  Draft,
  DraftPlatforms,
  PlatformUploadVisibility,
  BackupFileNameSettings,
} from '@/types';
import { connectToDatabase } from '@/lib/mongodb';
import { DraftModel, type DraftDocument } from '@/lib/models/Draft';
import { resolveDraftTitleForStorage } from '@/lib/draft-title';
import {
  backupNamingForStorage,
  mergeBackupFileNameSettingsPatch,
  normalizeBackupFileNameSettings,
} from '@/lib/backup-filename';
import {
  assertDraftDocumentJsonWithinLimit,
  DEFAULT_DRAFT_VISIBILITY,
  draftDocumentFromRow,
  mergeDraftPlatformsPatch,
  stringifyDraftDocumentForStorage,
} from '@/lib/draft-upload-metadata';
import { draftLabelListIncludesEquivalent, normalizeDraftLabel } from '@/lib/draft-labels';

/** Map a MongoDB document to the shared Draft type. */
function mongoDocToDraft(doc: DraftDocument): Draft {
  const parsed = draftDocumentFromRow({ document: doc.document });
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    targets: parsed.targets,
    title: parsed.title,
    description: parsed.description,
    tags: parsed.tags,
    labels: parsed.labels,
    visibility: parsed.visibility,
    platforms: parsed.platforms,
    backupNaming: parsed.backupNaming,
    ...(parsed.thumbnailR2Key ? { thumbnailR2Key: parsed.thumbnailR2Key } : {}),
    ...(parsed.thumbnailContentType ? { thumbnailContentType: parsed.thumbnailContentType } : {}),
    ...(parsed.usedInUploadAt ? { usedInUploadAt: parsed.usedInUploadAt } : {}),
    $createdAt: new Date(doc.createdAt).toISOString(),
    $updatedAt: new Date(doc.updatedAt).toISOString(),
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
  const buildDocumentJson = (draft: Draft, normalizedUsedAtIso: string) =>
    stringifyDraftDocumentForStorage({
      targets: draft.targets,
      title: draft.title,
      description: draft.description,
      visibility: draft.visibility,
      tags: draft.tags,
      labels: draft.labels,
      platforms: draft.platforms,
      backupNaming: draft.backupNaming,
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

  await connectToDatabase();
  const updatedDoc = await DraftModel.findByIdAndUpdate(
    id,
    { document: documentJson },
    { returnDocument: 'after', runValidators: true }
  ).lean<DraftDocument | null>();
  if (!updatedDoc) return null;
  const updated = mongoDocToDraft(updatedDoc);

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

  const reconciled = await DraftModel.findByIdAndUpdate(
    id,
    { document: reconcileDocumentJson },
    { returnDocument: 'after', runValidators: true }
  ).lean<DraftDocument | null>();
  if (!reconciled) return null;
  return mongoDocToDraft(reconciled);
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
  /** Organizational draft labels; default []. */
  labels?: string[];
  visibility?: PlatformUploadVisibility;
  platforms?: DraftPlatforms;
  backupNaming?: BackupFileNameSettings;
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
  const labels = input.labels ?? [];
  const title = resolveDraftTitleForStorage({
    title: input.title,
    targets: input.targets,
    platforms,
  });
  const documentJson = stringifyDraftDocumentForStorage({
    targets: input.targets,
    title,
    description: input.description,
    visibility,
    tags,
    labels,
    platforms,
    backupNaming: backupNamingForStorage(input.backupNaming),
    ...(input.thumbnailR2Key ? { thumbnailR2Key: input.thumbnailR2Key } : {}),
    ...(input.thumbnailContentType ? { thumbnailContentType: input.thumbnailContentType } : {}),
  });
  assertDraftDocumentJsonWithinLimit(documentJson);

  await connectToDatabase();
  const created = await DraftModel.create({
    _id: randomUUID(),
    userId: input.userId,
    document: documentJson,
  });
  return mongoDocToDraft(created.toObject());
}

// -----------------------------------------------------------------------------
// Read
// -----------------------------------------------------------------------------

/**
 * Fetch a draft by ID. Returns null if not found.
 */
export async function getDraftById(id: string): Promise<Draft | null> {
  await connectToDatabase();
  const doc = await DraftModel.findById(id).lean<DraftDocument | null>();
  if (!doc) return null;
  return mongoDocToDraft(doc);
}

/** Max draft IDs per query batch. */
const DRAFT_TITLES_BY_IDS_BATCH = 100;

/**
 * Titles for drafts referenced by upload jobs on the current page.
 * Only IDs that exist and belong to `userId` are included — one batched query per chunk of ids.
 */
export async function getDraftTitlesByIdsForUser(
  userId: string,
  draftIds: Array<string | null | undefined>
): Promise<Map<string, string>> {
  await connectToDatabase();
  const unique = [
    ...new Set(draftIds.filter((id): id is string => typeof id === 'string' && id !== '')),
  ];
  if (unique.length === 0) return new Map();

  const map = new Map<string, string>();
  for (let i = 0; i < unique.length; i += DRAFT_TITLES_BY_IDS_BATCH) {
    const chunk = unique.slice(i, i + DRAFT_TITLES_BY_IDS_BATCH);
    const docs = await DraftModel.find({ userId, _id: { $in: chunk } })
      .select({ _id: 1, document: 1, userId: 1, createdAt: 1, updatedAt: 1 })
      .lean<DraftDocument[]>();

    for (const doc of docs) {
      const draft = mongoDocToDraft(doc);
      map.set(draft.id, draft.title);
    }
  }
  return map;
}

/**
 * List drafts for a user, sorted by most recent (`$updatedAt` descending).
 */
export async function listDraftsByUser(userId: string): Promise<Draft[]> {
  await connectToDatabase();
  const docs = await DraftModel.find({ userId }).sort({ updatedAt: -1 }).lean<DraftDocument[]>();
  return docs.map(mongoDocToDraft);
}

/** Count all drafts for a user. */
export async function countDraftsByUser(userId: string): Promise<number> {
  await connectToDatabase();
  return DraftModel.countDocuments({ userId });
}

/**
 * Defines the shape of draft dashboard summary.
 */
export interface DraftDashboardSummary {
  readyDraftCount: number;
  previewDrafts: Draft[];
}

const LIST_DRAFTS_PAGE_SIZE_MAX = 100;

function isDraftReadyToUpload(draft: Draft): boolean {
  return typeof draft.usedInUploadAt !== 'string' || draft.usedInUploadAt.trim() === '';
}

/**
 * Summarize drafts for the dashboard without materializing the user's full draft history.
 */
export async function getDraftDashboardSummaryByUser(
  userId: string,
  options?: { previewLimit?: number; pageSize?: number; maxRowsScanned?: number }
): Promise<DraftDashboardSummary> {
  await connectToDatabase();

  const previewLimit = Math.max(0, options?.previewLimit ?? 5);
  const pageSize = Math.min(
    Math.max(1, options?.pageSize ?? LIST_DRAFTS_PAGE_SIZE_MAX),
    LIST_DRAFTS_PAGE_SIZE_MAX
  );
  const maxRowsScanned = Math.max(1, options?.maxRowsScanned ?? 500);

  let offset = 0;
  let rowsScanned = 0;
  let readyDraftCount = 0;
  const previewDrafts: Draft[] = [];

  while (rowsScanned < maxRowsScanned) {
    const remainingBudget = maxRowsScanned - rowsScanned;
    const limitForThisPage = Math.min(pageSize, remainingBudget);

    const docs = await DraftModel.find({ userId })
      .sort({ updatedAt: -1 })
      .skip(offset)
      .limit(limitForThisPage)
      .lean<DraftDocument[]>();

    const pageDrafts = docs.map(mongoDocToDraft);

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
  await connectToDatabase();
  return DraftModel.countDocuments({});
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
  labels?: string[];
  visibility?: PlatformUploadVisibility;
  /** Partial platforms object from PATCH; merged without wiping omitted fields. */
  platformsPatch?: unknown;
  /** Backup filename settings; merged when provided as a partial object. */
  backupNaming?: BackupFileNameSettings;
  backupNamingPatch?: unknown;
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
    input.labels !== undefined ||
    input.visibility !== undefined ||
    input.platformsPatch !== undefined ||
    input.backupNaming !== undefined ||
    input.backupNamingPatch !== undefined ||
    input.thumbnailR2Key !== undefined ||
    input.thumbnailContentType !== undefined;

  if (!needsDocMerge) {
    return getDraftById(id);
  }

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

  const title = resolveDraftTitleForStorage({
    title: input.title !== undefined ? input.title : current.title,
    targets: input.targets ?? current.targets,
    platforms: mergedPlatforms,
  });

  const mergedBackupNaming =
    input.backupNamingPatch !== undefined
      ? mergeBackupFileNameSettingsPatch(current.backupNaming, input.backupNamingPatch)
      : input.backupNaming !== undefined
        ? normalizeBackupFileNameSettings(input.backupNaming)
        : current.backupNaming;
  const backupNaming =
    input.backupNamingPatch !== undefined || input.backupNaming !== undefined
      ? backupNamingForStorage(mergedBackupNaming)
      : mergedBackupNaming;

  const documentJson = stringifyDraftDocumentForStorage({
    targets: input.targets ?? current.targets,
    title,
    description: input.description ?? current.description,
    tags: input.tags ?? current.tags,
    labels: input.labels ?? current.labels,
    visibility: input.visibility ?? current.visibility,
    platforms: mergedPlatforms,
    backupNaming,
    ...(nextThumbKey !== undefined ? { thumbnailR2Key: nextThumbKey } : {}),
    ...(nextThumbType !== undefined ? { thumbnailContentType: nextThumbType } : {}),
    usedInUploadAt: current.usedInUploadAt,
  });
  assertDraftDocumentJsonWithinLimit(documentJson);

  await connectToDatabase();
  const updated = await DraftModel.findByIdAndUpdate(
    id,
    { document: documentJson },
    { returnDocument: 'after', runValidators: true }
  ).lean<DraftDocument | null>();
  if (!updated) return null;
  return mongoDocToDraft(updated);
}

/**
 * Removes an organizational label from every draft owned by a user.
 * @param userId - Draft owner id.
 * @param label - Label to remove (case-insensitive match).
 */
export async function removeLabelFromAllDraftsForUser(
  userId: string,
  label: string
): Promise<void> {
  const normalizedTarget = normalizeDraftLabel(label);
  if (!normalizedTarget) return;

  await connectToDatabase();
  const rows = await DraftModel.find({ userId })
    .select({ _id: 1, document: 1 })
    .lean<Pick<DraftDocument, '_id' | 'document'>[]>();
  const now = new Date();
  const bulkOps: Array<{
    updateOne: {
      filter: { _id: string };
      update: { $set: { document: string; updatedAt: Date } };
    };
  }> = [];

  for (const row of rows) {
    const parsed = draftDocumentFromRow({ document: row.document });
    if (!draftLabelListIncludesEquivalent(parsed.labels, normalizedTarget)) {
      continue;
    }

    const nextLabels = parsed.labels.filter(
      (existing) => !draftLabelListIncludesEquivalent([normalizedTarget], existing)
    );
    const documentJson = stringifyDraftDocumentForStorage({
      ...parsed,
      labels: nextLabels,
    });
    assertDraftDocumentJsonWithinLimit(documentJson);
    bulkOps.push({
      updateOne: {
        filter: { _id: row._id },
        update: { $set: { document: documentJson, updatedAt: now } },
      },
    });
  }

  if (bulkOps.length === 0) return;

  await DraftModel.bulkWrite(bulkOps, { ordered: false });
}

// -----------------------------------------------------------------------------
// Delete
// -----------------------------------------------------------------------------

/**
 * Remove a draft document by ID.
 */
export async function deleteDraft(id: string): Promise<void> {
  await connectToDatabase();
  await DraftModel.deleteOne({ _id: id });
}
