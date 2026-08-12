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
  normalizeTextTranslateProvider,
  sttProvidesBuiltInTranslation,
  type LiveTranslationCredentialKind,
  type LiveTranslationSttProvider,
  type LiveTranslationTextTranslateProvider,
  type TranslationCapabilityInput,
} from '@/lib/translation/capabilities';
import {
  languagesForTtsConfig,
  normalizeGcpTtsVoices,
  pruneGcpTtsVoicesToLanguages,
  type GcpTtsVoicesMap,
} from '@/lib/translation/gcp-tts-voices';
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
  const hasGcpServiceAccount = hasEncrypted(doc.gcpServiceAccountJsonEncrypted);
  return {
    sttProvider: normalizeSttProvider(doc.sttProvider),
    textTranslateProvider: normalizeTextTranslateProvider(doc.textTranslateProvider),
    hasOpenRouterKey: hasEncrypted(doc.openRouterApiKeyEncrypted),
    hasGroqKey: hasEncrypted(doc.groqApiKeyEncrypted),
    hasDeepgramKey: hasEncrypted(doc.deepgramApiKeyEncrypted),
    hasAssemblyaiKey: hasEncrypted(doc.assemblyaiApiKeyEncrypted),
    hasGladiaKey: hasEncrypted(doc.gladiaApiKeyEncrypted),
    hasSpeechmaticsKey: hasEncrypted(doc.speechmaticsApiKeyEncrypted),
    hasSonioxKey: hasEncrypted(doc.sonioxApiKeyEncrypted),
    sttModel: doc.openRouterSttModel ?? null,
    openRouterTranslateModel: doc.openRouterTranslateModel ?? null,
    hasGcpServiceAccount,
    gcpTtsVoices: normalizeGcpTtsVoices(doc.gcpTtsVoices),
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
  const textTranslateProvider = sttProvidesBuiltInTranslation(sttProvider)
    ? null
    : normalizeTextTranslateProvider(doc.textTranslateProvider);

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
    textTranslateProvider,
    sttModel,
    openRouterSttModel: sttModel,
    openRouterTranslateModel: doc.openRouterTranslateModel?.trim() || null,
    gcpTtsVoices: normalizeGcpTtsVoices(doc.gcpTtsVoices),
    hasOpenRouterKey: capability.hasOpenRouterKey,
    hasGroqKey: Boolean(capability.hasGroqKey),
    hasDeepgramKey: Boolean(capability.hasDeepgramKey),
    hasAssemblyaiKey: Boolean(capability.hasAssemblyaiKey),
    hasGladiaKey: Boolean(capability.hasGladiaKey),
    hasSpeechmaticsKey: Boolean(capability.hasSpeechmaticsKey),
    hasSonioxKey: Boolean(capability.hasSonioxKey),
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
  textTranslateProvider?: LiveTranslationTextTranslateProvider;
  /** STT model id (stored as `openRouterSttModel`). */
  sttModel?: string | null;
  /** @deprecated Prefer `sttModel`. */
  openRouterSttModel?: string | null;
  openRouterTranslateModel?: string | null;
  gcpTtsVoices?: GcpTtsVoicesMap | null;
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
  if (patch.sttProvider !== undefined) {
    const sttProvider = normalizeSttProvider(patch.sttProvider);
    if (sttProvider) $set.sttProvider = sttProvider;
  }
  if (patch.textTranslateProvider !== undefined) {
    const textTranslateProvider = normalizeTextTranslateProvider(patch.textTranslateProvider);
    if (textTranslateProvider) $set.textTranslateProvider = textTranslateProvider;
  }
  const sttModel = patch.sttModel !== undefined ? patch.sttModel : patch.openRouterSttModel;
  if (sttModel !== undefined) {
    $set.openRouterSttModel = sttModel?.trim() || null;
  }
  if (patch.openRouterTranslateModel !== undefined) {
    $set.openRouterTranslateModel = patch.openRouterTranslateModel?.trim() || null;
  }
  if (patch.gcpTtsVoices !== undefined) {
    $set.gcpTtsVoices = normalizeGcpTtsVoices(patch.gcpTtsVoices);
  }

  // Drop TTS voices for languages that are no longer enabled targets (source never has a voice).
  if (patch.sourceLanguage !== undefined || patch.enabledLanguages !== undefined) {
    const current = await getChannelByUserId(userId);
    if (current) {
      const source =
        patch.sourceLanguage !== undefined ? patch.sourceLanguage : current.sourceLanguage || 'en';
      const enabled =
        patch.enabledLanguages !== undefined
          ? patch.enabledLanguages
          : [...(current.enabledLanguages ?? [])];
      const active = languagesForTtsConfig(source, enabled);
      const existingVoices =
        patch.gcpTtsVoices !== undefined
          ? normalizeGcpTtsVoices(patch.gcpTtsVoices)
          : normalizeGcpTtsVoices(current.gcpTtsVoices);
      $set.gcpTtsVoices = pruneGcpTtsVoicesToLanguages(existingVoices, active);
    }
  }

  if (Object.keys($set).length === 0) {
    const current = await getChannelByUserId(userId);
    return current ? toOwnerView(current) : null;
  }

  try {
    const updated = await LiveTranslationChannelModel.findOneAndUpdate(
      { userId },
      { $set },
      { returnDocument: 'after' }
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
    { returnDocument: 'after' }
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
    { returnDocument: 'after' }
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
    { returnDocument: 'after' }
  )
    .lean()
    .exec();
  return updated ? toOwnerView(updated) : null;
}

/**
 * Stores an encrypted streaming ASR API key for the channel owner.
 * @param userId - Owner user id.
 * @param kind - Streaming provider credential kind.
 * @param apiKey - Plaintext API key.
 * @returns Updated owner view, or null when channel missing.
 */
export async function setStreamingAsrApiKey(
  userId: string,
  kind: 'deepgram' | 'assemblyai' | 'gladia' | 'speechmatics' | 'soniox',
  apiKey: string
): Promise<LiveTranslationChannelOwnerView | null> {
  await connectToDatabase();
  const field =
    kind === 'deepgram'
      ? 'deepgramApiKeyEncrypted'
      : kind === 'assemblyai'
        ? 'assemblyaiApiKeyEncrypted'
        : kind === 'gladia'
          ? 'gladiaApiKeyEncrypted'
          : kind === 'speechmatics'
            ? 'speechmaticsApiKeyEncrypted'
            : 'sonioxApiKeyEncrypted';
  const updated = await LiveTranslationChannelModel.findOneAndUpdate(
    { userId },
    { $set: { [field]: encryptToken(apiKey.trim()) } },
    { returnDocument: 'after' }
  )
    .lean()
    .exec();
  return updated ? toOwnerView(updated) : null;
}

/**
 * Clears a stored credential kind for the channel owner.
 * Also clears STT / translate provider selections that depended on that credential
 * so the dashboard does not keep advertising a provider without its key.
 * @param userId - Owner user id.
 * @param kind - Which credential to clear.
 * @returns Updated owner view, or null when channel missing.
 */
export async function clearCredential(
  userId: string,
  kind: LiveTranslationCredentialKind
): Promise<LiveTranslationChannelOwnerView | null> {
  await connectToDatabase();
  const existing = await LiveTranslationChannelModel.findOne({ userId }).lean().exec();
  if (!existing) return null;

  const sttProvider = normalizeSttProvider(existing.sttProvider);
  const textTranslateProvider = normalizeTextTranslateProvider(existing.textTranslateProvider);

  // Clearing GCP removes both the encrypted SA JSON and the voice name so
  // "Add Google Cloud TTS" does not prefill a stale voice after remove.
  const unset: Record<string, 1> =
    kind === 'openrouter'
      ? { openRouterApiKeyEncrypted: 1 }
      : kind === 'groq'
        ? { groqApiKeyEncrypted: 1 }
        : kind === 'gcp'
          ? { gcpServiceAccountJsonEncrypted: 1, gcpTtsVoices: 1 }
          : kind === 'deepgram'
            ? { deepgramApiKeyEncrypted: 1 }
            : kind === 'assemblyai'
              ? { assemblyaiApiKeyEncrypted: 1 }
              : kind === 'gladia'
                ? { gladiaApiKeyEncrypted: 1 }
                : kind === 'speechmatics'
                  ? { speechmaticsApiKeyEncrypted: 1 }
                  : { sonioxApiKeyEncrypted: 1 };

  if (kind === 'groq') {
    if (sttProvider === 'groq') {
      unset.sttProvider = 1;
      unset.openRouterSttModel = 1;
    }
    if (textTranslateProvider === 'groq') {
      unset.textTranslateProvider = 1;
      unset.openRouterTranslateModel = 1;
    }
  } else if (kind === 'openrouter') {
    if (textTranslateProvider === 'openrouter') {
      unset.textTranslateProvider = 1;
      unset.openRouterTranslateModel = 1;
    }
  } else if (kind === 'gcp') {
    if (textTranslateProvider === 'gcp') {
      unset.textTranslateProvider = 1;
    }
  } else if (
    (kind === 'deepgram' && sttProvider === 'deepgram') ||
    (kind === 'assemblyai' && sttProvider === 'assemblyai') ||
    (kind === 'gladia' && sttProvider === 'gladia') ||
    (kind === 'speechmatics' && sttProvider === 'speechmatics') ||
    (kind === 'soniox' && sttProvider === 'soniox')
  ) {
    unset.sttProvider = 1;
  }

  const updated = await LiveTranslationChannelModel.findOneAndUpdate(
    { userId },
    { $unset: unset },
    { returnDocument: 'after' }
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
    { returnDocument: 'after' }
  )
    .lean()
    .exec();
  return updated ? toOwnerView(updated, { streamKeyPlaintext }) : null;
}

/**
 * Server-only decrypted credentials for pipeline workers.
 */
export interface LiveTranslationRuntimeSecrets {
  sttProvider: LiveTranslationSttProvider | null;
  textTranslateProvider: LiveTranslationTextTranslateProvider | null;
  openRouterApiKey: string | null;
  groqApiKey: string | null;
  deepgramApiKey: string | null;
  assemblyaiApiKey: string | null;
  gladiaApiKey: string | null;
  speechmaticsApiKey: string | null;
  sonioxApiKey: string | null;
  gcpServiceAccountJson: string | null;
  sttModel: string | null;
  openRouterTranslateModel: string | null;
  gcpTtsVoices: GcpTtsVoicesMap;
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
  const deepgramApiKey = tryDecrypt(doc.deepgramApiKeyEncrypted);
  const assemblyaiApiKey = tryDecrypt(doc.assemblyaiApiKeyEncrypted);
  const gladiaApiKey = tryDecrypt(doc.gladiaApiKeyEncrypted);
  const speechmaticsApiKey = tryDecrypt(doc.speechmaticsApiKeyEncrypted);
  const sonioxApiKey = tryDecrypt(doc.sonioxApiKeyEncrypted);
  const gcpServiceAccountJson = tryDecrypt(doc.gcpServiceAccountJsonEncrypted);
  const sttModel = doc.openRouterSttModel?.trim() || null;
  const openRouterTranslateModel = doc.openRouterTranslateModel?.trim() || null;
  const gcpTtsVoices = normalizeGcpTtsVoices(doc.gcpTtsVoices);
  const hasGcpServiceAccount = Boolean(gcpServiceAccountJson);
  const sttProvider = normalizeSttProvider(doc.sttProvider);
  const textTranslateProvider = sttProvidesBuiltInTranslation(sttProvider)
    ? null
    : normalizeTextTranslateProvider(doc.textTranslateProvider);
  const capability: TranslationCapabilityInput = {
    sttProvider,
    textTranslateProvider,
    hasOpenRouterKey: Boolean(openRouterApiKey),
    hasGroqKey: Boolean(groqApiKey),
    hasDeepgramKey: Boolean(deepgramApiKey),
    hasAssemblyaiKey: Boolean(assemblyaiApiKey),
    hasGladiaKey: Boolean(gladiaApiKey),
    hasSpeechmaticsKey: Boolean(speechmaticsApiKey),
    hasSonioxKey: Boolean(sonioxApiKey),
    sttModel,
    openRouterTranslateModel,
    hasGcpServiceAccount,
    gcpTtsVoices,
  };

  return {
    sttProvider,
    textTranslateProvider,
    openRouterApiKey,
    groqApiKey,
    deepgramApiKey,
    assemblyaiApiKey,
    gladiaApiKey,
    speechmaticsApiKey,
    sonioxApiKey,
    gcpServiceAccountJson,
    sttModel,
    openRouterTranslateModel,
    gcpTtsVoices,
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
