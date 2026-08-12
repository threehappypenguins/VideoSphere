// =============================================================================
// Modulate Velma multilingual streaming STT adapter
// https://docs.modulate.ai/api-reference/stt/streaming
// =============================================================================

import WebSocket from 'ws';
import {
  shortLanguageCode,
  type StreamingAsrCreateOptions,
  type StreamingAsrEvent,
  type StreamingAsrSession,
} from '@/lib/translation/streaming-asr/types';
import {
  appendFinalizedPrefix,
  remainingAfterFinalizedPrefix,
  shouldFinalizeCompleteSentence,
  takeUtteranceChunk,
} from '@/lib/translation/streaming-asr/utterance-split';
import { sendWsBinary } from '@/lib/translation/streaming-asr/ws-send';

const MODULATE_STT_WS_BASE = 'wss://platform.modulate.ai/api/velma-2-stt-streaming';

/** Target WebSocket frame size: 100ms of 16 kHz mono PCM16 (matches Modulate examples). */
const MODULATE_PCM_FRAME_BYTES = 3_200;

/**
 * Maps a Modulate WebSocket JSON frame to a hub ASR event.
 * Prefer `applyModulateServerMessage` in the live session — it soft-splits long turns.
 * @param msg - Parsed server message.
 * @param sourceLanguage - Channel source language for event metadata.
 * @returns Hub event, or null when the frame should be ignored.
 */
export function modulateEventFromServerMessage(
  msg: unknown,
  sourceLanguage: string
): StreamingAsrEvent | null {
  if (!msg || typeof msg !== 'object') return null;
  const record = msg as {
    type?: unknown;
    error?: unknown;
    utterance?: { text?: unknown };
    partial_utterance?: { text?: unknown };
  };

  if (record.type === 'error') {
    const message =
      typeof record.error === 'string' && record.error.trim()
        ? record.error.trim()
        : 'Modulate transcription error';
    return { kind: 'error', message };
  }

  if (record.type === 'utterance') {
    const text = typeof record.utterance?.text === 'string' ? record.utterance.text.trim() : '';
    if (!text) return null;
    return { kind: 'final', text, language: sourceLanguage };
  }

  if (record.type === 'partial_utterance') {
    const text =
      typeof record.partial_utterance?.text === 'string'
        ? record.partial_utterance.text.trim()
        : '';
    if (!text) return null;
    return { kind: 'partial', text, language: sourceLanguage };
  }

  // `done` and unknown types are ignored; close() drains the socket.
  return null;
}

/**
 * Soft-splits Modulate cumulative partials / finals into caption-sized hub events.
 *
 * Modulate has no endpointing knob — continuous sermon speech often arrives as one
 * multi-sentence `utterance`. We finalize sentence-sized chunks from growing
 * `partial_utterance` text (and flush any remainder on the provider final).
 * @param input - Latest frame kind/text plus text already emitted as finals.
 * @returns Updated finalized prefix and zero or more hub events (in order).
 */
export function applyModulateTranscript(input: {
  kind: 'partial' | 'final';
  text: string;
  finalizedPrefix: string;
  sourceLanguage: string;
}): { finalizedPrefix: string; events: StreamingAsrEvent[] } {
  const full = input.text.trim();
  if (!full) {
    return { finalizedPrefix: input.kind === 'final' ? '' : input.finalizedPrefix, events: [] };
  }

  let finalizedPrefix = input.finalizedPrefix.trim();
  let pending = remainingAfterFinalizedPrefix(full, finalizedPrefix);
  // Provider revised earlier wording — restart from the full cumulative text.
  if (finalizedPrefix && pending === full && !full.startsWith(finalizedPrefix)) {
    finalizedPrefix = '';
    pending = full;
  }

  const events: StreamingAsrEvent[] = [];

  const emitFinal = (chunk: string) => {
    const trimmed = chunk.trim();
    if (!trimmed) return;
    events.push({ kind: 'final', text: trimmed, language: input.sourceLanguage });
    finalizedPrefix = appendFinalizedPrefix(finalizedPrefix, trimmed);
  };

  for (;;) {
    const split = takeUtteranceChunk(pending);
    if (!split) break;
    emitFinal(split.chunk);
    pending = split.rest;
  }

  if (input.kind === 'final') {
    if (pending.trim()) emitFinal(pending);
    return { finalizedPrefix: '', events };
  }

  if (pending && shouldFinalizeCompleteSentence(pending)) {
    emitFinal(pending);
    pending = '';
  }

  if (pending) {
    events.push({ kind: 'partial', text: pending, language: input.sourceLanguage });
  }

  return { finalizedPrefix, events };
}

/**
 * Builds the Modulate multilingual streaming WebSocket URL for PCM16 LE mono.
 * @param apiKey - Modulate Models API key.
 * @param sourceLanguage - Spoken source language (ISO / BCP-47).
 * @returns Fully-qualified `wss://` URL (includes `api_key` query param).
 */
export function buildModulateStreamingUrl(apiKey: string, sourceLanguage: string): string {
  const url = new URL(MODULATE_STT_WS_BASE);
  url.searchParams.set('api_key', apiKey);
  // Raw PCM requires format metadata (hub sends PCM16 LE mono @ 16 kHz).
  url.searchParams.set('audio_format', 's16le');
  url.searchParams.set('sample_rate', '16000');
  url.searchParams.set('num_channels', '1');
  url.searchParams.set('partial_results', 'true');
  // Single-speaker sermon ingest — skip unused diarization cost/noise.
  url.searchParams.set('speaker_diarization', 'false');
  url.searchParams.set('language', shortLanguageCode(sourceLanguage));
  return url.toString();
}

/**
 * Aligns raw PCM16 LE bytes so each WebSocket frame is a whole number of samples.
 *
 * Modulate answers odd-length `s16le` frames with `{"type":"error","error":"Invalid input audio"}`
 * and closes the socket. Upstream chunks are not guaranteed even (base64 ingest, RTMP flush,
 * buffer views), so a trailing odd byte is carried into the next frame.
 * @param pendingOddByte - Zero or one leftover byte from the previous chunk.
 * @param pcm - Next PCM chunk (may be empty or odd-length).
 * @returns Even-length frame to send (may be empty) and the new pending odd byte.
 */
export function alignModulateS16leFrame(
  pendingOddByte: Buffer,
  pcm: Buffer
): { frame: Buffer; pendingOddByte: Buffer } {
  const carry = pendingOddByte.length > 0 ? pendingOddByte.subarray(0, 1) : Buffer.alloc(0);
  const aligned = carry.length > 0 ? Buffer.concat([carry, pcm]) : pcm;
  if (aligned.length === 0) {
    return { frame: Buffer.alloc(0), pendingOddByte: Buffer.alloc(0) };
  }
  if (aligned.length % 2 === 0) {
    return { frame: Buffer.from(aligned), pendingOddByte: Buffer.alloc(0) };
  }
  return {
    frame: Buffer.from(aligned.subarray(0, aligned.length - 1)),
    pendingOddByte: Buffer.from(aligned.subarray(aligned.length - 1)),
  };
}

/**
 * Opens a Modulate Velma multilingual streaming recognition session.
 * @param options - API key, language, and event handler.
 * @returns Promise resolving to a PCM-accepting session.
 */
/**
 * True when Modulate's error is a transient audio-frame reject that the hub can
 * heal by opening a fresh socket (do not sticky-toast listeners).
 * @param message - Provider error text.
 * @returns Whether the hub should soft-reconnect silently.
 */
export function isModulateSoftReconnectError(message: string): boolean {
  return /invalid input audio/i.test(message);
}

/**
 * Opens a Modulate Velma multilingual streaming recognition session.
 * @param options - API key, language, and event handler.
 * @returns Promise resolving to a PCM-accepting session.
 */
export async function createModulateAsrSession(
  options: StreamingAsrCreateOptions
): Promise<StreamingAsrSession> {
  const ws = new WebSocket(buildModulateStreamingUrl(options.apiKey, options.sourceLanguage));

  let closed = false;
  /** Provider already rejected the stream — skip remainder flush on close. */
  let providerFatal = false;
  let pendingOddByte: Buffer = Buffer.alloc(0);
  let sendBuffer: Buffer = Buffer.alloc(0);
  /** Cumulative text already emitted as caption finals for the active Modulate turn. */
  let finalizedPrefix = '';

  const emit = (event: StreamingAsrEvent) => {
    // Intentional teardown (listener leave, replace-after-error) must not notify the
    // hub — a late "Invalid input audio" from the dying socket was sticky-toasting
    // listeners who already had a healthy replacement session.
    if (closed) return;
    if (event.kind === 'error') providerFatal = true;
    options.onEvent(event);
  };

  ws.on('message', (data) => {
    if (closed) return;
    try {
      const msg = JSON.parse(String(data)) as unknown;
      const raw = modulateEventFromServerMessage(msg, options.sourceLanguage);
      if (!raw) return;
      if (raw.kind === 'error' || raw.kind === 'audio_event') {
        emit(raw);
        return;
      }
      const applied = applyModulateTranscript({
        kind: raw.kind,
        text: raw.text,
        finalizedPrefix,
        sourceLanguage: options.sourceLanguage,
      });
      finalizedPrefix = applied.finalizedPrefix;
      for (const event of applied.events) {
        emit(event);
      }
    } catch {
      // ignore malformed frames
    }
  });

  ws.on('close', (code) => {
    if (closed) return;
    if (code === 4001 || code === 4003) {
      emit({
        kind: 'error',
        message: 'Modulate API key is invalid or not permitted for this model.',
      });
      return;
    }
    if (code === 4029) {
      emit({
        kind: 'error',
        message: 'Modulate rate limit or credits exceeded.',
      });
      return;
    }
    if (code === 1003) {
      emit({
        kind: 'error',
        message: 'Modulate rejected the audio format or language parameters.',
      });
    }
  });

  ws.on('error', (err) => {
    emit({
      kind: 'error',
      message: err instanceof Error ? err.message : 'Modulate WebSocket error',
    });
  });

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (err) => reject(err));
  });

  const flushSendBuffer = (forceRemainder: boolean) => {
    if (closed || providerFatal || ws.readyState !== WebSocket.OPEN) return;
    while (sendBuffer.length >= MODULATE_PCM_FRAME_BYTES) {
      const chunk = Buffer.from(sendBuffer.subarray(0, MODULATE_PCM_FRAME_BYTES));
      sendBuffer = Buffer.from(sendBuffer.subarray(MODULATE_PCM_FRAME_BYTES));
      sendWsBinary(ws, chunk);
    }
    if (forceRemainder && sendBuffer.length >= 2) {
      // Keep even length; drop a trailing orphan if present.
      const evenLen = sendBuffer.length - (sendBuffer.length % 2);
      if (evenLen > 0) {
        sendWsBinary(ws, Buffer.from(sendBuffer.subarray(0, evenLen)));
      }
      sendBuffer = Buffer.alloc(0);
    }
  };

  return {
    writePcm(pcm: Buffer) {
      if (closed || providerFatal || ws.readyState !== WebSocket.OPEN) return;
      // Empty binary frames also trigger "Invalid input audio" on Velma.
      if (pcm.length === 0 && pendingOddByte.length === 0) return;
      try {
        const aligned = alignModulateS16leFrame(pendingOddByte, pcm);
        pendingOddByte = aligned.pendingOddByte;
        if (aligned.frame.length === 0) return;
        sendBuffer =
          sendBuffer.length > 0
            ? Buffer.concat([sendBuffer, aligned.frame])
            : Buffer.from(aligned.frame);
        flushSendBuffer(false);
      } catch (error) {
        emit({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Modulate send failed',
        });
      }
    },
    async close() {
      if (closed) return;
      // Mark closed before touching the socket so late provider frames are ignored.
      closed = true;
      pendingOddByte = Buffer.alloc(0);
      finalizedPrefix = '';
      if (!providerFatal && ws.readyState === WebSocket.OPEN) {
        try {
          flushSendBuffer(true);
          // Live mid-session teardown: do not send empty-text EOS. An empty text
          // frame as the first (or only) message is parsed as invalid config, and
          // racing EOS + ws.close() has produced "Invalid input audio" in the wild.
          // Official empty-text EOS is for orderly end-of-file drains.
        } catch {
          // ignore
        }
      }
      sendBuffer = Buffer.alloc(0);
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
