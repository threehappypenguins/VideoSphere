// =============================================================================
// Speechmatics Realtime WebSocket adapter
// =============================================================================

import WebSocket from 'ws';
import {
  shortLanguageCode,
  type StreamingAsrCreateOptions,
  type StreamingAsrSession,
} from '@/lib/translation/streaming-asr/types';
import { sendWsBinary, sendWsText } from '@/lib/translation/streaming-asr/ws-send';

/**
 * Opens a Speechmatics realtime recognition session.
 * @param options - API key, language, and event handler.
 * @returns Promise resolving to a PCM-accepting session.
 */
export async function createSpeechmaticsAsrSession(
  options: StreamingAsrCreateOptions
): Promise<StreamingAsrSession> {
  const language = shortLanguageCode(options.sourceLanguage);
  const ws = new WebSocket('wss://eu.rt.speechmatics.com/v2/', {
    headers: { Authorization: `Bearer ${options.apiKey}` },
  });

  let closed = false;
  let seqNo = 0;

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => {
      sendWsText(
        ws,
        JSON.stringify({
          message: 'StartRecognition',
          audio_format: {
            type: 'raw',
            encoding: 'pcm_s16le',
            sample_rate: 16000,
          },
          transcription_config: {
            language,
            enable_partials: true,
            max_delay: 1.5,
          },
        })
      );
      resolve();
    });
    ws.once('error', (err) => reject(err));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(String(data)) as {
        message?: string;
        metadata?: { transcript?: string };
        results?: Array<{
          alternatives?: Array<{ content?: string }>;
          type?: string;
        }>;
      };
      if (msg.message === 'Error') {
        options.onEvent({ kind: 'error', message: 'Speechmatics recognition error' });
        return;
      }
      const fromMeta = msg.metadata?.transcript?.trim();
      let text = fromMeta ?? '';
      if (!text && Array.isArray(msg.results)) {
        text = msg.results
          .map((r) => r.alternatives?.[0]?.content ?? '')
          .join('')
          .trim();
      }
      if (!text) return;
      if (msg.message === 'AddTranscript') {
        options.onEvent({ kind: 'final', text, language: options.sourceLanguage });
      } else if (msg.message === 'AddPartialTranscript') {
        options.onEvent({ kind: 'partial', text, language: options.sourceLanguage });
      }
    } catch {
      // ignore
    }
  });

  ws.on('error', (err) => {
    options.onEvent({
      kind: 'error',
      message: err instanceof Error ? err.message : 'Speechmatics WebSocket error',
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
          message: error instanceof Error ? error.message : 'Speechmatics send failed',
        });
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          seqNo += 1;
          sendWsText(ws, JSON.stringify({ message: 'EndOfStream', last_seq_no: seqNo }));
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
