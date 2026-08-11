// =============================================================================
// In-process live translation session hub (refcount + fan-out)
// =============================================================================
// Single-node only. Multi-replica would need sticky sessions or shared pub/sub.
// =============================================================================

import { randomUUID } from 'node:crypto';
import { getRuntimeSecretsForUser } from '@/lib/repositories/live-translation-channels';
import {
  normalizeTranslationLanguageCode,
  sttLanguageHintForTranslationLanguage,
} from '@/lib/translation/languages';
import { transcribeAudio } from '@/lib/translation/transcribe';
import {
  GroqTranslateRateLimitError,
  OpenRouterTranslateRateLimitError,
  translateLiveCaptionText,
} from '@/lib/translation/translate-text';
import { synthesizeSpeechWithGcp } from '@/lib/translation/gcp-tts';
import { pcm16MonoToWav } from '@/lib/translation/pcm-wav';
import {
  gcpTtsVoiceForLanguage,
  languageCodeHintFromVoiceName,
} from '@/lib/translation/gcp-tts-voices';
import { isNearSilentPcm16, sanitizeSttTranscript } from '@/lib/translation/stt-quality';

const MAX_SEGMENTS = 40;
/** Brief grace for EventSource reconnects; then language work + cached captions are dropped. */
const LANGUAGE_IDLE_MS = 3_000;
const INGEST_IDLE_MS = 45_000;
/** Base backoff after OpenRouter translate 429 (free shared pools). */
const TRANSLATE_RATE_LIMIT_BACKOFF_MS = 20_000;
/** Cap for exponential translate 429 backoff. */
const TRANSLATE_RATE_LIMIT_BACKOFF_MAX_MS = 60_000;
/** Base backoff after Groq/OpenRouter STT 429 (free tiers are often ~20 RPM). */
const STT_RATE_LIMIT_BACKOFF_MS = 15_000;
/** Cap for exponential STT 429 backoff. */
const STT_RATE_LIMIT_BACKOFF_MAX_MS = 60_000;

/** Caption/audio event pushed to public SSE subscribers. */
export interface TranslationHubEvent {
  type: 'caption' | 'status' | 'error' | 'heartbeat';
  segmentId?: string;
  language?: string;
  text?: string;
  audioUrl?: string;
  live?: boolean;
  message?: string;
  ts: number;
}

type Subscriber = {
  id: string;
  language: string;
  wantAudio: boolean;
  send: (event: TranslationHubEvent) => void;
  lastHeartbeatAt: number;
};

type SegmentTranslation = {
  text: string;
  audioId?: string;
};

type Segment = {
  id: string;
  sourceText: string;
  createdAt: number;
  byLanguage: Map<string, SegmentTranslation>;
};

type LanguageBucket = {
  subscribers: Set<Subscriber>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  busy: boolean;
  queue: string[]; // segment ids awaiting translate
  /** When set, pause translate attempts until this timestamp (OpenRouter 429 backoff). */
  rateLimitedUntil: number;
  rateLimitNotifiedAt: number;
  /** Consecutive translate 429s (drives exponential backoff; reset on success). */
  consecutiveRateLimits: number;
  /** Single retry timer while rate-limited (avoids thundering herd). */
  rateLimitTimer: ReturnType<typeof setTimeout> | null;
};

type ChannelSession = {
  channelId: string;
  userId: string;
  ingestActive: boolean;
  lastIngestAt: number;
  ingestIdleTimer: ReturnType<typeof setTimeout> | null;
  processingAudio: boolean;
  audioQueue: Array<{ pcm: Buffer; sampleRate: number }>;
  /** When set, pause STT attempts until this timestamp (provider 429 backoff). */
  sttRateLimitedUntil: number;
  sttRateLimitNotifiedAt: number;
  sttRateLimitTimer: ReturnType<typeof setTimeout> | null;
  /** Consecutive STT 429s (drives exponential backoff; reset on success). */
  sttConsecutiveRateLimits: number;
  segments: Segment[];
  languages: Map<string, LanguageBucket>;
  audioBytes: Map<string, { mime: string; data: Buffer; expiresAt: number }>;
};

/**
 * Process-wide session store. Must live on `globalThis` so Next.js route modules
 * (and HMR reloads) share one Map — otherwise TTS bytes are stored by the SSE
 * route and `/api/translation/public/audio/...` looks up an empty Map → 404.
 */
type GlobalWithTranslationSessions = typeof globalThis & {
  __videosphereTranslationSessions?: Map<string, ChannelSession>;
};

function getSessionsMap(): Map<string, ChannelSession> {
  const g = globalThis as GlobalWithTranslationSessions;
  if (!g.__videosphereTranslationSessions) {
    g.__videosphereTranslationSessions = new Map();
  }
  return g.__videosphereTranslationSessions;
}

const sessions = getSessionsMap();

function now(): number {
  return Date.now();
}

function getOrCreateSession(channelId: string, userId: string): ChannelSession {
  let session = sessions.get(channelId);
  if (!session) {
    session = {
      channelId,
      userId,
      ingestActive: false,
      lastIngestAt: 0,
      ingestIdleTimer: null,
      processingAudio: false,
      audioQueue: [],
      sttRateLimitedUntil: 0,
      sttRateLimitNotifiedAt: 0,
      sttRateLimitTimer: null,
      sttConsecutiveRateLimits: 0,
      segments: [],
      languages: new Map(),
      audioBytes: new Map(),
    };
    sessions.set(channelId, session);
  }
  return session;
}

/**
 * Keeps only the newest PCM chunk (live captions should not burn quota on a backlog).
 * @param session - Channel session.
 */
function coalesceAudioQueueToLatest(session: ChannelSession): void {
  if (session.audioQueue.length <= 1) return;
  const keep = session.audioQueue[session.audioQueue.length - 1];
  session.audioQueue.length = 0;
  if (keep) session.audioQueue.push(keep);
}

/**
 * Computes STT 429 backoff with exponential growth.
 * @param consecutive - Consecutive 429 count (1-based after increment).
 * @returns Delay in milliseconds.
 */
function sttRateLimitBackoffMs(consecutive: number): number {
  const exp = Math.max(0, consecutive - 1);
  return Math.min(STT_RATE_LIMIT_BACKOFF_MAX_MS, STT_RATE_LIMIT_BACKOFF_MS * 2 ** exp);
}

/**
 * Keeps only the newest queued segment id (live captions should not replay a backlog).
 * @param bucket - Language work queue.
 */
function coalesceLanguageQueueToLatest(bucket: LanguageBucket): void {
  if (bucket.queue.length <= 1) return;
  const keep = bucket.queue[bucket.queue.length - 1];
  bucket.queue.length = 0;
  if (keep) bucket.queue.push(keep);
}

/**
 * Computes translate 429 backoff with exponential growth.
 * @param consecutive - Consecutive 429 count for this language (1-based after increment).
 * @returns Delay in milliseconds.
 */
function translateRateLimitBackoffMs(consecutive: number): number {
  const exp = Math.max(0, consecutive - 1);
  return Math.min(TRANSLATE_RATE_LIMIT_BACKOFF_MAX_MS, TRANSLATE_RATE_LIMIT_BACKOFF_MS * 2 ** exp);
}

/**
 * Schedules a single delayed `processLanguageQueue` while rate-limited.
 * @param session - Channel session.
 * @param language - Listen language code.
 * @param waitMs - Delay before retry.
 */
function scheduleTranslateRetry(session: ChannelSession, language: string, waitMs: number): void {
  const bucket = session.languages.get(language);
  if (!bucket || bucket.rateLimitTimer) return;
  bucket.rateLimitTimer = setTimeout(() => {
    bucket.rateLimitTimer = null;
    void processLanguageQueue(session, language);
  }, waitMs);
}

function broadcastLanguage(
  session: ChannelSession,
  language: string,
  event: TranslationHubEvent
): void {
  const bucket = session.languages.get(language);
  if (!bucket) return;
  for (const sub of bucket.subscribers) {
    try {
      // Captions-only listeners must not receive TTS URLs (mute / never tapped Listen).
      const payload = event.audioUrl && !sub.wantAudio ? { ...event, audioUrl: undefined } : event;
      sub.send(payload);
    } catch {
      bucket.subscribers.delete(sub);
    }
  }
}

function broadcastAll(session: ChannelSession, event: TranslationHubEvent): void {
  for (const language of session.languages.keys()) {
    broadcastLanguage(session, language, event);
  }
}

function pruneAudio(session: ChannelSession): void {
  const t = now();
  for (const [id, entry] of session.audioBytes) {
    if (entry.expiresAt <= t) session.audioBytes.delete(id);
  }
}

function trimSegments(session: ChannelSession): void {
  while (session.segments.length > MAX_SEGMENTS) {
    const removed = session.segments.shift();
    if (!removed) break;
    for (const tr of removed.byLanguage.values()) {
      if (tr.audioId) session.audioBytes.delete(tr.audioId);
    }
  }
}

function maybeTeardown(session: ChannelSession): void {
  const hasSubs = [...session.languages.values()].some((b) => b.subscribers.size > 0);
  if (!session.ingestActive && !hasSubs && session.audioQueue.length === 0) {
    if (session.ingestIdleTimer) clearTimeout(session.ingestIdleTimer);
    for (const bucket of session.languages.values()) {
      if (bucket.idleTimer) clearTimeout(bucket.idleTimer);
      if (bucket.rateLimitTimer) clearTimeout(bucket.rateLimitTimer);
    }
    sessions.delete(session.channelId);
  }
}

/**
 * Drops a language bucket and any per-segment captions/audio cached for it.
 * Source transcripts on segments remain in `sourceText` for fresh STT reuse.
 * @param session - Channel session.
 * @param language - Normalized language code.
 */
function purgeLanguageData(session: ChannelSession, language: string): void {
  const bucket = session.languages.get(language);
  if (bucket?.idleTimer) clearTimeout(bucket.idleTimer);
  if (bucket?.rateLimitTimer) clearTimeout(bucket.rateLimitTimer);
  session.languages.delete(language);
  for (const segment of session.segments) {
    const tr = segment.byLanguage.get(language);
    if (tr?.audioId) session.audioBytes.delete(tr.audioId);
    segment.byLanguage.delete(language);
  }
  maybeTeardown(session);
}

function scheduleLanguageIdle(session: ChannelSession, language: string): void {
  const bucket = session.languages.get(language);
  if (!bucket) return;
  if (bucket.idleTimer) clearTimeout(bucket.idleTimer);
  if (bucket.rateLimitTimer) {
    clearTimeout(bucket.rateLimitTimer);
    bucket.rateLimitTimer = null;
  }
  bucket.queue.length = 0;
  bucket.idleTimer = setTimeout(() => {
    const current = session.languages.get(language);
    if (!current || current.subscribers.size > 0) return;
    // No active listeners → stop work and discard cached captions for this language.
    purgeLanguageData(session, language);
  }, LANGUAGE_IDLE_MS);
}

async function processLanguageQueue(session: ChannelSession, language: string): Promise<void> {
  const bucket = session.languages.get(language);
  if (!bucket || bucket.busy) return;

  const waitMs = bucket.rateLimitedUntil - now();
  if (waitMs > 0) {
    coalesceLanguageQueueToLatest(bucket);
    scheduleTranslateRetry(session, language, waitMs);
    return;
  }

  bucket.busy = true;

  try {
    while (bucket.queue.length > 0 && bucket.subscribers.size > 0) {
      const segmentId = bucket.queue.shift();
      if (!segmentId) break;
      const segment = session.segments.find((s) => s.id === segmentId);
      if (!segment) continue;

      // Live preference only — do not sticky-prefer TTS after the listener mutes.
      let existing = segment.byLanguage.get(language);

      if (!existing) {
        const secrets = await getRuntimeSecretsForUser(session.userId);
        if (!secrets?.translationReady) {
          broadcastLanguage(session, language, {
            type: 'error',
            message: 'Translation is not configured for this channel.',
            ts: now(),
          });
          break;
        }

        const sourceLanguage = normalizeTranslationLanguageCode(secrets.sourceLanguage || 'en');
        const isSourceLanguage = language === sourceLanguage;

        // Same as source → captions are the STT transcript only (never call translate).
        if (isSourceLanguage) {
          existing = { text: segment.sourceText };
          segment.byLanguage.set(language, existing);
        } else {
          try {
            const text = await translateLiveCaptionText({
              provider: secrets.textTranslateProvider,
              gcpServiceAccountJson: secrets.gcpServiceAccountJson,
              openRouterApiKey: secrets.openRouterApiKey,
              groqApiKey: secrets.groqApiKey,
              openRouterTranslateModel: secrets.openRouterTranslateModel,
              text: segment.sourceText,
              sourceLanguage,
              targetLanguage: language,
            });
            existing = { text };
            segment.byLanguage.set(language, existing);
            bucket.consecutiveRateLimits = 0;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Translation failed';
            const rateLimitError =
              error instanceof OpenRouterTranslateRateLimitError ||
              error instanceof GroqTranslateRateLimitError
                ? error
                : /\(429\)/.test(message)
                  ? new OpenRouterTranslateRateLimitError(message)
                  : null;
            if (rateLimitError) {
              bucket.queue.push(segmentId);
              coalesceLanguageQueueToLatest(bucket);
              bucket.consecutiveRateLimits += 1;
              const headerBackoffMs =
                rateLimitError.retryAfterSeconds != null
                  ? rateLimitError.retryAfterSeconds * 1000
                  : 0;
              const backoffMs = Math.max(
                headerBackoffMs,
                translateRateLimitBackoffMs(bucket.consecutiveRateLimits)
              );
              bucket.rateLimitedUntil = now() + backoffMs;
              if (now() - bucket.rateLimitNotifiedAt > TRANSLATE_RATE_LIMIT_BACKOFF_MS) {
                bucket.rateLimitNotifiedAt = now();
                broadcastLanguage(session, language, {
                  type: 'error',
                  message:
                    'Translation is temporarily rate-limited. Pausing, then retrying the latest caption. ' +
                    'Tip: with a GCP service account, VideoSphere uses Cloud Translation (much higher free monthly quota) instead of OpenRouter :free models.',
                  ts: now(),
                });
              }
              break;
            }
            broadcastLanguage(session, language, {
              type: 'error',
              message: message.slice(0, 280) || 'Translation failed for a caption segment.',
              ts: now(),
            });
            continue;
          }
        }
      }

      // Abort if listeners left while awaiting translate/TTS.
      if (bucket.subscribers.size === 0) {
        bucket.queue.length = 0;
        break;
      }

      // Re-check after awaits — mute must stop new TTS immediately.
      const stillWantsAudio = [...bucket.subscribers].some((s) => s.wantAudio);
      if (stillWantsAudio && !existing.audioId) {
        const secrets = await getRuntimeSecretsForUser(session.userId);
        const voiceName = gcpTtsVoiceForLanguage(secrets?.gcpTtsVoices, language);
        if (secrets?.gcpServiceAccountJson && voiceName) {
          try {
            const mp3 = await synthesizeSpeechWithGcp({
              serviceAccountJson: secrets.gcpServiceAccountJson,
              voiceName,
              languageCode: languageCodeHintFromVoiceName(voiceName) || language,
              text: existing.text,
            });
            if (mp3.length > 0 && [...bucket.subscribers].some((s) => s.wantAudio)) {
              const audioId = randomUUID();
              session.audioBytes.set(audioId, {
                mime: 'audio/mpeg',
                data: mp3,
                expiresAt: now() + 10 * 60_000,
              });
              existing.audioId = audioId;
              pruneAudio(session);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'TTS failed';
            broadcastLanguage(session, language, {
              type: 'error',
              message,
              ts: now(),
            });
          }
        }
      }

      if (bucket.subscribers.size === 0) {
        bucket.queue.length = 0;
        break;
      }

      broadcastLanguage(session, language, {
        type: 'caption',
        segmentId: segment.id,
        language,
        text: existing.text,
        audioUrl: existing.audioId
          ? `/api/translation/public/audio/${existing.audioId}`
          : undefined,
        ts: segment.createdAt,
      });
    }
  } finally {
    bucket.busy = false;
    if (bucket.queue.length > 0 && bucket.subscribers.size > 0) {
      const delay = Math.max(0, bucket.rateLimitedUntil - now());
      if (delay > 0) {
        coalesceLanguageQueueToLatest(bucket);
        scheduleTranslateRetry(session, language, delay);
      } else {
        void processLanguageQueue(session, language);
      }
    }
  }
}

function enqueueSegmentForActiveLanguages(
  session: ChannelSession,
  segmentId: string,
  sourceLanguage: string
): void {
  for (const [language, bucket] of session.languages) {
    if (bucket.subscribers.size === 0) continue;
    if (language === sourceLanguage) {
      // Transcript already broadcast from STT; only queue when someone wants TTS.
      const needsAudio = [...bucket.subscribers].some((s) => s.wantAudio);
      if (!needsAudio) continue;
    }
    bucket.queue.push(segmentId);
    if (bucket.rateLimitedUntil > now()) {
      coalesceLanguageQueueToLatest(bucket);
    }
    void processLanguageQueue(session, language);
  }
}

async function processAudioQueue(session: ChannelSession): Promise<void> {
  if (session.processingAudio) return;
  if (!session.ingestActive) {
    session.audioQueue.length = 0;
    return;
  }
  if (session.sttRateLimitedUntil > now()) {
    coalesceAudioQueueToLatest(session);
    const waitMs = session.sttRateLimitedUntil - now();
    if (!session.sttRateLimitTimer) {
      session.sttRateLimitTimer = setTimeout(() => {
        session.sttRateLimitTimer = null;
        void processAudioQueue(session);
      }, waitMs);
    }
    return;
  }

  session.processingAudio = true;
  try {
    while (session.audioQueue.length > 0) {
      if (!session.ingestActive) {
        session.audioQueue.length = 0;
        break;
      }
      if (session.sttRateLimitedUntil > now()) {
        break;
      }

      // Live-only: drop older pending chunks before each STT call.
      coalesceAudioQueueToLatest(session);
      const item = session.audioQueue.shift();
      if (!item) break;

      const secrets = await getRuntimeSecretsForUser(session.userId);
      if (!secrets?.translationReady || !secrets.sttModel) {
        broadcastAll(session, {
          type: 'error',
          message: 'Translation is not configured for this channel.',
          ts: now(),
        });
        session.audioQueue.length = 0;
        break;
      }

      // Owner stopped while we were loading secrets / awaiting prior STT.
      if (!session.ingestActive) {
        session.audioQueue.length = 0;
        break;
      }

      // Skip near-silence before STT — Whisper invents “Thank you” / outros on cutoff.
      if (isNearSilentPcm16(item.pcm)) {
        continue;
      }

      const wav = pcm16MonoToWav(item.pcm, item.sampleRate);
      let text = '';
      try {
        text = sanitizeSttTranscript(
          await transcribeAudio({
            provider: secrets.sttProvider,
            openRouterApiKey: secrets.openRouterApiKey,
            groqApiKey: secrets.groqApiKey,
            gcpServiceAccountJson: secrets.gcpServiceAccountJson,
            model: secrets.sttModel,
            audio: wav,
            format: 'wav',
            sampleRateHertz: item.sampleRate,
            language: sttLanguageHintForTranslationLanguage(secrets.sourceLanguage),
          })
        );
        session.sttConsecutiveRateLimits = 0;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'STT failed';
        const rateLimited = /\(429\)/.test(message) || /rate.?limit/i.test(message);
        if (rateLimited) {
          // Keep only the newest chunk so recovery does not burn free RPM on a backlog.
          session.audioQueue.push(item);
          coalesceAudioQueueToLatest(session);
          session.sttConsecutiveRateLimits += 1;
          session.sttRateLimitedUntil =
            now() + sttRateLimitBackoffMs(session.sttConsecutiveRateLimits);
          if (now() - session.sttRateLimitNotifiedAt > STT_RATE_LIMIT_BACKOFF_MS) {
            session.sttRateLimitNotifiedAt = now();
            broadcastAll(session, {
              type: 'error',
              message:
                'Speech-to-text is temporarily rate-limited (common on free STT tiers). Pausing, then retrying the latest audio only.',
              ts: now(),
            });
          }
          break;
        }
        broadcastAll(session, { type: 'error', message, ts: now() });
        continue;
      }

      if (!session.ingestActive) {
        session.audioQueue.length = 0;
        break;
      }

      if (!text) continue;

      const sourceLanguage = normalizeTranslationLanguageCode(secrets.sourceLanguage || 'en');
      const segment: Segment = {
        id: randomUUID(),
        sourceText: text,
        createdAt: now(),
        byLanguage: new Map(),
      };
      // Source language captions are the transcript itself (no translate call).
      segment.byLanguage.set(sourceLanguage, { text });
      session.segments.push(segment);
      trimSegments(session);
      enqueueSegmentForActiveLanguages(session, segment.id, sourceLanguage);

      // Fans subscribed to the source language get live captions without a translate worker.
      broadcastLanguage(session, sourceLanguage, {
        type: 'caption',
        segmentId: segment.id,
        language: sourceLanguage,
        text,
        ts: segment.createdAt,
      });
    }
  } finally {
    session.processingAudio = false;
    if (session.ingestActive && session.audioQueue.length > 0) {
      if (session.sttRateLimitedUntil > now()) {
        const waitMs = session.sttRateLimitedUntil - now();
        if (!session.sttRateLimitTimer) {
          session.sttRateLimitTimer = setTimeout(() => {
            session.sttRateLimitTimer = null;
            void processAudioQueue(session);
          }, waitMs);
        }
      } else {
        void processAudioQueue(session);
      }
    }
  }
}

/**
 * Marks ingest as live for a channel and resets the idle timer.
 * @param channelId - Channel document id.
 * @param userId - Owning user id.
 */
export function markIngestActive(channelId: string, userId: string): void {
  const session = getOrCreateSession(channelId, userId);
  session.ingestActive = true;
  session.lastIngestAt = now();
  if (session.ingestIdleTimer) clearTimeout(session.ingestIdleTimer);
  session.ingestIdleTimer = setTimeout(() => {
    session.ingestActive = false;
    broadcastAll(session, { type: 'status', live: false, ts: now() });
    maybeTeardown(session);
  }, INGEST_IDLE_MS);
  broadcastAll(session, { type: 'status', live: true, ts: now() });
}

/**
 * Queues PCM audio from the owner for shared STT.
 * @param channelId - Channel document id.
 * @param userId - Owning user id.
 * @param pcm - 16-bit LE mono PCM.
 * @param sampleRate - Sample rate Hz.
 */
export function enqueueOwnerPcm(
  channelId: string,
  userId: string,
  pcm: Buffer,
  sampleRate: number
): void {
  const session = getOrCreateSession(channelId, userId);
  markIngestActive(channelId, userId);
  session.audioQueue.push({ pcm, sampleRate });
  // Live-only: never accumulate an STT backlog that will thrash free rate limits.
  coalesceAudioQueueToLatest(session);
  void processAudioQueue(session);
}

/**
 * Returns whether ingest is currently considered live for a channel.
 * @param channelId - Channel document id.
 * @returns True when ingest is active.
 */
export function isChannelLive(channelId: string): boolean {
  return Boolean(sessions.get(channelId)?.ingestActive);
}

/**
 * Counts subscribers for status endpoints.
 * @param channelId - Channel document id.
 * @returns Per-language counts and totals.
 */
export function getSubscriberStats(channelId: string): {
  live: boolean;
  totalSubscribers: number;
  byLanguage: Record<string, number>;
} {
  const session = sessions.get(channelId);
  if (!session) {
    return { live: false, totalSubscribers: 0, byLanguage: {} };
  }
  const byLanguage: Record<string, number> = {};
  let total = 0;
  for (const [language, bucket] of session.languages) {
    byLanguage[language] = bucket.subscribers.size;
    total += bucket.subscribers.size;
  }
  return { live: session.ingestActive, totalSubscribers: total, byLanguage };
}

/**
 * Subscribes a public listener to a language stream with refcount semantics.
 * First subscriber for a non-source language starts translate(+TTS) work.
 * Source language is transcription-only. Last leave clears that language’s cache after a short grace.
 * @param params - Channel, user, language, audio preference, and send callback.
 * @returns Unsubscribe function.
 */
export function subscribePublicListener(params: {
  channelId: string;
  userId: string;
  language: string;
  wantAudio: boolean;
  send: (event: TranslationHubEvent) => void;
}): () => void {
  const { channelId, userId, wantAudio, send } = params;
  const language = normalizeTranslationLanguageCode(params.language);
  const session = getOrCreateSession(channelId, userId);
  const subscriber: Subscriber = {
    id: randomUUID(),
    language,
    wantAudio,
    send,
    lastHeartbeatAt: now(),
  };

  // Add subscriber before any queue work so mute/wantAudio is visible to in-flight TTS checks.
  const bucketReady = (() => {
    let bucket = session.languages.get(language);
    if (!bucket) {
      bucket = {
        subscribers: new Set(),
        idleTimer: null,
        busy: false,
        queue: [],
        rateLimitedUntil: 0,
        rateLimitNotifiedAt: 0,
        consecutiveRateLimits: 0,
        rateLimitTimer: null,
      };
      session.languages.set(language, bucket);
    }
    if (bucket.idleTimer) {
      clearTimeout(bucket.idleTimer);
      bucket.idleTimer = null;
    }
    bucket.subscribers.add(subscriber);
    return bucket;
  })();

  send({ type: 'status', live: session.ingestActive, ts: now() });
  // No historical caption replay — only live segments from this point forward.
  // If this listener wants speech, finish TTS for the latest already-translated
  // segment (e.g. they tapped Listen after captions-only).
  if (wantAudio) {
    for (let i = session.segments.length - 1; i >= 0; i -= 1) {
      const segment = session.segments[i];
      if (!segment) continue;
      const existing = segment.byLanguage.get(language);
      if (existing && !existing.audioId) {
        bucketReady.queue.push(segment.id);
        break;
      }
    }
  }
  void processLanguageQueue(session, language);

  return () => {
    const bucket = session.languages.get(language);
    if (!bucket) {
      maybeTeardown(session);
      return;
    }
    bucket.subscribers.delete(subscriber);
    if (bucket.subscribers.size === 0) {
      // Stop pending translate work immediately; purge cached captions after reconnect grace.
      bucket.queue.length = 0;
      scheduleLanguageIdle(session, language);
    }
    maybeTeardown(session);
  };
}

/**
 * Looks up short-lived TTS audio bytes by id.
 * @param audioId - Audio segment id from caption events.
 * @returns Mime + bytes, or null when missing/expired.
 */
export function getAudioBytes(audioId: string): { mime: string; data: Buffer } | null {
  for (const session of sessions.values()) {
    pruneAudio(session);
    const entry = session.audioBytes.get(audioId);
    if (entry) {
      return { mime: entry.mime, data: entry.data };
    }
  }
  return null;
}

/**
 * Marks ingest stopped immediately (owner clicked stop).
 * Drops queued PCM so STT does not keep calling providers after stop.
 * @param channelId - Channel document id.
 */
export function markIngestStopped(channelId: string): void {
  const session = sessions.get(channelId);
  if (!session) return;
  session.ingestActive = false;
  session.audioQueue.length = 0;
  session.sttRateLimitedUntil = 0;
  if (session.sttRateLimitTimer) {
    clearTimeout(session.sttRateLimitTimer);
    session.sttRateLimitTimer = null;
  }
  if (session.ingestIdleTimer) {
    clearTimeout(session.ingestIdleTimer);
    session.ingestIdleTimer = null;
  }
  broadcastAll(session, { type: 'status', live: false, ts: now() });
  maybeTeardown(session);
}

/**
 * Tears down an in-memory session after the channel document is deleted.
 * @param channelId - Channel document id.
 */
export function disposeChannelSession(channelId: string): void {
  const session = sessions.get(channelId);
  if (!session) return;
  if (session.ingestIdleTimer) {
    clearTimeout(session.ingestIdleTimer);
    session.ingestIdleTimer = null;
  }
  if (session.sttRateLimitTimer) {
    clearTimeout(session.sttRateLimitTimer);
    session.sttRateLimitTimer = null;
  }
  session.audioQueue.length = 0;
  for (const bucket of session.languages.values()) {
    if (bucket.idleTimer) clearTimeout(bucket.idleTimer);
    if (bucket.rateLimitTimer) clearTimeout(bucket.rateLimitTimer);
  }
  broadcastAll(session, {
    type: 'error',
    message: 'This translation channel was deleted.',
    ts: now(),
  });
  sessions.delete(channelId);
}

/**
 * Test helper: clears all in-memory sessions.
 */
export function __resetTranslationSessionsForTests(): void {
  for (const session of sessions.values()) {
    if (session.ingestIdleTimer) clearTimeout(session.ingestIdleTimer);
    if (session.sttRateLimitTimer) clearTimeout(session.sttRateLimitTimer);
    for (const bucket of session.languages.values()) {
      if (bucket.idleTimer) clearTimeout(bucket.idleTimer);
      if (bucket.rateLimitTimer) clearTimeout(bucket.rateLimitTimer);
    }
  }
  sessions.clear();
}
