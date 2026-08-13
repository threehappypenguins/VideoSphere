// =============================================================================
// ElevenLabs Scribe v2 Realtime WebSocket adapter
// https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime
// =============================================================================

import WebSocket from 'ws';
import {
  shortLanguageCode,
  type StreamingAsrCreateOptions,
  type StreamingAsrEvent,
  type StreamingAsrSession,
} from '@/lib/translation/streaming-asr/types';
import { applyCumulativeUtteranceTranscript } from '@/lib/translation/streaming-asr/utterance-split';
import { sendWsText } from '@/lib/translation/streaming-asr/ws-send';

const ELEVENLABS_STT_WS_BASE = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

/** Default realtime model (full quality). */
export const ELEVENLABS_REALTIME_MODEL_ID = 'scribe_v2_realtime';

/**
 * Soft-splits ElevenLabs cumulative segment text into caption-sized hub events.
 * @param input - Latest frame kind/text plus text already emitted as finals.
 * @returns Updated finalized prefix and zero or more hub events (in order).
 */
export function applyElevenLabsTranscript(input: {
  kind: 'partial' | 'final';
  text: string;
  finalizedPrefix: string;
  sourceLanguage: string;
}): { finalizedPrefix: string; events: StreamingAsrEvent[] } {
  return applyCumulativeUtteranceTranscript(input);
}

/**
 * Maps an ElevenLabs realtime server message to a soft-split kind + text.
 * Prefer `applyElevenLabsServerMessage` in the live session.
 * @param msg - Parsed WebSocket JSON.
 * @returns Soft-split input fields, an error message, or null when ignored.
 */
export function elevenLabsEventFromServerMessage(
  msg: unknown
): { kind: 'partial' | 'final'; text: string } | { kind: 'error'; message: string } | null {
  if (!msg || typeof msg !== 'object') return null;
  const record = msg as {
    message_type?: unknown;
    messageType?: unknown;
    type?: unknown;
    text?: unknown;
    error?: unknown;
    message?: unknown;
  };

  const messageType =
    (typeof record.message_type === 'string' && record.message_type) ||
    (typeof record.messageType === 'string' && record.messageType) ||
    (typeof record.type === 'string' && record.type) ||
    '';

  if (
    messageType === 'auth_error' ||
    messageType === 'scribe_auth_error' ||
    messageType === 'quota_exceeded' ||
    messageType === 'scribe_quota_exceeded_error' ||
    messageType === 'rate_limited' ||
    messageType === 'scribe_rate_limited_error' ||
    messageType === 'error' ||
    messageType === 'scribe_error' ||
    messageType === 'input_error' ||
    messageType === 'scribe_input_error' ||
    messageType === 'transcriber_error' ||
    messageType === 'scribe_transcriber_error' ||
    messageType === 'invalid_request' ||
    messageType === 'session_time_limit_exceeded' ||
    messageType === 'scribe_session_time_limit_exceeded_error' ||
    messageType === 'chunk_size_exceeded' ||
    messageType === 'scribe_chunk_size_exceeded_error' ||
    messageType === 'queue_overflow' ||
    messageType === 'scribe_queue_overflow_error' ||
    messageType === 'resource_exhausted' ||
    messageType === 'scribe_resource_exhausted_error' ||
    messageType === 'insufficient_audio_activity' ||
    messageType === 'scribe_insufficient_audio_activity_error' ||
    messageType === 'unaccepted_terms' ||
    messageType === 'scribe_unaccepted_terms_error' ||
    messageType === 'commit_throttled' ||
    messageType === 'scribe_throttled_error'
  ) {
    const detail =
      (typeof record.error === 'string' && record.error.trim()) ||
      (typeof record.message === 'string' && record.message.trim()) ||
      (typeof record.text === 'string' && record.text.trim()) ||
      '';
    return {
      kind: 'error',
      message: detail ? `ElevenLabs: ${detail}` : `ElevenLabs transcription error (${messageType})`,
    };
  }

  const text = typeof record.text === 'string' ? record.text.trim() : '';
  if (!text) return null;

  if (messageType === 'partial_transcript' || messageType === 'final_transcript') {
    // final_transcript is settled but not yet committed — treat as revisable partial.
    return { kind: 'partial', text };
  }

  if (messageType === 'committed_transcript') {
    return { kind: 'final', text };
  }

  // session_started, timestamp/entity follow-ups, unknown types — ignore.
  return null;
}

/**
 * Soft-splits an ElevenLabs server frame into hub events.
 * @param msg - Parsed WebSocket JSON.
 * @param finalizedPrefix - Text already emitted as finals for the active segment.
 * @param sourceLanguage - Channel source language for event metadata.
 * @returns Updated prefix, hub events, and whether the segment lock should reset.
 */
export function applyElevenLabsServerMessage(
  msg: unknown,
  finalizedPrefix: string,
  sourceLanguage: string
): { finalizedPrefix: string; events: StreamingAsrEvent[]; resetSegment: boolean } {
  const mapped = elevenLabsEventFromServerMessage(msg);
  if (!mapped) {
    return { finalizedPrefix, events: [], resetSegment: false };
  }
  if (mapped.kind === 'error') {
    return {
      finalizedPrefix,
      events: [{ kind: 'error', message: mapped.message }],
      resetSegment: false,
    };
  }

  const applied = applyElevenLabsTranscript({
    kind: mapped.kind,
    text: mapped.text,
    finalizedPrefix,
    sourceLanguage,
  });
  return {
    finalizedPrefix: applied.finalizedPrefix,
    events: applied.events,
    resetSegment: mapped.kind === 'final',
  };
}

/**
 * Builds the ElevenLabs Scribe realtime WebSocket URL for PCM16 LE mono @ 16 kHz.
 * @param sourceLanguage - Spoken source language (ISO / BCP-47).
 * @returns Fully-qualified `wss://` URL.
 */
export function buildElevenLabsStreamingUrl(sourceLanguage: string): string {
  const url = new URL(ELEVENLABS_STT_WS_BASE);
  url.searchParams.set('model_id', ELEVENLABS_REALTIME_MODEL_ID);
  url.searchParams.set('audio_format', 'pcm_16000');
  // VAD auto-commits on silence — required for live sermon ingest (no manual commit).
  url.searchParams.set('commit_strategy', 'vad');
  url.searchParams.set('language_code', shortLanguageCode(sourceLanguage));
  // Drop fillers / false starts for cleaner captions.
  url.searchParams.set('no_verbatim', 'true');
  return url.toString();
}

/**
 * Opens an ElevenLabs Scribe v2 realtime transcription session.
 * Streams base64 PCM chunks; soft-splits long VAD segments into caption-sized finals.
 * @param options - API key, language, and event handler.
 * @returns Promise resolving to a PCM-accepting session.
 */
export async function createElevenLabsAsrSession(
  options: StreamingAsrCreateOptions
): Promise<StreamingAsrSession> {
  const url = buildElevenLabsStreamingUrl(options.sourceLanguage);
  const ws = new WebSocket(url, {
    headers: { 'xi-api-key': options.apiKey },
  });

  let closed = false;
  /** Cumulative text already emitted as caption finals for the active VAD segment. */
  let finalizedPrefix = '';

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (err) => reject(err));
  });

  const emit = (event: StreamingAsrEvent) => {
    options.onEvent(event);
  };

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(String(data)) as unknown;
      const applied = applyElevenLabsServerMessage(msg, finalizedPrefix, options.sourceLanguage);
      finalizedPrefix = applied.resetSegment ? '' : applied.finalizedPrefix;
      for (const event of applied.events) {
        emit(event);
      }
    } catch {
      // ignore malformed frames
    }
  });

  ws.on('error', (err) => {
    emit({
      kind: 'error',
      message: err instanceof Error ? err.message : 'ElevenLabs WebSocket error',
    });
  });

  return {
    writePcm(pcm: Buffer, sampleRate = 16_000) {
      if (closed || ws.readyState !== WebSocket.OPEN || pcm.byteLength === 0) return;
      try {
        sendWsText(
          ws,
          JSON.stringify({
            message_type: 'input_audio_chunk',
            audio_base_64: pcm.toString('base64'),
            commit: false,
            sample_rate: sampleRate > 0 ? sampleRate : 16_000,
          })
        );
      } catch (error) {
        emit({
          kind: 'error',
          message: error instanceof Error ? error.message : 'ElevenLabs send failed',
        });
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      finalizedPrefix = '';
      if (ws.readyState === WebSocket.OPEN) {
        try {
          // Manual commit flushes any trailing audio before teardown.
          sendWsText(ws, JSON.stringify({ message_type: 'commit' }));
        } catch {
          // ignore
        }
      }
      await new Promise<void>((resolve) => {
        ws.once('close', () => resolve());
        try {
          ws.close();
        } catch {
          resolve();
        }
        setTimeout(resolve, 1_000);
      });
    },
  };
}
