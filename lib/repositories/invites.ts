import { randomUUID } from 'node:crypto';
import { connectToDatabase } from '@/lib/mongodb';
import {
  InviteTokenModel,
  type InviteTokenDocument,
  type InviteGrantedRole,
  type InviteTokenPurpose,
} from '@/lib/models/InviteToken';
import type { UserRole } from '@/types';

/**
 * Defines an invite token domain type returned by repository helpers.
 */
export interface InviteTokenRecord {
  token: string;
  purpose: InviteTokenPurpose;
  grantedRole?: InviteGrantedRole;
  createdBy?: string;
  createdAt: string;
  expiresAt?: string;
  usedAt?: string;
  usedBy?: string;
}

/**
 * Snapshot of a consumed invite token used to restore it when registration fails.
 */
export interface InviteTokenReleaseSnapshot {
  token: string;
  grantedRole: InviteGrantedRole;
  createdBy?: string;
  createdAt: Date;
  expiresAt?: Date;
}

/**
 * Result of consuming an invite token during registration.
 */
export interface ConsumedInviteToken {
  grantedRole: UserRole;
  releaseSnapshot: InviteTokenReleaseSnapshot;
}

/**
 * Defines options used to create an invitation token.
 */
export interface CreateInviteTokenInput {
  createdBy: string;
  expiresAt?: Date;
  grantedRole?: UserRole;
}

/**
 * Defines the result of setup token bootstrap.
 */
export interface SetupTokenBootstrapResult {
  token: string;
  created: boolean;
}

/**
 * Defines invite list filtering options.
 */
export interface ListInviteTokensOptions {
  includeUsed?: boolean;
  includeSetup?: boolean;
}

function toRecord(doc: InviteTokenDocument): InviteTokenRecord {
  return {
    token: doc.token,
    purpose: doc.purpose,
    grantedRole:
      doc.grantedRole === 'admin' ? 'admin' : doc.purpose === 'invite' ? 'user' : undefined,
    createdBy: typeof doc.createdBy === 'string' ? doc.createdBy : undefined,
    createdAt: new Date(doc.createdAt).toISOString(),
    expiresAt: doc.expiresAt ? new Date(doc.expiresAt).toISOString() : undefined,
    usedAt: doc.usedAt ? new Date(doc.usedAt).toISOString() : undefined,
    usedBy: typeof doc.usedBy === 'string' ? doc.usedBy : undefined,
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  const mongoErr = error as { code?: number } | null;
  return mongoErr?.code === 11000;
}

function isTokenActive(doc: InviteTokenDocument, now: Date): boolean {
  if (doc.usedAt) return false;
  if (doc.expiresAt && doc.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/** Stable document id so only one setup token row can exist in the collection. */
const SETUP_TOKEN_DOCUMENT_ID = 'setup';

/**
 * Removes legacy extra setup-token rows created before singleton enforcement.
 */
async function pruneDuplicateSetupTokens(): Promise<void> {
  await InviteTokenModel.deleteMany({
    purpose: 'setup',
    _id: { $ne: SETUP_TOKEN_DOCUMENT_ID },
  });
}

/**
 * Removes expired invite-token rows. TTL deletion is asynchronous; this keeps the collection tidy.
 * @param now - Reference time for expiry comparison.
 */
async function pruneExpiredInviteTokens(now: Date): Promise<void> {
  await InviteTokenModel.deleteMany({
    purpose: 'invite',
    expiresAt: { $lte: now },
  });
}

/**
 * Returns true when at least one user exists.
 * @returns Whether any user profile exists.
 */
export async function hasAnyUsers(): Promise<boolean> {
  await connectToDatabase();
  const count = await InviteTokenModel.db
    .collection('user_profiles')
    .countDocuments({}, { limit: 1 });
  return count > 0;
}

/**
 * Ensures there is one active setup token while no users exist.
 * @returns Existing or newly created setup token and creation flag.
 */
export async function ensureSetupTokenForFirstRun(): Promise<SetupTokenBootstrapResult | null> {
  await connectToDatabase();

  const userCount = await InviteTokenModel.db
    .collection('user_profiles')
    .countDocuments({}, { limit: 1 });
  if (userCount > 0) return null;

  const now = new Date();
  const existing = await InviteTokenModel.findOne({
    _id: SETUP_TOKEN_DOCUMENT_ID,
    purpose: 'setup',
  }).lean<InviteTokenDocument | null>();

  if (existing && isTokenActive(existing, now)) {
    await pruneDuplicateSetupTokens();
    return { token: existing.token, created: false };
  }

  const token = randomUUID();

  try {
    await InviteTokenModel.create({
      _id: SETUP_TOKEN_DOCUMENT_ID,
      token,
      purpose: 'setup',
      createdAt: now,
    });
    await pruneDuplicateSetupTokens();
    return { token, created: true };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    const retry = await InviteTokenModel.findOne({
      _id: SETUP_TOKEN_DOCUMENT_ID,
      purpose: 'setup',
    }).lean<InviteTokenDocument | null>();
    if (!retry || !isTokenActive(retry, now)) return null;

    await pruneDuplicateSetupTokens();
    return { token: retry.token, created: false };
  }
}

/**
 * Creates a single-use invitation token.
 * @param input - Invite creation input.
 * @returns The created invite token record.
 */
export async function createInviteToken(input: CreateInviteTokenInput): Promise<InviteTokenRecord> {
  await connectToDatabase();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomUUID();
    try {
      const created = await InviteTokenModel.create({
        _id: token,
        token,
        purpose: 'invite',
        grantedRole: input.grantedRole === 'admin' ? 'admin' : 'user',
        createdBy: input.createdBy,
        expiresAt: input.expiresAt,
      });
      return toRecord(created.toObject());
    } catch (error) {
      if (!isDuplicateKeyError(error) || attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error('Failed to generate a unique invite token');
}

/**
 * Lists invite tokens in reverse chronological order.
 * @param options - Optional list filtering options.
 * @returns List of invite token records.
 */
export async function listInviteTokens(
  options: ListInviteTokensOptions = {}
): Promise<InviteTokenRecord[]> {
  await connectToDatabase();

  const now = new Date();
  if (!options.includeSetup) {
    await pruneExpiredInviteTokens(now);
  }

  const query: Record<string, unknown> = {};
  if (!options.includeSetup) {
    query.purpose = 'invite';
    query.$or = [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }];
  }
  if (!options.includeUsed) {
    query.usedAt = { $exists: false };
  }

  const docs = await InviteTokenModel.find(query)
    .sort({ createdAt: -1 })
    .lean<InviteTokenDocument[]>();

  return docs.map(toRecord);
}

/**
 * Returns whether the invite token is currently valid for registration.
 * @param token - Token string from the invite URL.
 * @returns True when token exists, is unused, and is not expired.
 */
export async function isInviteTokenValid(token: string): Promise<boolean> {
  await connectToDatabase();

  const now = new Date();
  const doc = await InviteTokenModel.findOne({
    token,
    purpose: 'invite',
    usedAt: { $exists: false },
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
  }).lean<InviteTokenDocument | null>();

  return Boolean(doc);
}

/**
 * Returns whether the setup token is valid for first-run admin creation.
 * @param token - Setup token from /setup query string.
 * @returns True when token exists, is unused, and no users currently exist.
 */
export async function isSetupTokenValid(token: string): Promise<boolean> {
  await connectToDatabase();

  const userCount = await InviteTokenModel.db
    .collection('user_profiles')
    .countDocuments({}, { limit: 1 });
  if (userCount > 0) return false;

  const now = new Date();
  const doc = await InviteTokenModel.findOne({
    token,
    purpose: 'setup',
    usedAt: { $exists: false },
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
  }).lean<InviteTokenDocument | null>();

  return Boolean(doc);
}

/**
 * Consumes an invite token by deleting it atomically.
 * @param token - Token to consume.
 * @param _usedBy - Reserved user id (kept for call-site compatibility).
 * @returns Consumed invite metadata, or null if token was invalid or already used.
 */
export async function consumeInviteToken(
  token: string,
  _usedBy: string
): Promise<ConsumedInviteToken | null> {
  await connectToDatabase();

  const now = new Date();
  const consumed = await InviteTokenModel.findOneAndDelete({
    token,
    purpose: 'invite',
    usedAt: { $exists: false },
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
  }).lean<InviteTokenDocument | null>();

  if (!consumed) return null;

  return {
    grantedRole: consumed.grantedRole === 'admin' ? 'admin' : 'user',
    releaseSnapshot: {
      token: consumed.token,
      grantedRole: consumed.grantedRole === 'admin' ? 'admin' : 'user',
      createdBy: typeof consumed.createdBy === 'string' ? consumed.createdBy : undefined,
      createdAt: consumed.createdAt,
      expiresAt: consumed.expiresAt,
    },
  };
}

/**
 * Marks the setup token as used in an atomic operation.
 * @param token - Setup token to consume.
 * @param usedBy - User id that consumes this token.
 * @returns True when consumed; false if token was invalid or already used.
 */
export async function consumeSetupToken(token: string, usedBy: string): Promise<boolean> {
  await connectToDatabase();

  const now = new Date();
  const consumed = await InviteTokenModel.findOneAndUpdate(
    {
      token,
      purpose: 'setup',
      usedAt: { $exists: false },
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
    },
    {
      $set: {
        usedAt: now,
        usedBy,
      },
    },
    { returnDocument: 'after' }
  ).lean<InviteTokenDocument | null>();

  return Boolean(consumed);
}

/**
 * Restores an invite token when account creation fails after consume.
 * @param snapshot - Invite token snapshot captured during consume.
 * @returns True when the token was restored.
 */
export async function releaseInviteToken(snapshot: InviteTokenReleaseSnapshot): Promise<boolean> {
  await connectToDatabase();

  try {
    await InviteTokenModel.create({
      _id: snapshot.token,
      token: snapshot.token,
      purpose: 'invite',
      grantedRole: snapshot.grantedRole,
      createdBy: snapshot.createdBy,
      createdAt: snapshot.createdAt,
      expiresAt: snapshot.expiresAt,
    });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return true;
    return false;
  }
}

/**
 * Clears a setup token usage reservation when account creation fails.
 * @param token - Setup token to release.
 * @param reservedUserId - Reserved user id used during consume call.
 * @returns True when release succeeded.
 */
export async function releaseSetupToken(token: string, reservedUserId: string): Promise<boolean> {
  await connectToDatabase();

  const released = await InviteTokenModel.findOneAndUpdate(
    {
      token,
      purpose: 'setup',
      usedBy: reservedUserId,
    },
    {
      $unset: {
        usedAt: 1,
        usedBy: 1,
      },
    },
    { returnDocument: 'after' }
  ).lean<InviteTokenDocument | null>();

  return Boolean(released);
}

/**
 * Revokes an invite token by deleting it.
 * @param token - Invite token to revoke.
 * @returns True when a token was removed.
 */
export async function revokeInviteToken(token: string): Promise<boolean> {
  await connectToDatabase();

  const result = await InviteTokenModel.deleteOne({ token, purpose: 'invite' });
  return result.deletedCount > 0;
}
