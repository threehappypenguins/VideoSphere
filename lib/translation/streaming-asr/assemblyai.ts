// =============================================================================
// AssemblyAI Universal Streaming WebSocket adapter
// =============================================================================

import WebSocket from 'ws';
import {
  assemblyaiLanguageParam,
  type StreamingAsrCreateOptions,
  type StreamingAsrSession,
} from '@/lib/translation/streaming-asr/types';
import { sendWsBinary, sendWsText } from '@/lib/translation/streaming-asr/ws-send';

/**
 * Opens an AssemblyAI real-time transcription session.
 * Uses Universal-3.5 Pro for Mandarin; multilingual streaming otherwise.
 * @param options - API key, language, and event handler.
 * @returns Session that accepts PCM16 mono frames.
 */
export function createAssemblyaiAsrSession(
  options: StreamingAsrCreateOptions
): StreamingAsrSession {
  const language = assemblyaiLanguageParam(options.sourceLanguage);
  const isZh = language === 'zh';
  const params = new URLSearchParams({
    sample_rate: '16000',
    format_turns: 'true',
    language_code: language,
  });
  // Mandarin requires Universal-3.5 Pro on streaming.
  if (isZh) {
    params.set('speech_model', 'u3-rt-pro');
  }
  const url = `wss://streaming.assemblyai.com/v3/ws?${params.toString()}`;
  const ws = new WebSocket(url, {
    headers: { Authorization: options.apiKey },
  });

  let closed = false;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(String(data)) as {
        type?: string;
        transcript?: string;
        end_of_turn?: boolean;
        turn_is_formatted?: boolean;
      };
      if (msg.type === 'Termination' || msg.type === 'error') {
        if (msg.type === 'error') {
          options.onEvent({ kind: 'error', message: 'AssemblyAI streaming error' });
        }
        return;
      }
      const text = msg.transcript?.trim() ?? '';
      if (!text) return;
      if (msg.end_of_turn) {
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
      message: err instanceof Error ? err.message : 'AssemblyAI WebSocket error',
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
          message: error instanceof Error ? error.message : 'AssemblyAI send failed',
        });
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          sendWsText(ws, JSON.stringify({ type: 'Terminate' }));
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
