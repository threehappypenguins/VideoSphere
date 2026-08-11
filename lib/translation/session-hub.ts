// =============================================================================
// In-process live translation session hub (refcount + fan-out)
// =============================================================================
// Single-node only. Multi-replica would need sticky sessions or shared pub/sub.
// =============================================================================

import { randomUUID } from 'node:crypto';
import { getRuntimeSecretsForUser } from '@/lib/repositories/live-translation-channels';
import {
  isStreamingSttProvider,
  sttProvidesBuiltInTranslation,
  type LiveTranslationStreamingSttProvider,
} from '@/lib/translation/capabilities';
import {
  normalizeTranslationLanguageCode,
  sttLanguageHintForTranslationLanguage,
} from '@/lib/translation/languages';
import { createStreamingAsrSession } from '@/lib/translation/streaming-asr';
import type { StreamingAsrEvent, StreamingAsrSession } from '@/lib/translation/streaming-asr/types';
import { transcribeAudio } from '@/lib/translation/transcribe';
import {
  GroqTranslateRateLimitError,
  OpenRouterTranslateRateLimitError,
  translateLiveCaptionText,
} from '@/lib/translation/translate-text';
import { buildRecentSourceContext } from '@/lib/translation/mt-prompt';
import { repairSermonTranslation } from '@/lib/translation/sermon-source-clarify';
import { synthesizeSpeechWithGcp } from '@/lib/translation/gcp-tts';
import { pcm16MonoToWav } from '@/lib/translation/pcm-wav';
import {
  gcpTtsVoiceForLanguage,
  languageCodeHintFromVoiceName,
} from '@/lib/translation/gcp-tts-voices';
import { isNearSilentPcm16, sanitizeSttTranscript } from '@/lib/translation/stt-quality';
import { TRANSLATION_SESSIONS_GLOBAL_KEY } from '@/lib/translation/is-channel-live';

export { isChannelLive } from '@/lib/translation/is-channel-live';

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
  /** Segment ids waiting for ordered TTS delivery (never coalesced). */
  ttsQueue: string[];
  ttsBusy: boolean;
  /**
   * In-flight TTS synthesis by segment id. Jobs start as soon as a segment is
   * queued so later lines synthesize while earlier ones play; delivery stays ordered.
   */
  ttsJobs: Map<string, Promise<TtsJobResult | null>>;
  /** When set, pause translate attempts until this timestamp (OpenRouter 429 backoff). */
  rateLimitedUntil: number;
  rateLimitNotifiedAt: number;
  /** Consecutive translate 429s (drives exponential backoff; reset on success). */
  consecutiveRateLimits: number;
  /** Single retry timer while rate-limited (avoids thundering herd). */
  rateLimitTimer: ReturnType<typeof setTimeout> | null;
};

/** Successful TTS job payload ready to broadcast. */
type TtsJobResult = {
  segmentId: string;
  text: string;
  audioId: string;
  createdAt: number;
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
  /** Non-Soniox streaming ASR (single upstream). */
  streamingAsr: StreamingAsrSession | null;
  /** In-flight open for non-Soniox streaming ASR. */
  streamingAsrStarting: Promise<void> | null;
  /** Soniox: one session per active listen language. */
  sonioxByLanguage: Map<string, StreamingAsrSession>;
  /** In-flight Soniox open per language. */
  sonioxStarting: Map<string, Promise<void>>;
  /** Partial caption segment id for the active utterance (streaming). */
  streamingPartialSegmentId: string | null;
};

/**
 * Process-wide session store. Must live on `globalThis` so Next.js route modules
 * (and HMR reloads) share one Map — otherwise TTS bytes are stored by the SSE
 * route and `/api/translation/public/audio/...` looks up an empty Map → 404.
 */
type GlobalWithTranslationSessions = typeof globalThis & {
  [TRANSLATION_SESSIONS_GLOBAL_KEY]?: Map<string, ChannelSession>;
};

function getSessionsMap(): Map<string, ChannelSession> {
  const g = globalThis as GlobalWithTranslationSessions;
  if (!g[TRANSLATION_SESSIONS_GLOBAL_KEY]) {
    g[TRANSLATION_SESSIONS_GLOBAL_KEY] = new Map();
  }
  return g[TRANSLATION_SESSIONS_GLOBAL_KEY];
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
      streamingAsr: null,
      streamingAsrStarting: null,
      sonioxByLanguage: new Map(),
      sonioxStarting: new Map(),
      streamingPartialSegmentId: null,
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
  // Spoken listen needs every caption line — dropping the middle of the queue
  // leaves gaps in the audio (captions still appear from STT/partials).
  if ([...bucket.subscribers].some((s) => s.wantAudio)) return;
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

/**
 * Returns whether any public listener is currently subscribed.
 * @param session - Channel session.
 * @returns True when at least one listen language has a subscriber.
 */
function sessionHasListeners(session: ChannelSession): boolean {
  return [...session.languages.values()].some((b) => b.subscribers.size > 0);
}

function maybeTeardown(session: ChannelSession): void {
  const hasSubs = sessionHasListeners(session);
  if (!session.ingestActive && !hasSubs && session.audioQueue.length === 0) {
    if (session.ingestIdleTimer) clearTimeout(session.ingestIdleTimer);
    for (const bucket of session.languages.values()) {
      if (bucket.idleTimer) clearTimeout(bucket.idleTimer);
      if (bucket.rateLimitTimer) clearTimeout(bucket.rateLimitTimer);
    }
    void closeAllStreamingAsr(session);
    sessions.delete(session.channelId);
  }
}

/**
 * Closes the shared (non-Soniox) streaming ASR socket without touching Soniox maps.
 * Used when the last listener leaves while owner ingest may still be active.
 * @param session - Channel session.
 */
async function closeSingleStreamingAsr(session: ChannelSession): Promise<void> {
  const single = session.streamingAsr;
  session.streamingAsr = null;
  session.streamingAsrStarting = null;
  session.streamingPartialSegmentId = null;
  if (single) {
    await single.close().catch(() => undefined);
  }
}

/**
 * Closes all upstream streaming ASR sockets for a session.
 * @param session - Channel session.
 */
async function closeAllStreamingAsr(session: ChannelSession): Promise<void> {
  const single = session.streamingAsr;
  session.streamingAsr = null;
  session.streamingAsrStarting = null;
  session.streamingPartialSegmentId = null;
  const soniox = [...session.sonioxByLanguage.entries()];
  session.sonioxByLanguage.clear();
  session.sonioxStarting.clear();
  await Promise.allSettled([
    single ? single.close() : Promise.resolve(),
    ...soniox.map(([, s]) => s.close()),
  ]);
}

/**
 * Returns the streaming API key for the configured provider.
 * @param secrets - Runtime secrets.
 * @param provider - Streaming provider id.
 * @returns API key or null.
 */
function streamingApiKeyForProvider(
  secrets: NonNullable<Awaited<ReturnType<typeof getRuntimeSecretsForUser>>>,
  provider: LiveTranslationStreamingSttProvider
): string | null {
  if (provider === 'deepgram') return secrets.deepgramApiKey;
  if (provider === 'assemblyai') return secrets.assemblyaiApiKey;
  if (provider === 'gladia') return secrets.gladiaApiKey;
  if (provider === 'speechmatics') return secrets.speechmaticsApiKey;
  if (provider === 'soniox') return secrets.sonioxApiKey;
  return null;
}

/**
 * Handles a streaming ASR event for non-Soniox providers (source text only).
 * @param session - Channel session.
 * @param event - ASR event.
 * @param sourceLanguage - Normalized source language.
 */
function handleSourceStreamingEvent(
  session: ChannelSession,
  event: StreamingAsrEvent,
  sourceLanguage: string
): void {
  if (event.kind === 'error') {
    broadcastAll(session, {
      type: 'error',
      message: event.message.slice(0, 280),
      ts: now(),
    });
    return;
  }

  const text = sanitizeSttTranscript(event.text);
  if (!text) return;

  if (event.kind === 'partial') {
    let segmentId = session.streamingPartialSegmentId;
    if (!segmentId) {
      segmentId = randomUUID();
      session.streamingPartialSegmentId = segmentId;
      const segment: Segment = {
        id: segmentId,
        sourceText: text,
        createdAt: now(),
        byLanguage: new Map([[sourceLanguage, { text }]]),
      };
      session.segments.push(segment);
      trimSegments(session);
    } else {
      const segment = session.segments.find((s) => s.id === segmentId);
      if (segment) {
        segment.sourceText = text;
        segment.byLanguage.set(sourceLanguage, { text });
      }
    }
    broadcastLanguage(session, sourceLanguage, {
      type: 'caption',
      segmentId,
      language: sourceLanguage,
      text,
      ts: now(),
    });
    return;
  }

  // final
  let segmentId = session.streamingPartialSegmentId;
  session.streamingPartialSegmentId = null;
  if (!segmentId) {
    segmentId = randomUUID();
    const segment: Segment = {
      id: segmentId,
      sourceText: text,
      createdAt: now(),
      byLanguage: new Map([[sourceLanguage, { text }]]),
    };
    session.segments.push(segment);
    trimSegments(session);
  } else {
    const segment = session.segments.find((s) => s.id === segmentId);
    if (segment) {
      segment.sourceText = text;
      segment.byLanguage.set(sourceLanguage, { text });
    }
  }

  broadcastLanguage(session, sourceLanguage, {
    type: 'caption',
    segmentId,
    language: sourceLanguage,
    text,
    ts: now(),
  });
  enqueueSegmentForActiveLanguages(session, segmentId, sourceLanguage);
}

/**
 * Handles Soniox events for a specific listen-language stream.
 * Target streams ignore originals; source streams ignore translations.
 * @param session - Channel session.
 * @param listenLanguage - Language this Soniox socket was opened for.
 * @param sourceLanguage - Channel source language.
 * @param event - ASR event.
 */
function handleSonioxStreamingEvent(
  session: ChannelSession,
  listenLanguage: string,
  sourceLanguage: string,
  event: StreamingAsrEvent
): void {
  if (event.kind === 'error') {
    broadcastLanguage(session, listenLanguage, {
      type: 'error',
      message: event.message.slice(0, 280),
      ts: now(),
    });
    return;
  }

  const isSourceStream = listenLanguage === sourceLanguage;
  if (isSourceStream && event.isTranslation) return;
  if (!isSourceStream && !event.isTranslation) return;

  const rawText = sanitizeSttTranscript(event.text);
  if (!rawText) return;
  const language = listenLanguage;
  // Soniox skips our MT stack; still run Mandarin/Cantonese confession repairs.
  const partialId = session.streamingPartialSegmentId;
  const text = !isSourceStream
    ? repairSermonTranslation({
        sourceText:
          (partialId && session.segments.find((s) => s.id === partialId)?.sourceText) || '',
        recentSourceContext: partialId
          ? buildRecentSourceContext(session.segments, partialId)
          : session.segments
              .slice(-4)
              .map((s) => s.sourceText)
              .filter(Boolean)
              .join('\n'),
        translatedText: rawText,
        targetLanguage: language,
      })
    : rawText;

  if (event.kind === 'partial') {
    let segmentId = session.streamingPartialSegmentId;
    if (!segmentId) {
      segmentId = randomUUID();
      session.streamingPartialSegmentId = segmentId;
      const segment: Segment = {
        id: segmentId,
        sourceText: isSourceStream ? text : '',
        createdAt: now(),
        byLanguage: new Map([[language, { text }]]),
      };
      session.segments.push(segment);
      trimSegments(session);
    } else {
      const segment = session.segments.find((s) => s.id === segmentId);
      if (segment) {
        if (isSourceStream) segment.sourceText = text;
        segment.byLanguage.set(language, { text });
      }
    }
    broadcastLanguage(session, language, {
      type: 'caption',
      segmentId,
      language,
      text,
      ts: now(),
    });
    return;
  }

  let segmentId = session.streamingPartialSegmentId;
  // Keep partial id across languages until all streams finalize — reset only on source finals
  // or when this language finalizes a standalone segment.
  if (isSourceStream) {
    session.streamingPartialSegmentId = null;
  }
  if (!segmentId) {
    segmentId = randomUUID();
    const segment: Segment = {
      id: segmentId,
      sourceText: isSourceStream ? text : '',
      createdAt: now(),
      byLanguage: new Map([[language, { text }]]),
    };
    session.segments.push(segment);
    trimSegments(session);
  } else {
    const segment = session.segments.find((s) => s.id === segmentId);
    if (segment) {
      if (isSourceStream) segment.sourceText = text;
      segment.byLanguage.set(language, { text });
    }
  }

  broadcastLanguage(session, language, {
    type: 'caption',
    segmentId,
    language,
    text,
    ts: now(),
  });

  // Queue for TTS only (translation already present on the segment).
  const bucket = session.languages.get(language);
  if (bucket && [...bucket.subscribers].some((s) => s.wantAudio)) {
    enqueueTts(session, language, segmentId);
  }
}

/**
 * Ensures a non-Soniox streaming ASR session is open.
 * Opens only while owner ingest is active and at least one listener is subscribed.
 * @param session - Channel session.
 */
async function ensureSingleStreamingAsr(session: ChannelSession): Promise<void> {
  if (!session.ingestActive || !sessionHasListeners(session)) {
    await closeSingleStreamingAsr(session);
    return;
  }
  if (session.streamingAsr) return;
  if (session.streamingAsrStarting) {
    await session.streamingAsrStarting;
    return;
  }

  session.streamingAsrStarting = (async () => {
    if (!session.ingestActive || !sessionHasListeners(session)) return;
    const secrets = await getRuntimeSecretsForUser(session.userId);
    if (!secrets?.translationReady || !secrets.sttProvider) {
      broadcastAll(session, {
        type: 'error',
        message: 'Translation is not configured for this channel.',
        ts: now(),
      });
      return;
    }
    if (!isStreamingSttProvider(secrets.sttProvider) || secrets.sttProvider === 'soniox') {
      return;
    }
    const provider = secrets.sttProvider as LiveTranslationStreamingSttProvider;
    const apiKey = streamingApiKeyForProvider(secrets, provider);
    if (!apiKey) {
      broadcastAll(session, {
        type: 'error',
        message: `Missing API key for ${provider}.`,
        ts: now(),
      });
      return;
    }
    const sourceLanguage = normalizeTranslationLanguageCode(secrets.sourceLanguage || 'en');
    try {
      const asr = await createStreamingAsrSession(provider, {
        apiKey,
        sourceLanguage,
        onEvent: (event) => handleSourceStreamingEvent(session, event, sourceLanguage),
      });
      if (!session.ingestActive || !sessionHasListeners(session)) {
        await asr.close().catch(() => undefined);
        return;
      }
      session.streamingAsr = asr;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start streaming ASR';
      broadcastAll(session, { type: 'error', message, ts: now() });
    }
  })();

  try {
    await session.streamingAsrStarting;
  } finally {
    session.streamingAsrStarting = null;
  }
}

/**
 * Opens/closes Soniox sessions so each active listen language has a stream.
 * Requires owner ingest — listeners alone do not open billable sockets.
 * @param session - Channel session.
 */
async function syncSonioxSessions(session: ChannelSession): Promise<void> {
  const secrets = await getRuntimeSecretsForUser(session.userId);
  if (!secrets || secrets.sttProvider !== 'soniox' || !secrets.sonioxApiKey) return;

  if (!session.ingestActive) {
    for (const [language, asr] of [...session.sonioxByLanguage.entries()]) {
      session.sonioxByLanguage.delete(language);
      void asr.close();
    }
    return;
  }

  const sourceLanguage = normalizeTranslationLanguageCode(secrets.sourceLanguage || 'en');
  const wanted = new Set<string>();
  for (const [language, bucket] of session.languages) {
    if (bucket.subscribers.size > 0) wanted.add(language);
  }

  for (const [language, asr] of [...session.sonioxByLanguage.entries()]) {
    if (!wanted.has(language)) {
      session.sonioxByLanguage.delete(language);
      void asr.close();
    }
  }

  for (const language of wanted) {
    if (session.sonioxByLanguage.has(language) || session.sonioxStarting.has(language)) continue;
    const starting = (async () => {
      try {
        const asr = await createStreamingAsrSession('soniox', {
          apiKey: secrets.sonioxApiKey!,
          sourceLanguage,
          targetLanguage: language === sourceLanguage ? undefined : language,
          onEvent: (event) => handleSonioxStreamingEvent(session, language, sourceLanguage, event),
        });
        if (![...session.languages.values()].some((b) => b.subscribers.size > 0)) {
          await asr.close();
          return;
        }
        if (!session.languages.get(language)?.subscribers.size) {
          await asr.close();
          return;
        }
        session.sonioxByLanguage.set(language, asr);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start Soniox ASR';
        broadcastLanguage(session, language, { type: 'error', message, ts: now() });
      } finally {
        session.sonioxStarting.delete(language);
      }
    })();
    session.sonioxStarting.set(language, starting);
    await starting;
  }
}

/**
 * Forwards PCM into the appropriate streaming ASR path.
 * @param session - Channel session.
 * @param pcm - PCM16 buffer.
 * @param sampleRate - Sample rate.
 */
async function writePcmToStreamingAsr(
  session: ChannelSession,
  pcm: Buffer,
  sampleRate: number
): Promise<void> {
  if (isNearSilentPcm16(pcm)) return;

  // No listeners → do not open or bill upstream ASR (owner mic/level meter still works).
  if (!sessionHasListeners(session)) {
    await closeSingleStreamingAsr(session);
    await syncSonioxSessions(session);
    return;
  }

  const secrets = await getRuntimeSecretsForUser(session.userId);
  if (!secrets?.translationReady || !secrets.sttProvider) {
    broadcastAll(session, {
      type: 'error',
      message: 'Translation is not configured for this channel.',
      ts: now(),
    });
    return;
  }

  if (secrets.sttProvider === 'soniox') {
    await syncSonioxSessions(session);
    for (const asr of session.sonioxByLanguage.values()) {
      asr.writePcm(pcm, sampleRate);
    }
    return;
  }

  if (isStreamingSttProvider(secrets.sttProvider)) {
    await ensureSingleStreamingAsr(session);
    session.streamingAsr?.writePcm(pcm, sampleRate);
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
  const soniox = session.sonioxByLanguage.get(language);
  if (soniox) {
    session.sonioxByLanguage.delete(language);
    void soniox.close();
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
        } else if (sttProvidesBuiltInTranslation(secrets.sttProvider)) {
          // Soniox should have already filled byLanguage; skip separate MT.
          broadcastLanguage(session, language, {
            type: 'error',
            message: 'Waiting for Soniox translation for this language.',
            ts: now(),
          });
          continue;
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
              recentSourceContext: buildRecentSourceContext(session.segments, segmentId),
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

      // Abort if listeners left while awaiting translate.
      if (bucket.subscribers.size === 0) {
        bucket.queue.length = 0;
        bucket.ttsQueue.length = 0;
        bucket.ttsJobs.clear();
        break;
      }

      // Captions first — do not wait on TTS (spoken audio follows on a second event).
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

      // Re-check after awaits — mute must stop new TTS immediately.
      const stillWantsAudio = [...bucket.subscribers].some((s) => s.wantAudio);
      if (stillWantsAudio && !existing.audioId) {
        enqueueTts(session, language, segment.id);
      }
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

/**
 * Starts GCP TTS for a segment immediately (parallel-safe). Delivery remains ordered
 * via `processTtsQueue`, which awaits jobs in queue order before broadcasting URLs.
 * @param session - Channel session.
 * @param language - Listen language.
 * @param segmentId - Segment to speak.
 */
function ensureTtsJob(session: ChannelSession, language: string, segmentId: string): void {
  const bucket = session.languages.get(language);
  if (!bucket || bucket.ttsJobs.has(segmentId)) return;

  const job = (async (): Promise<TtsJobResult | null> => {
    const segment = session.segments.find((s) => s.id === segmentId);
    if (!segment) return null;
    const translation = segment.byLanguage.get(language);
    if (!translation?.text?.trim()) return null;
    if (translation.audioId) {
      return {
        segmentId,
        text: translation.text,
        audioId: translation.audioId,
        createdAt: segment.createdAt,
      };
    }

    const textForTts = translation.text;
    const createdAt = segment.createdAt;
    try {
      const secrets = await getRuntimeSecretsForUser(session.userId);
      const voiceName = gcpTtsVoiceForLanguage(secrets?.gcpTtsVoices, language);
      if (!secrets?.gcpServiceAccountJson || !voiceName) return null;
      if (![...(session.languages.get(language)?.subscribers ?? [])].some((s) => s.wantAudio)) {
        return null;
      }
      const mp3 = await synthesizeSpeechWithGcp({
        serviceAccountJson: secrets.gcpServiceAccountJson,
        voiceName,
        languageCode: languageCodeHintFromVoiceName(voiceName) || language,
        text: textForTts,
      });
      if (mp3.length === 0) return null;
      if (![...(session.languages.get(language)?.subscribers ?? [])].some((s) => s.wantAudio)) {
        return null;
      }
      if (translation.audioId) {
        return {
          segmentId,
          text: textForTts,
          audioId: translation.audioId,
          createdAt,
        };
      }
      const audioId = randomUUID();
      session.audioBytes.set(audioId, {
        mime: 'audio/mpeg',
        data: mp3,
        expiresAt: now() + 10 * 60_000,
      });
      translation.audioId = audioId;
      pruneAudio(session);
      return { segmentId, text: textForTts, audioId, createdAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'TTS failed';
      broadcastLanguage(session, language, {
        type: 'error',
        message,
        ts: now(),
      });
      return null;
    }
  })();

  bucket.ttsJobs.set(segmentId, job);
}

/**
 * Delivers spoken audio URLs in caption order.
 * Synthesis starts as soon as each segment is queued (see `ensureTtsJob`) so later
 * lines prepare while earlier clips play — reducing gaps without skipping lines.
 * @param session - Channel session.
 * @param language - Listen language.
 */
async function processTtsQueue(session: ChannelSession, language: string): Promise<void> {
  const bucket = session.languages.get(language);
  if (!bucket || bucket.ttsBusy) return;
  bucket.ttsBusy = true;
  try {
    while (bucket.ttsQueue.length > 0) {
      if (![...bucket.subscribers].some((s) => s.wantAudio)) {
        bucket.ttsQueue.length = 0;
        bucket.ttsJobs.clear();
        break;
      }
      const segmentId = bucket.ttsQueue.shift();
      if (!segmentId) break;

      ensureTtsJob(session, language, segmentId);
      const job = bucket.ttsJobs.get(segmentId);
      const result = job ? await job : null;
      bucket.ttsJobs.delete(segmentId);

      if (!result) continue;
      if (bucket.subscribers.size === 0) break;
      if (![...bucket.subscribers].some((s) => s.wantAudio)) {
        bucket.ttsQueue.length = 0;
        bucket.ttsJobs.clear();
        break;
      }
      broadcastLanguage(session, language, {
        type: 'caption',
        segmentId: result.segmentId,
        language,
        text: result.text,
        audioUrl: `/api/translation/public/audio/${result.audioId}`,
        ts: result.createdAt,
      });
    }
  } finally {
    bucket.ttsBusy = false;
    if (bucket.ttsQueue.length > 0 && [...bucket.subscribers].some((s) => s.wantAudio)) {
      void processTtsQueue(session, language);
    }
  }
}

/**
 * Enqueues a segment for ordered spoken delivery and starts synthesis immediately.
 * @param session - Channel session.
 * @param language - Listen language.
 * @param segmentId - Segment id.
 */
function enqueueTts(session: ChannelSession, language: string, segmentId: string): void {
  const bucket = session.languages.get(language);
  if (!bucket) return;
  if (![...bucket.subscribers].some((s) => s.wantAudio)) return;
  bucket.ttsQueue.push(segmentId);
  ensureTtsJob(session, language, segmentId);
  void processTtsQueue(session, language);
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
  if (!session.ingestActive || !sessionHasListeners(session)) {
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
      if (!session.ingestActive || !sessionHasListeners(session)) {
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
      if (!secrets?.translationReady || secrets.sttProvider !== 'groq' || !secrets.sttModel) {
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
    void closeAllStreamingAsr(session);
    broadcastAll(session, { type: 'status', live: false, ts: now() });
    maybeTeardown(session);
  }, INGEST_IDLE_MS);
  broadcastAll(session, { type: 'status', live: true, ts: now() });
}

/**
 * Queues PCM audio from the owner for shared STT.
 * Marks the channel live for listeners, but upstream STT only runs while at least
 * one public listener is subscribed (and stops when the last listener leaves).
 * Streaming providers receive frames immediately; Groq uses the chunked queue.
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

  void (async () => {
    const secrets = await getRuntimeSecretsForUser(userId);
    if (!secrets?.sttProvider) {
      broadcastAll(session, {
        type: 'error',
        message: 'Translation is not configured for this channel.',
        ts: now(),
      });
      return;
    }
    if (isStreamingSttProvider(secrets.sttProvider)) {
      await writePcmToStreamingAsr(session, pcm, sampleRate);
      return;
    }
    // Groq chunked fallback — skip provider calls with nobody listening.
    if (!sessionHasListeners(session)) {
      session.audioQueue.length = 0;
      return;
    }
    session.audioQueue.push({ pcm, sampleRate });
    coalesceAudioQueueToLatest(session);
    void processAudioQueue(session);
  })();
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
 * First subscriber (with owner ingest active) opens billable STT; first subscriber
 * for a non-source language also starts translate(+TTS) work.
 * Source language is transcription-only. Last leave closes upstream STT immediately
 * and clears that language’s caption cache after a short grace.
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
        ttsQueue: [],
        ttsBusy: false,
        ttsJobs: new Map(),
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
  // Open billable ASR only when ingest is already live and someone is listening.
  void syncSonioxSessions(session);
  void ensureSingleStreamingAsr(session);

  return () => {
    const bucket = session.languages.get(language);
    if (!bucket) {
      maybeTeardown(session);
      return;
    }
    bucket.subscribers.delete(subscriber);
    if (bucket.subscribers.size === 0) {
      // Stop pending translate/TTS work immediately; purge cached captions after reconnect grace.
      bucket.queue.length = 0;
      bucket.ttsQueue.length = 0;
      bucket.ttsJobs.clear();
      scheduleLanguageIdle(session, language);
    }
    if (!sessionHasListeners(session)) {
      // Stop STT billing as soon as the last listener leaves (owner may still be live).
      session.audioQueue.length = 0;
      void closeSingleStreamingAsr(session);
    }
    void syncSonioxSessions(session);
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
  void closeAllStreamingAsr(session);
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
  void closeAllStreamingAsr(session);
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
    void closeAllStreamingAsr(session);
  }
  sessions.clear();
}
