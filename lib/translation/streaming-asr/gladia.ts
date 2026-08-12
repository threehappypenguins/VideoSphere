// =============================================================================
// Gladia live STT adapter (HTTP init + WebSocket)
// =============================================================================

import WebSocket from 'ws';
import {
  shortLanguageCode,
  type StreamingAsrCreateOptions,
  type StreamingAsrEvent,
  type StreamingAsrSession,
} from '@/lib/translation/streaming-asr/types';
import { sendWsBinary, sendWsText } from '@/lib/translation/streaming-asr/ws-send';

/**
 * Maps a Gladia live WebSocket JSON frame to a hub ASR event.
 *
 * Gladia v2 sends `data.utterance` as an object with a `text` field (not a bare string).
 * @param msg - Parsed server message.
 * @param sourceLanguage - Channel source language for event metadata.
 * @returns Hub event, or null when the frame should be ignored.
 */
export function gladiaEventFromServerMessage(
  msg: unknown,
  sourceLanguage: string
): StreamingAsrEvent | null {
  if (!msg || typeof msg !== 'object') return null;
  const record = msg as {
    type?: unknown;
    data?: {
      is_final?: unknown;
      utterance?: unknown;
    };
  };

  if (record.type !== 'transcript') return null;

  const utterance = record.data?.utterance;
  const text =
    utterance &&
    typeof utterance === 'object' &&
    typeof (utterance as { text?: unknown }).text === 'string'
      ? (utterance as { text: string }).text.trim()
      : typeof utterance === 'string'
        ? utterance.trim()
        : '';
  if (!text) return null;

  if (record.data?.is_final) {
    return { kind: 'final', text, language: sourceLanguage };
  }
  return { kind: 'partial', text, language: sourceLanguage };
}

/**
 * Opens a Gladia live transcription session (POST /v2/live then WebSocket).
 * @param options - API key, language, and event handler.
 * @returns Promise resolving to a PCM-accepting session.
 */
export async function createGladiaAsrSession(
  options: StreamingAsrCreateOptions
): Promise<StreamingAsrSession> {
  const language = shortLanguageCode(options.sourceLanguage);
  const initRes = await fetch('https://api.gladia.io/v2/live', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-gladia-key': options.apiKey,
    },
    body: JSON.stringify({
      encoding: 'wav/pcm',
      sample_rate: 16000,
      bit_depth: 16,
      channels: 1,
      language_config: {
        languages: [language],
        code_switching: false,
      },
      messages_config: {
        receive_partial_transcripts: true,
        receive_final_transcripts: true,
      },
    }),
  });

  if (!initRes.ok) {
    const body = await initRes.text().catch(() => '');
    throw new Error(`Gladia live init failed (${initRes.status}): ${body.slice(0, 200)}`);
  }

  const initJson = (await initRes.json()) as { url?: string; id?: string };
  const wsUrl = initJson.url?.trim();
  if (!wsUrl) {
    throw new Error('Gladia live init did not return a WebSocket URL.');
  }

  const ws = new WebSocket(wsUrl);
  let closed = false;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(String(data)) as unknown;
      const event = gladiaEventFromServerMessage(msg, options.sourceLanguage);
      if (event) options.onEvent(event);
    } catch {
      // ignore
    }
  });

  ws.on('error', (err) => {
    options.onEvent({
      kind: 'error',
      message: err instanceof Error ? err.message : 'Gladia WebSocket error',
    });
  });

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (err) => reject(err));
  });

  return {
    writePcm(pcm: Buffer) {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      try {
        sendWsBinary(ws, pcm);
      } catch (error) {
        options.onEvent({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Gladia send failed',
        });
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          sendWsText(ws, JSON.stringify({ type: 'stop_recording' }));
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
