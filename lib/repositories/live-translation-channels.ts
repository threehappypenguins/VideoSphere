// =============================================================================
// LIVE TRANSLATION CHANNELS REPOSITORY
// =============================================================================

import { createHash, randomUUID } from 'node:crypto';
import { connectToDatabase } from '@/lib/mongodb';
import {
  LiveTranslationChannelModel,
  type LiveTranslationChannelDocument,
} from '@/lib/models/LiveTranslationChannel';
import { encryptToken, decryptToken, isTokenDecryptError } from '@/lib/crypto/token-encryption';
import {
  isListenReady,
  isTranslationReady,
  normalizeSttProvider,
  type LiveTranslationSttProvider,
  type TranslationCapabilityInput,
} from '@/lib/translation/capabilities';
import { buildRtmpPublishUrl, isRtmpConfigured } from '@/lib/translation/rtmp-config';
import { generateStreamKeyPlaintext, hashStreamKey } from '@/lib/translation/stream-key';
import { suggestTranslationSlug } from '@/lib/translation/slug';
import type { LiveTranslationChannelOwnerView, LiveTranslationChannelPublic } from '@/types';

function hasEncrypted(value: string | undefined): boolean {
  return String(value ?? '').trim().length > 0;
}

function tryDecrypt(ciphertext: string | undefined): string | null {
  const raw = String(ciphertext ?? '').trim();
  if (!raw) return null;
  try {
    return decryptToken(raw);
  } catch (error) {
    if (isTokenDecryptError(error)) {
      console.warn('[live-translation] Failed to decrypt credential field');
      return null;
    }
    throw error;
  }
}

/**
 * Builds capability input from a channel document (presence of secrets only).
 * @param doc - Mongo channel document.
 * @returns Capability fields for readiness checks.
 */
export function capabilityInputFromDoc(
  doc: LiveTranslationChannelDocument
): TranslationCapabilityInput {
  return {
    sttProvider: normalizeSttProvider(doc.sttProvider),
    hasOpenRouterKey: hasEncrypted(doc.openRouterApiKeyEncrypted),
    hasGroqKey: hasEncrypted(doc.groqApiKeyEncrypted),
    sttModel: doc.openRouterSttModel ?? null,
    openRouterTranslateModel: doc.openRouterTranslateModel ?? null,
    hasGcpServiceAccount: hasEncrypted(doc.gcpServiceAccountJsonEncrypted),
    gcpTtsVoice: doc.gcpTtsVoice ?? null,
  };
}

/**
 * Maps a channel document to a public-safe owner view (no secret plaintext).
 * @param doc - Mongo document.
 * @param extras - Optional one-time stream key plaintext for rotate/create.
 * @returns Owner-facing channel view.
 */
export function toOwnerView(
  doc: LiveTranslationChannelDocument,
  extras?: { streamKeyPlaintext?: string }
): LiveTranslationChannelOwnerView {
  const capability = capabilityInputFromDoc(doc);
  const sttModel = doc.openRouterSttModel?.trim() || null;
  const sttProvider = normalizeSttProvider(doc.sttProvider);

  const streamKeyPlaintext = extras?.streamKeyPlaintext;
  const rtmpPublishUrl = streamKeyPlaintext ? buildRtmpPublishUrl(streamKeyPlaintext) : null;

  const publicView: LiveTranslationChannelPublic = {
    id: doc._id,
    userId: doc.userId,
    slug: doc.slug,
    publicEnabled: Boolean(doc.publicEnabled),
    sourceLanguage: doc.sourceLanguage || 'en',
    enabledLanguages: [...(doc.enabledLanguages ?? [])],
    sttProvider,
    sttModel,
    openRouterSttModel: sttModel,
    openRouterTranslateModel: doc.openRouterTranslateModel?.trim() || null,
    gcpTtsVoice: doc.gcpTtsVoice?.trim() || null,
    hasOpenRouterKey: capability.hasOpenRouterKey,
    hasGroqKey: Boolean(capability.hasGroqKey),
    hasGcpServiceAccount: capability.hasGcpServiceAccount,
    hasStreamKey: hasEncrypted(doc.streamKeyHash),
    translationReady: isTranslationReady(capability),
    listenReady: isListenReady(capability),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };

  return {
    ...publicView,
    ...(streamKeyPlaintext ? { streamKeyPlaintext } : {}),
    rtmpPublishUrl,
    rtmpConfigured: isRtmpConfigured(),
  };
}

/**
 * Ensures the authenticated user has a translation channel document.
 * Creates one with a unique slug and a fresh stream key when missing.
 * Call only when the owner is configuring AI credentials — not on page load.
 * @param userId - Authenticated user id.
 * @param slugSeed - Optional seed for initial slug suggestion.
 * @returns Owner view; includes streamKeyPlaintext only on first create.
 */
export async function getOrCreateChannelForUser(
  userId: string,
  slugSeed?: string
): Promise<{ view: LiveTranslationChannelOwnerView; created: boolean }> {
  await connectToDatabase();
  const existing = await LiveTranslationChannelModel.findOne({ userId }).lean().exec();
  if (existing) {
    return { view: toOwnerView(existing), created: false };
  }

  let slug = suggestTranslationSlug(slugSeed);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const clash = await LiveTranslationChannelModel.exists({ slug }).exec();
    if (!clash) break;
    slug = suggestTranslationSlug(slugSeed, attempt + 2);
  }

  const streamKeyPlaintext = generateStreamKeyPlaintext();
  const now = new Date();
  const doc: LiveTranslationChannelDocument = {
    _id: randomUUID(),
    userId,
    slug,
    publicEnabled: false,
    sourceLanguage: 'en',
    enabledLanguages: [],
    sttProvider: 'openrouter',
    streamKeyHash: hashStreamKey(streamKeyPlaintext),
    createdAt: now,
    updatedAt: now,
  };

  await LiveTranslationChannelModel.create(doc);
  return { view: toOwnerView(doc, { streamKeyPlaintext }), created: true };
}

/**
 * Loads a channel by owning user id.
 * @param userId - Owner user id.
 * @returns Document or null.
 */
export async function getChannelByUserId(
  userId: string
): Promise<LiveTranslationChannelDocument | null> {
  await connectToDatabase();
  return LiveTranslationChannelModel.findOne({ userId }).lean().exec();
}

/**
 * Returns the owner view for a user when a channel exists.
 * @param userId - Owner user id.
 * @returns Owner view, or null when no channel has been created yet.
 */
export async function getChannelOwnerViewForUser(
  userId: string
): Promise<LiveTranslationChannelOwnerView | null> {
  const doc = await getChannelByUserId(userId);
  return doc ? toOwnerView(doc) : null;
}

/**
 * Deletes the owner's live translation channel and all stored credentials.
 * @param userId - Owner user id.
 * @returns Deleted channel id when a document was removed; otherwise null.
 */
export async function deleteChannelForUser(userId: string): Promise<string | null> {
  await connectToDatabase();
  const existing = await LiveTranslationChannelModel.findOne({ userId }).lean().exec();
  if (!existing) return null;
  await LiveTranslationChannelModel.deleteOne({ userId }).exec();
  return existing._id;
}

/**
 * Loads a channel by public slug.
 * @param slug - Normalized public slug.
 * @returns Document or null.
 */
export async function getChannelBySlug(
  slug: string
): Promise<LiveTranslationChannelDocument | null> {
  await connectToDatabase();
  return LiveTranslationChannelModel.findOne({ slug }).lean().exec();
}

/**
 * Patch fields accepted for channel updates.
 */
export interface LiveTranslationChannelPatch {
  slug?: string;
  publicEnabled?: boolean;
  sourceLanguage?: string;
  enabledLanguages?: string[];
  sttProvider?: LiveTranslationSttProvider;
  /** STT model id (stored as `openRouterSttModel`). */
  sttModel?: string | null;
  /** @deprecated Prefer `sttModel`. */
  openRouterSttModel?: string | null;
  openRouterTranslateModel?: string | null;
  gcpTtsVoice?: string | null;
}

/**
 * Updates non-secret channel settings for the owning user.
 * @param userId - Owner user id.
 * @param patch - Fields to update.
 * @returns Updated owner view, or null when channel missing.
 */
export async function updateChannelForUser(
  userId: string,
  patch: LiveTranslationChannelPatch
): Promise<LiveTranslationChannelOwnerView | null> {
  await connectToDatabase();

  const $set: Record<string, unknown> = {};
  if (patch.slug !== undefined) $set.slug = patch.slug;
  if (patch.publicEnabled !== undefined) $set.publicEnabled = patch.publicEnabled;
  if (patch.sourceLanguage !== undefined) $set.sourceLanguage = patch.sourceLanguage;
  if (patch.enabledLanguages !== undefined) $set.enabledLanguages = patch.enabledLanguages;
  if (patch.sttProvider !== undefined) $set.sttProvider = normalizeSttProvider(patch.sttProvider);
  const sttModel = patch.sttModel !== undefined ? patch.sttModel : patch.openRouterSttModel;
  if (sttModel !== undefined) {
    $set.openRouterSttModel = sttModel?.trim() || null;
  }
  if (patch.openRouterTranslateModel !== undefined) {
    $set.openRouterTranslateModel = patch.openRouterTranslateModel?.trim() || null;
  }
  if (patch.gcpTtsVoice !== undefined) {
    $set.gcpTtsVoice = patch.gcpTtsVoice?.trim() || null;
  }

  if (Object.keys($set).length === 0) {
    const current = await getChannelByUserId(userId);
    return current ? toOwnerView(current) : null;
  }

  try {
    const updated = await LiveTranslationChannelModel.findOneAndUpdate(
      { userId },
      { $set },
      { new: true }
    )
      .lean()
      .exec();
    return updated ? toOwnerView(updated) : null;
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as { code?: number }).code
        : undefined;
    if (code === 11000) {
      const conflict = new Error('SLUG_TAKEN');
      throw conflict;
    }
    throw error;
  }
}

/**
 * Stores an encrypted OpenRouter API key for the channel owner.
 * @param userId - Owner user id.
 * @param apiKey - Plaintext OpenRouter API key.
 * @returns Updated owner view, or null when channel missing.
 */
export async function setOpenRouterApiKey(
  userId: string,
  apiKey: string
): Promise<LiveTranslationChannelOwnerView | null> {
  await connectToDatabase();
  const updated = await LiveTranslationChannelModel.findOneAndUpdate(
    { userId },
    { $set: { openRouterApiKeyEncrypted: encryptToken(apiKey.trim()) } },
    { new: true }
  )
    .lean()
    .exec();
  return updated ? toOwnerView(updated) : null;
}

/**
 * Stores an encrypted Groq API key for the channel owner.
 * @param userId - Owner user id.
 * @param apiKey - Plaintext Groq API key.
 * @returns Updated owner view, or null when channel missing.
 */
export async function setGroqApiKey(
  userId: string,
  apiKey: string
): Promise<LiveTranslationChannelOwnerView | null> {
  await connectToDatabase();
  const updated = await LiveTranslationChannelModel.findOneAndUpdate(
    { userId },
    { $set: { groqApiKeyEncrypted: encryptToken(apiKey.trim()) } },
    { new: true }
  )
    .lean()
    .exec();
  return updated ? toOwnerView(updated) : null;
}

/**
 * Stores encrypted GCP service-account JSON for the channel owner.
 * @param userId - Owner user id.
 * @param json - Canonical JSON string.
 * @returns Updated owner view, or null when channel missing.
 */
export async function setGcpServiceAccountJson(
  userId: string,
  json: string
): Promise<LiveTranslationChannelOwnerView | null> {
  await connectToDatabase();
  const updated = await LiveTranslationChannelModel.findOneAndUpdate(
    { userId },
    { $set: { gcpServiceAccountJsonEncrypted: encryptToken(json) } },
    { new: true }
  )
    .lean()
    .exec();
  return updated ? toOwnerView(updated) : null;
}

/**
 * Clears a stored credential kind for the channel owner.
 * @param userId - Owner user id.
 * @param kind - Which credential to clear.
 * @returns Updated owner view, or null when channel missing.
 */
export async function clearCredential(
  userId: string,
  kind: 'openrouter' | 'groq' | 'gcp'
): Promise<LiveTranslationChannelOwnerView | null> {
  await connectToDatabase();
  const unset =
    kind === 'openrouter'
      ? { openRouterApiKeyEncrypted: 1 }
      : kind === 'groq'
        ? { groqApiKeyEncrypted: 1 }
        : { gcpServiceAccountJsonEncrypted: 1 };
  const updated = await LiveTranslationChannelModel.findOneAndUpdate(
    { userId },
    { $unset: unset },
    { new: true }
  )
    .lean()
    .exec();
  return updated ? toOwnerView(updated) : null;
}

/**
 * Rotates the RTMP stream key and returns plaintext once.
 * @param userId - Owner user id.
 * @returns Updated owner view with streamKeyPlaintext, or null.
 */
export async function rotateStreamKey(
  userId: string
): Promise<LiveTranslationChannelOwnerView | null> {
  await connectToDatabase();
  const streamKeyPlaintext = generateStreamKeyPlaintext();
  const updated = await LiveTranslationChannelModel.findOneAndUpdate(
    { userId },
    { $set: { streamKeyHash: hashStreamKey(streamKeyPlaintext) } },
    { new: true }
  )
    .lean()
    .exec();
  return updated ? toOwnerView(updated, { streamKeyPlaintext }) : null;
}

/**
 * Server-only decrypted credentials for pipeline workers.
 */
export interface LiveTranslationRuntimeSecrets {
  sttProvider: LiveTranslationSttProvider;
  openRouterApiKey: string | null;
  groqApiKey: string | null;
  gcpServiceAccountJson: string | null;
  sttModel: string | null;
  openRouterTranslateModel: string | null;
  gcpTtsVoice: string | null;
  sourceLanguage: string;
  enabledLanguages: string[];
  translationReady: boolean;
  listenReady: boolean;
}

/**
 * Loads decrypted secrets for the owning channel (never expose to clients).
 * @param userId - Owner user id.
 * @returns Runtime secrets, or null when channel missing.
 */
export async function getRuntimeSecretsForUser(
  userId: string
): Promise<LiveTranslationRuntimeSecrets | null> {
  const doc = await getChannelByUserId(userId);
  if (!doc) return null;

  const openRouterApiKey = tryDecrypt(doc.openRouterApiKeyEncrypted);
  const groqApiKey = tryDecrypt(doc.groqApiKeyEncrypted);
  const gcpServiceAccountJson = tryDecrypt(doc.gcpServiceAccountJsonEncrypted);
  const sttModel = doc.openRouterSttModel?.trim() || null;
  const openRouterTranslateModel = doc.openRouterTranslateModel?.trim() || null;
  const gcpTtsVoice = doc.gcpTtsVoice?.trim() || null;
  const sttProvider = normalizeSttProvider(doc.sttProvider);
  const capability: TranslationCapabilityInput = {
    sttProvider,
    hasOpenRouterKey: Boolean(openRouterApiKey),
    hasGroqKey: Boolean(groqApiKey),
    sttModel,
    openRouterTranslateModel,
    hasGcpServiceAccount: Boolean(gcpServiceAccountJson),
    gcpTtsVoice,
  };

  return {
    sttProvider,
    openRouterApiKey,
    groqApiKey,
    gcpServiceAccountJson,
    sttModel,
    openRouterTranslateModel,
    gcpTtsVoice,
    sourceLanguage: doc.sourceLanguage || 'en',
    enabledLanguages: [...(doc.enabledLanguages ?? [])],
    translationReady: isTranslationReady(capability),
    listenReady: isListenReady(capability),
  };
}

/**
 * Finds a channel by stream key hash for optional RTMP ingest auth.
 * @param streamKeyPlaintext - Candidate stream key from MediaMTX path.
 * @returns Matching document or null.
 */
export async function getChannelByStreamKey(
  streamKeyPlaintext: string
): Promise<LiveTranslationChannelDocument | null> {
  await connectToDatabase();
  const streamKeyHash = hashStreamKey(streamKeyPlaintext);
  return LiveTranslationChannelModel.findOne({ streamKeyHash }).lean().exec();
}

/**
 * Stable id helper for anonymous presence cookies (optional).
 * @param seed - Entropy seed.
 * @returns Hex digest.
 */
export function hashPresenceId(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}
