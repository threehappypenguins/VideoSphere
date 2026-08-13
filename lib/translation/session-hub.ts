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
import { normalizeTranslationLanguageCode } from '@/lib/translation/languages';
import { createStreamingAsrSession } from '@/lib/translation/streaming-asr';
import { isModulateSoftReconnectError } from '@/lib/translation/streaming-asr/modulate';
import type { StreamingAsrEvent, StreamingAsrSession } from '@/lib/translation/streaming-asr/types';
import {
  GroqTranslateRateLimitError,
  OpenRouterTranslateRateLimitError,
  translateLiveCaptionText,
} from '@/lib/translation/translate-text';
import { buildRecentSourceContext } from '@/lib/translation/mt-prompt';
import { repairSermonTranslation } from '@/lib/translation/sermon-source-clarify';
import { synthesizeSpeechWithGcp } from '@/lib/translation/gcp-tts';
import { resolveTtsSpeakingRate } from '@/lib/translation/tts-speaking-rate';
import {
  gcpTtsVoiceForLanguage,
  languageCodeHintFromVoiceName,
} from '@/lib/translation/gcp-tts-voices';
import { isNearSilentPcm16, sanitizeSttTranscript } from '@/lib/translation/stt-quality';
import { mp3DurationMs } from '@/lib/translation/mp3-duration';
import {
  createTtsTimingTracker,
  formatTtsSegmentTiming,
  formatTtsTimingSummary,
  isTtsTimingLogEnabled,
  type TtsTimingTracker,
} from '@/lib/translation/tts-timing';
import {
  audioActivityDetectorOptionsFromEnv,
  createAudioActivityDetector,
  isMusicDetectionEnabled,
  type AudioActivityDetector,
} from '@/lib/translation/audio-activity';
import { TRANSLATION_SESSIONS_GLOBAL_KEY } from '@/lib/translation/is-channel-live';

export { isChannelLive } from '@/lib/translation/is-channel-live';

const MAX_SEGMENTS = 40;
/** Brief grace for EventSource reconnects; then language work + cached captions are dropped. */
const LANGUAGE_IDLE_MS = 3_000;
const INGEST_IDLE_MS = 45_000;
/** Keep ASR open across brief listener gaps (EventSource reconnect / speaker toggle). */
const ASR_LISTENER_GRACE_MS = 1_500;
/** Base backoff after OpenRouter translate 429 (free shared pools). */
const TRANSLATE_RATE_LIMIT_BACKOFF_MS = 20_000;
/** Cap for exponential translate 429 backoff. */
const TRANSLATE_RATE_LIMIT_BACKOFF_MAX_MS = 60_000;
/**
 * Audio retained while music suppresses STT, replayed when speech resumes.
 *
 * Detecting the return to speech takes a few seconds of hysteresis, so without a
 * pre-roll the preacher's first words after a hymn would never reach the provider.
 * Sized to cover that hysteresis plus the analysis window that precedes it.
 */
const ACTIVITY_PRE_ROLL_MS = 6_000;
/**
 * Continuous music after which the upstream ASR socket is closed.
 *
 * Congregational singing runs for minutes, and providers bill for streamed audio —
 * closing is a real saving, and the pre-roll buffer covers the reconnect gap.
 */
const MUSIC_ASR_CLOSE_MS = 10_000;

/** Caption/audio event pushed to public SSE subscribers. */
export interface TranslationHubEvent {
  type: 'caption' | 'status' | 'error' | 'heartbeat' | 'source_pcm' | 'activity';
  segmentId?: string;
  language?: string;
  text?: string;
  audioUrl?: string;
  /** Base64-encoded 16-bit LE mono PCM for source-language live listen. */
  pcmBase64?: string;
  /** Sample rate Hz for `source_pcm` payloads. */
  sampleRate?: number;
  live?: boolean;
  message?: string;
  /**
   * Whether the owner audio currently holds speech or music. Sent on transitions
   * and with the initial `status` event so listeners joining mid-song see the marker.
   */
  activity?: BroadcastActivity;
  ts: number;
}

/** Activity states surfaced to listeners (`silence` stays internal). */
type BroadcastActivity = 'speech' | 'music';

type Subscriber = {
  /** Client-stable listen id (EventSource query) when provided; otherwise server-generated. */
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
  /** Spoken-lag measurements, only populated while `TRANSLATION_TTS_TIMING_LOG` is on. */
  ttsTiming: TtsTimingTracker | null;
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
  /** Clip playback duration, measured only when timing instrumentation is enabled. */
  audioMs: number | null;
};

type ChannelSession = {
  channelId: string;
  userId: string;
  ingestActive: boolean;
  lastIngestAt: number;
  ingestIdleTimer: ReturnType<typeof setTimeout> | null;
  /** Cached channel source language for PCM passthrough fan-out. */
  cachedSourceLanguage: string | null;
  segments: Segment[];
  languages: Map<string, LanguageBucket>;
  audioBytes: Map<string, { mime: string; data: Buffer; expiresAt: number }>;
  /** Non-Soniox streaming ASR (single upstream). */
  streamingAsr: StreamingAsrSession | null;
  /**
   * Monotonic id for the current non-Soniox ASR socket.
   * Stale error/close callbacks from a replaced socket must not clear a newer one.
   */
  streamingAsrGeneration: number;
  /** In-flight open for non-Soniox streaming ASR. */
  streamingAsrStarting: Promise<void> | null;
  /** Debounced close after the last public listener disconnects. */
  asrCloseTimer: ReturnType<typeof setTimeout> | null;
  /** Soniox: one session per active listen language. */
  sonioxByLanguage: Map<string, StreamingAsrSession>;
  /** In-flight Soniox open per language. */
  sonioxStarting: Map<string, Promise<void>>;
  /**
   * Soniox soft-split partial segment ids keyed by listen language.
   * Each Soniox socket is per-language; sharing one id made translation finals
   * overwrite the previous caption row on the client.
   */
  sonioxPartialSegmentIds: Map<string, string>;
  /** Partial caption segment id for the active utterance (non-Soniox streaming). */
  streamingPartialSegmentId: string | null;
  /** Speech/music detector over owner ingest; null when detection is disabled. */
  activityDetector: AudioActivityDetector | null;
  /** Last activity state broadcast to listeners. */
  activity: BroadcastActivity;
  /** Timestamp the current music stretch began, or 0 while captioning speech. */
  musicSince: number;
  /** True when the ASR socket was closed to avoid billing during music. */
  asrPausedForMusic: boolean;
  /** Recent PCM held back during music, replayed when speech resumes. */
  activityPreRoll: Array<{ pcm: Buffer; sampleRate: number }>;
  /** Total bytes currently held in `activityPreRoll`. */
  activityPreRollBytes: number;
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
      cachedSourceLanguage: null,
      segments: [],
      languages: new Map(),
      audioBytes: new Map(),
      streamingAsr: null,
      streamingAsrGeneration: 0,
      streamingAsrStarting: null,
      asrCloseTimer: null,
      sonioxByLanguage: new Map(),
      sonioxStarting: new Map(),
      sonioxPartialSegmentIds: new Map(),
      streamingPartialSegmentId: null,
      activityDetector: isMusicDetectionEnabled()
        ? createAudioActivityDetector(audioActivityDetectorOptionsFromEnv())
        : null,
      activity: 'speech',
      musicSince: 0,
      asrPausedForMusic: false,
      activityPreRoll: [],
      activityPreRollBytes: 0,
    };
    sessions.set(channelId, session);
  }
  return session;
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
  if (!session.ingestActive && !hasSubs) {
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
function cancelScheduledStreamingAsrClose(session: ChannelSession): void {
  if (!session.asrCloseTimer) return;
  clearTimeout(session.asrCloseTimer);
  session.asrCloseTimer = null;
}

/**
 * Closes upstream ASR shortly after the last listener leaves.
 * A short grace covers EventSource reconnects (e.g. speaker toggle) so we do not
 * tear down Modulate/Deepgram mid-utterance and bounce on Invalid input audio.
 * @param session - Channel session.
 */
function scheduleStreamingAsrClose(session: ChannelSession): void {
  if (session.asrCloseTimer) return;
  session.asrCloseTimer = setTimeout(() => {
    session.asrCloseTimer = null;
    if (sessionHasListeners(session)) return;
    void closeSingleStreamingAsr(session);
    void syncSonioxSessions(session);
  }, ASR_LISTENER_GRACE_MS);
}

async function closeSingleStreamingAsr(session: ChannelSession): Promise<void> {
  cancelScheduledStreamingAsrClose(session);
  const single = session.streamingAsr;
  session.streamingAsr = null;
  session.streamingAsrGeneration += 1;
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
  cancelScheduledStreamingAsrClose(session);
  const single = session.streamingAsr;
  session.streamingAsr = null;
  session.streamingAsrGeneration += 1;
  session.streamingAsrStarting = null;
  session.streamingPartialSegmentId = null;
  const soniox = [...session.sonioxByLanguage.entries()];
  session.sonioxByLanguage.clear();
  session.sonioxStarting.clear();
  session.sonioxPartialSegmentIds.clear();
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
  if (provider === 'modulate') return secrets.modulateApiKey;
  if (provider === 'elevenlabs') return secrets.elevenLabsApiKey;
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
  sourceLanguage: string,
  generation: number
): void {
  // Late frames from a socket we already replaced/closed must not toast listeners
  // or tear down the healthy replacement.
  if (generation !== session.streamingAsrGeneration) return;

  if (event.kind === 'error') {
    // Modulate occasionally rejects the first frame(s) with "Invalid input audio"
    // and closes; the next PCM open recovers. Do not sticky-toast that bounce.
    if (!isModulateSoftReconnectError(event.message)) {
      broadcastAll(session, {
        type: 'error',
        message: event.message.slice(0, 280),
        ts: now(),
      });
    }
    const dead = session.streamingAsr;
    session.streamingAsr = null;
    session.streamingAsrGeneration += 1;
    session.streamingAsrStarting = null;
    session.streamingPartialSegmentId = null;
    if (dead) void dead.close().catch(() => undefined);
    return;
  }

  if (event.kind === 'audio_event') {
    session.activityDetector?.noteProviderMusicEvent(event.active, event.confidence ?? 0.5);
    return;
  }

  // A final can still arrive from the provider just after music was committed;
  // showing it would put a lyric fragment on screen below the music marker.
  if (session.activity === 'music') return;

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
    // Omit segmentId so listeners show this as revisable interim text. Sending an
    // id made every ASR hypothesis rewrite a committed caption line (words appear,
    // then vanish when the provider revises).
    broadcastLanguage(session, sourceLanguage, {
      type: 'caption',
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

  // Soniox does not classify non-speech audio; guard so the union stays exhaustive.
  if (event.kind === 'audio_event') return;
  if (session.activity === 'music') return;

  const isSourceStream = listenLanguage === sourceLanguage;
  if (isSourceStream && event.isTranslation) return;
  if (!isSourceStream && !event.isTranslation) return;

  const rawText = sanitizeSttTranscript(event.text);
  if (!rawText) return;
  const language = listenLanguage;
  // Soniox skips our MT stack; still run Mandarin/Cantonese confession repairs.
  const partialId = session.sonioxPartialSegmentIds.get(language) ?? null;
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
    let segmentId = session.sonioxPartialSegmentIds.get(language);
    if (!segmentId) {
      segmentId = randomUUID();
      session.sonioxPartialSegmentIds.set(language, segmentId);
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
    // Same as source ASR: interim hypotheses must not rewrite committed caption rows.
    broadcastLanguage(session, language, {
      type: 'caption',
      language,
      text,
      ts: now(),
    });
    return;
  }

  // Final — always clear this language's partial id so the next soft-split / utterance
  // gets a new segmentId. Reusing the id made the listen client overwrite the prior row.
  let segmentId = session.sonioxPartialSegmentIds.get(language);
  session.sonioxPartialSegmentIds.delete(language);
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
  // Source language uses live PCM passthrough — never GCP TTS.
  if (!isSourceStream) {
    const bucket = session.languages.get(language);
    if (bucket && [...bucket.subscribers].some((s) => s.wantAudio)) {
      enqueueTts(session, language, segmentId);
    }
  }
}

/**
 * Ensures a non-Soniox streaming ASR session is open.
 * Opens only while owner ingest is active and at least one listener is subscribed.
 * @param session - Channel session.
 */
/**
 * True when captioning is paused for singing/music (no upstream ASR).
 * @param session - Channel session.
 * @returns Whether activity is music.
 */
function isMusicActivity(session: ChannelSession): boolean {
  return session.activity === 'music';
}

/**
 * Ensures a non-Soniox streaming ASR session is open.
 * Opens only while owner ingest is active and at least one listener is subscribed.
 * @param session - Channel session.
 */
async function ensureSingleStreamingAsr(session: ChannelSession): Promise<void> {
  cancelScheduledStreamingAsrClose(session);
  if (!session.ingestActive || !sessionHasListeners(session)) {
    await closeSingleStreamingAsr(session);
    return;
  }

  // Wait out any in-flight open; retry if it abandoned without assigning a socket.
  for (;;) {
    // Mid-hymn: do not open (or keep waiting on) a billable socket with nothing to send.
    if (isMusicActivity(session)) return;
    if (session.streamingAsr) return;
    if (!session.streamingAsrStarting) break;
    await session.streamingAsrStarting;
  }
  if (!session.ingestActive || !sessionHasListeners(session)) return;
  if (isMusicActivity(session)) return;
  if (session.streamingAsr) return;

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
    const generation = session.streamingAsrGeneration + 1;
    try {
      const asr = await createStreamingAsrSession(provider, {
        apiKey,
        sourceLanguage,
        onEvent: (event) => handleSourceStreamingEvent(session, event, sourceLanguage, generation),
      });
      if (!session.ingestActive || !sessionHasListeners(session)) {
        await asr.close().catch(() => undefined);
        return;
      }
      session.streamingAsrGeneration = generation;
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
      session.sonioxPartialSegmentIds.delete(language);
      void asr.close();
    }
    return;
  }

  const sourceLanguage = normalizeTranslationLanguageCode(secrets.sourceLanguage || 'en');
  const wanted = new Set<string>();
  // Nothing is sent upstream during music, so do not open sockets for it either.
  if (session.activity !== 'music') {
    for (const [language, bucket] of session.languages) {
      if (bucket.subscribers.size > 0) wanted.add(language);
    }
  }

  for (const [language, asr] of [...session.sonioxByLanguage.entries()]) {
    if (!wanted.has(language)) {
      session.sonioxByLanguage.delete(language);
      session.sonioxPartialSegmentIds.delete(language);
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
    session.sonioxPartialSegmentIds.delete(language);
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
      // Source language never uses GCP TTS (live PCM passthrough instead).
      const sourceLanguage =
        session.cachedSourceLanguage ||
        normalizeTranslationLanguageCode(
          (await getRuntimeSecretsForUser(session.userId))?.sourceLanguage || 'en'
        ) ||
        'en';
      session.cachedSourceLanguage = sourceLanguage;
      const stillWantsAudio = [...bucket.subscribers].some((s) => s.wantAudio);
      if (stillWantsAudio && !existing.audioId && language !== sourceLanguage) {
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

  /**
   * Parses a clip duration when timing logs are on.
   * Checked at synthesize time (not only when the language bucket was created) so
   * flipping `TRANSLATION_TTS_TIMING_LOG` after a restart still works for live sessions.
   * @param bytes - MP3 bytes, when available.
   * @returns Duration in milliseconds, or null when not measuring.
   */
  const measureClipMs = (bytes: Uint8Array | undefined): number | null =>
    isTtsTimingLogEnabled() && bytes ? mp3DurationMs(bytes) : null;

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
        audioMs: measureClipMs(session.audioBytes.get(translation.audioId)?.data),
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
        speakingRate: resolveTtsSpeakingRate(language),
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
          audioMs: measureClipMs(session.audioBytes.get(translation.audioId)?.data),
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
      return { segmentId, text: textForTts, audioId, createdAt, audioMs: measureClipMs(mp3) };
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

/** Spoken clips between aggregate timing summaries. */
const TTS_TIMING_SUMMARY_EVERY = 20;

/**
 * Records one delivered clip against the language's lag tracker and logs it.
 *
 * A no-op while `TRANSLATION_TTS_TIMING_LOG` is off, and also when a clip's duration could
 * not be measured because its bytes had already been pruned.
 * @param bucket - Language bucket holding the tracker.
 * @param language - Listen language code.
 * @param result - Delivered TTS job result.
 * @param broadcastAt - Timestamp the audio URL was sent to listeners.
 */
function recordTtsTiming(
  bucket: LanguageBucket,
  language: string,
  result: TtsJobResult,
  broadcastAt: number
): void {
  if (!isTtsTimingLogEnabled() || result.audioMs === null) return;
  if (!bucket.ttsTiming) {
    bucket.ttsTiming = createTtsTimingTracker();
    console.log(`[tts-timing ${language}] measuring spoken lag (TRANSLATION_TTS_TIMING_LOG=on)`);
  }

  const timing = bucket.ttsTiming.record({
    createdAt: result.createdAt,
    broadcastAt,
    audioMs: result.audioMs,
  });
  console.log(formatTtsSegmentTiming(language, timing));

  if (timing.index % TTS_TIMING_SUMMARY_EVERY === 0) {
    const summary = bucket.ttsTiming.summary();
    if (summary) console.log(formatTtsTimingSummary(language, summary));
  }
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
      const broadcastAt = now();
      broadcastLanguage(session, language, {
        type: 'caption',
        segmentId: result.segmentId,
        language,
        text: result.text,
        audioUrl: `/api/translation/public/audio/${result.audioId}`,
        ts: result.createdAt,
      });
      recordTtsTiming(bucket, language, result, broadcastAt);
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
  if (session.cachedSourceLanguage && language === session.cachedSourceLanguage) return;
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
    // Source captions were already broadcast from STT; spoken source is PCM passthrough.
    if (language === sourceLanguage) continue;
    bucket.queue.push(segmentId);
    if (bucket.rateLimitedUntil > now()) {
      coalesceLanguageQueueToLatest(bucket);
    }
    void processLanguageQueue(session, language);
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
    resetSessionActivity(session);
    broadcastAll(session, { type: 'status', live: false, ts: now() });
    maybeTeardown(session);
  }, INGEST_IDLE_MS);
  broadcastAll(session, { type: 'status', live: true, ts: now() });
}

/**
 * Fans live owner PCM to source-language listeners who enabled spoken audio.
 * @param session - Channel session.
 * @param pcm - 16-bit LE mono PCM.
 * @param sampleRate - Sample rate Hz.
 */
function fanOutSourcePcm(session: ChannelSession, pcm: Buffer, sampleRate: number): void {
  const sourceLanguage = session.cachedSourceLanguage;
  if (!sourceLanguage) return;
  const bucket = session.languages.get(sourceLanguage);
  if (!bucket) return;
  const pcmBase64 = pcm.toString('base64');
  const ts = now();
  for (const sub of bucket.subscribers) {
    if (!sub.wantAudio) continue;
    try {
      sub.send({ type: 'source_pcm', pcmBase64, sampleRate, language: sourceLanguage, ts });
    } catch {
      bucket.subscribers.delete(sub);
    }
  }
}

/**
 * Whether the newest analysis window has stopped arguing for music.
 *
 * Decides which audio is worth holding as pre-roll. Committing to speech takes several
 * seconds of hysteresis, and blindly retaining that whole tail would replay the end of
 * a hymn into the provider and caption the last line of the song. Only audio that
 * already scores below the music bar is kept.
 * @param session - Channel session.
 * @returns True when the latest window no longer scores as music.
 */
function isPreRollWorthKeeping(session: ChannelSession): boolean {
  const detector = session.activityDetector;
  if (!detector) return true;
  const scores = detector.lastScores();
  if (!scores) return true;
  return scores.silent || scores.music < detector.options.musicThreshold;
}

/**
 * Retains a PCM chunk as pre-roll, discarding the oldest beyond the retention window.
 * @param session - Channel session.
 * @param pcm - 16-bit LE mono PCM.
 * @param sampleRate - Sample rate Hz.
 */
function pushActivityPreRoll(session: ChannelSession, pcm: Buffer, sampleRate: number): void {
  const maxBytes = Math.round((ACTIVITY_PRE_ROLL_MS / 1000) * sampleRate * 2);
  session.activityPreRoll.push({ pcm, sampleRate });
  session.activityPreRollBytes += pcm.length;
  while (session.activityPreRollBytes > maxBytes && session.activityPreRoll.length > 1) {
    const dropped = session.activityPreRoll.shift();
    if (!dropped) break;
    session.activityPreRollBytes -= dropped.pcm.length;
  }
}

/**
 * Removes and returns the retained pre-roll chunks in chronological order.
 * @param session - Channel session.
 * @returns Buffered chunks, oldest first.
 */
function drainActivityPreRoll(session: ChannelSession): Array<{ pcm: Buffer; sampleRate: number }> {
  const chunks = session.activityPreRoll;
  session.activityPreRoll = [];
  session.activityPreRollBytes = 0;
  return chunks;
}

/**
 * Advances the speech/music detector and publishes state transitions.
 * @param session - Channel session.
 * @param pcm - 16-bit LE mono PCM.
 * @param sampleRate - Sample rate Hz.
 * @returns Current activity; always `speech` when detection is disabled.
 */
function updateSessionActivity(
  session: ChannelSession,
  pcm: Buffer,
  sampleRate: number
): BroadcastActivity {
  const detector = session.activityDetector;
  if (!detector) return 'speech';

  const { state } = detector.push(pcm, sampleRate);
  // `silence` is neutral: hold whatever was already being shown.
  if (state === 'silence') return session.activity;
  if (state === session.activity) return session.activity;

  session.activity = state;
  if (state === 'music') {
    session.musicSince = now();
    // Drop the unfinished caption so the last words before the song do not sit
    // on screen as a permanent partial once STT stops producing finals.
    session.streamingPartialSegmentId = null;
    session.sonioxPartialSegmentIds.clear();
  } else {
    session.musicSince = 0;
  }
  broadcastAll(session, { type: 'activity', activity: state, ts: now() });
  return state;
}

/**
 * Returns the detector and activity state to their initial "speech" baseline.
 *
 * Called when ingest stops so a service that ended mid-song does not leave the
 * music marker on listeners' screens, and the next service starts clean.
 * @param session - Channel session.
 */
function resetSessionActivity(session: ChannelSession): void {
  session.activityDetector?.reset();
  session.musicSince = 0;
  session.asrPausedForMusic = false;
  session.activityPreRoll = [];
  session.activityPreRollBytes = 0;
  if (session.activity !== 'speech') {
    session.activity = 'speech';
    broadcastAll(session, { type: 'activity', activity: 'speech', ts: now() });
  }
}

/**
 * Closes upstream ASR sockets once music has run long enough to be worth the reconnect.
 * @param session - Channel session.
 */
function suppressSttForMusic(session: ChannelSession): void {
  if (session.asrPausedForMusic) return;
  if (session.musicSince === 0 || now() - session.musicSince < MUSIC_ASR_CLOSE_MS) return;
  session.asrPausedForMusic = true;
  void closeSingleStreamingAsr(session);
  for (const [language, asr] of session.sonioxByLanguage) {
    session.sonioxByLanguage.delete(language);
    session.sonioxPartialSegmentIds.delete(language);
    void asr.close().catch(() => undefined);
  }
}

/**
 * Forwards PCM audio from the owner to streaming STT.
 * Marks the channel live for listeners, but upstream STT only runs while at least
 * one public listener is subscribed (and stops when the last listener leaves).
 * Source-language listeners with spoken audio also receive PCM via `source_pcm` SSE.
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
  // Fan immediately when source language is already known. If subscribe warmed the
  // cache between this sync check and the async secrets load, still catch up below.
  const fannedSync = Boolean(session.cachedSourceLanguage);
  if (fannedSync) {
    fanOutSourcePcm(session, pcm, sampleRate);
  }

  void (async () => {
    const secrets = await getRuntimeSecretsForUser(userId);
    if (!secrets?.sttProvider || !isStreamingSttProvider(secrets.sttProvider)) {
      broadcastAll(session, {
        type: 'error',
        message:
          'Translation is not configured for this channel. Choose a streaming STT provider in Configure AI.',
        ts: now(),
      });
      return;
    }
    session.cachedSourceLanguage =
      normalizeTranslationLanguageCode(secrets.sourceLanguage || 'en') || 'en';
    if (!fannedSync) {
      fanOutSourcePcm(session, pcm, sampleRate);
    }

    // Singing/music must not produce captions. Listeners keep hearing the source
    // audio via `source_pcm`; only text, translate, and TTS work is suppressed.
    if (updateSessionActivity(session, pcm, sampleRate) === 'music') {
      if (isPreRollWorthKeeping(session)) pushActivityPreRoll(session, pcm, sampleRate);
      suppressSttForMusic(session);
      return;
    }

    session.asrPausedForMusic = false;
    for (const frame of drainActivityPreRoll(session)) {
      await writePcmToStreamingAsr(session, frame.pcm, frame.sampleRate);
    }
    await writePcmToStreamingAsr(session, pcm, sampleRate);
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
 * Source language is transcription + optional live PCM passthrough (never GCP TTS).
 * Last leave closes upstream STT immediately and clears that language’s caption cache
 * after a short grace.
 * @param params - Channel, user, language, audio preference, and send callback.
 * @returns Unsubscribe function.
 */
export function subscribePublicListener(params: {
  channelId: string;
  userId: string;
  language: string;
  wantAudio: boolean;
  /** Optional client-stable id so wantAudio can be updated without reconnecting SSE. */
  listenerId?: string;
  send: (event: TranslationHubEvent) => void;
}): () => void {
  const { channelId, userId, wantAudio, send } = params;
  const language = normalizeTranslationLanguageCode(params.language);
  const session = getOrCreateSession(channelId, userId);
  cancelScheduledStreamingAsrClose(session);
  const listenerId =
    typeof params.listenerId === 'string' && params.listenerId.trim()
      ? params.listenerId.trim().slice(0, 128)
      : randomUUID();
  const subscriber: Subscriber = {
    id: listenerId,
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
        ttsTiming: isTtsTimingLogEnabled() ? createTtsTimingTracker() : null,
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

  // Include activity so a listener joining mid-song sees the music marker immediately
  // instead of an empty caption list that looks broken.
  send({ type: 'status', live: session.ingestActive, activity: session.activity, ts: now() });
  // No historical caption replay — only live segments from this point forward.
  // If this listener wants speech on a *target* language, finish TTS for the latest
  // already-translated segment (e.g. they tapped Listen after captions-only).
  void (async () => {
    const secrets = await getRuntimeSecretsForUser(userId);
    const sourceLanguage =
      normalizeTranslationLanguageCode(secrets?.sourceLanguage || 'en') || 'en';
    session.cachedSourceLanguage = sourceLanguage;
    if (wantAudio && language !== sourceLanguage) {
      for (let i = session.segments.length - 1; i >= 0; i -= 1) {
        const segment = session.segments[i];
        if (!segment) continue;
        const existing = segment.byLanguage.get(language);
        if (existing && !existing.audioId) {
          bucketReady.queue.push(segment.id);
          break;
        }
      }
      void processLanguageQueue(session, language);
    }
  })();
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
      // Print totals while the tracker still exists — the bucket may be purged after grace.
      const summary = bucket.ttsTiming?.summary();
      if (summary) console.log(formatTtsTimingSummary(language, summary));
      scheduleLanguageIdle(session, language);
    }
    if (!sessionHasListeners(session)) {
      // Stop STT billing shortly after the last listener leaves (owner may still be live).
      // Grace covers brief EventSource gaps from speaker toggle / mobile network blips.
      scheduleStreamingAsrClose(session);
    }
    void syncSonioxSessions(session);
    maybeTeardown(session);
  };
}

/**
 * Updates spoken-audio preference for an existing public listener without reconnecting SSE.
 * @param params - Channel, listener id, and new wantAudio flag.
 * @returns True when a matching subscriber was updated.
 */
export function setPublicListenerWantAudio(params: {
  channelId: string;
  listenerId: string;
  wantAudio: boolean;
}): boolean {
  const session = sessions.get(params.channelId);
  if (!session) return false;
  const listenerId = params.listenerId.trim();
  if (!listenerId) return false;
  for (const bucket of session.languages.values()) {
    for (const sub of bucket.subscribers) {
      if (sub.id !== listenerId) continue;
      const enabling = params.wantAudio && !sub.wantAudio;
      sub.wantAudio = params.wantAudio;
      if (enabling) {
        void (async () => {
          const secrets = await getRuntimeSecretsForUser(session.userId);
          const sourceLanguage =
            normalizeTranslationLanguageCode(secrets?.sourceLanguage || 'en') || 'en';
          if (sub.language === sourceLanguage) return;
          for (let i = session.segments.length - 1; i >= 0; i -= 1) {
            const segment = session.segments[i];
            if (!segment) continue;
            const existing = segment.byLanguage.get(sub.language);
            if (existing && !existing.audioId) {
              bucket.queue.push(segment.id);
              break;
            }
          }
          void processLanguageQueue(session, sub.language);
        })();
      }
      return true;
    }
  }
  return false;
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
 * Closes upstream ASR so STT does not keep billing after stop.
 * @param channelId - Channel document id.
 */
export function markIngestStopped(channelId: string): void {
  const session = sessions.get(channelId);
  if (!session) return;
  session.ingestActive = false;
  resetSessionActivity(session);
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
    for (const bucket of session.languages.values()) {
      if (bucket.idleTimer) clearTimeout(bucket.idleTimer);
      if (bucket.rateLimitTimer) clearTimeout(bucket.rateLimitTimer);
    }
    void closeAllStreamingAsr(session);
  }
  sessions.clear();
}
