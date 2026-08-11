// =============================================================================
// Gladia live STT adapter (HTTP init + WebSocket)
// =============================================================================

import WebSocket from 'ws';
import {
  shortLanguageCode,
  type StreamingAsrCreateOptions,
  type StreamingAsrSession,
} from '@/lib/translation/streaming-asr/types';
import { sendWsBinary, sendWsText } from '@/lib/translation/streaming-asr/ws-send';

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
      const msg = JSON.parse(String(data)) as {
        type?: string;
        data?: { utterance?: string; is_final?: boolean };
      };
      if (msg.type !== 'transcript') return;
      const text = msg.data?.utterance?.trim() ?? '';
      if (!text) return;
      if (msg.data?.is_final) {
        options.onEvent({ kind: 'final', text, language: options.sourceLanguage });
      } else {
        options.onEvent({ kind: 'partial', text, language: options.sourceLanguage });
      }
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
