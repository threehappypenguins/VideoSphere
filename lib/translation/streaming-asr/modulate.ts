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
import { sendWsBinary, sendWsText } from '@/lib/translation/streaming-asr/ws-send';

const MODULATE_STT_WS_BASE = 'wss://platform.modulate.ai/api/velma-2-stt-streaming';

/**
 * Maps a Modulate WebSocket JSON frame to a hub ASR event.
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
 * Opens a Modulate Velma multilingual streaming recognition session.
 * @param options - API key, language, and event handler.
 * @returns Promise resolving to a PCM-accepting session.
 */
export async function createModulateAsrSession(
  options: StreamingAsrCreateOptions
): Promise<StreamingAsrSession> {
  const ws = new WebSocket(buildModulateStreamingUrl(options.apiKey, options.sourceLanguage));

  let closed = false;

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (err) => reject(err));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(String(data)) as unknown;
      const event = modulateEventFromServerMessage(msg, options.sourceLanguage);
      if (event) options.onEvent(event);
    } catch {
      // ignore malformed frames
    }
  });

  ws.on('close', (code) => {
    if (closed) return;
    if (code === 4001 || code === 4003) {
      options.onEvent({
        kind: 'error',
        message: 'Modulate API key is invalid or not permitted for this model.',
      });
      return;
    }
    if (code === 4029) {
      options.onEvent({
        kind: 'error',
        message: 'Modulate rate limit or credits exceeded.',
      });
      return;
    }
    if (code === 1003) {
      options.onEvent({
        kind: 'error',
        message: 'Modulate rejected the audio format or language parameters.',
      });
    }
  });

  ws.on('error', (err) => {
    options.onEvent({
      kind: 'error',
      message: err instanceof Error ? err.message : 'Modulate WebSocket error',
    });
  });

  return {
    writePcm(pcm: Buffer) {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      try {
        sendWsBinary(ws, pcm);
      } catch (error) {
        options.onEvent({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Modulate send failed',
        });
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          // Empty text frame signals end-of-audio per Modulate streaming protocol.
          sendWsText(ws, '');
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
