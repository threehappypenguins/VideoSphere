// =============================================================================
// Soniox real-time STT (+ optional one-way translation) adapter
// =============================================================================

import WebSocket from 'ws';
import {
  shortLanguageCode,
  type StreamingAsrCreateOptions,
  type StreamingAsrSession,
} from '@/lib/translation/streaming-asr/types';
import { sendWsBinary, sendWsText } from '@/lib/translation/streaming-asr/ws-send';

type SonioxToken = {
  text?: string;
  is_final?: boolean;
  language?: string;
  translation_status?: 'none' | 'original' | 'translation';
  source_language?: string;
};

/**
 * Accumulates Soniox tokens into partial/final original and translation strings.
 * @param tokens - Token array from a Soniox response frame.
 * @returns Accumulated strings keyed by channel.
 */
export function accumulateSonioxTokens(tokens: SonioxToken[]): {
  partialOriginal: string;
  finalOriginal: string;
  partialTranslation: string;
  finalTranslation: string;
} {
  let partialOriginal = '';
  let finalOriginal = '';
  let partialTranslation = '';
  let finalTranslation = '';

  for (const token of tokens) {
    const text = typeof token.text === 'string' ? token.text : '';
    if (!text) continue;
    const status = token.translation_status ?? 'none';
    const isFinal = Boolean(token.is_final);
    if (status === 'translation') {
      if (isFinal) finalTranslation += text;
      else partialTranslation += text;
    } else {
      // original or none
      if (isFinal) finalOriginal += text;
      else partialOriginal += text;
    }
  }

  return {
    partialOriginal: partialOriginal.trim(),
    finalOriginal: finalOriginal.trim(),
    partialTranslation: partialTranslation.trim(),
    finalTranslation: finalTranslation.trim(),
  };
}

/**
 * Opens a Soniox real-time WebSocket session.
 * When `targetLanguage` is set, enables one-way translation to that language.
 * @param options - API key, languages, and event handler.
 * @returns Promise resolving to a PCM-accepting session.
 */
export async function createSonioxAsrSession(
  options: StreamingAsrCreateOptions
): Promise<StreamingAsrSession> {
  const source = shortLanguageCode(options.sourceLanguage);
  const target = options.targetLanguage ? shortLanguageCode(options.targetLanguage) : undefined;

  const ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');
  let closed = false;

  // Running buffers for non-final tokens that get rewritten.
  let pendingOriginal = '';
  let pendingTranslation = '';

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => {
      const config: Record<string, unknown> = {
        api_key: options.apiKey,
        model: 'stt-rt-v5',
        audio_format: 'pcm_s16le',
        sample_rate: 16000,
        num_channels: 1,
        language_hints: target && target !== source ? [source, target] : [source],
        enable_language_identification: true,
      };
      if (target && target !== source) {
        config.translation = {
          type: 'one_way',
          target_language: target,
        };
      }
      sendWsText(ws, JSON.stringify(config));
      resolve();
    });
    ws.once('error', (err) => reject(err));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(String(data)) as {
        tokens?: SonioxToken[];
        finished?: boolean;
        error_code?: number;
        error_message?: string;
      };
      if (msg.error_message) {
        options.onEvent({ kind: 'error', message: msg.error_message });
        return;
      }
      if (!Array.isArray(msg.tokens) || msg.tokens.length === 0) {
        if (msg.finished) return;
        return;
      }

      const acc = accumulateSonioxTokens(msg.tokens);

      if (acc.finalOriginal) {
        pendingOriginal = '';
        options.onEvent({
          kind: 'final',
          text: acc.finalOriginal,
          language: options.sourceLanguage,
          isTranslation: false,
        });
      } else if (acc.partialOriginal) {
        pendingOriginal = acc.partialOriginal;
        options.onEvent({
          kind: 'partial',
          text: pendingOriginal,
          language: options.sourceLanguage,
          isTranslation: false,
        });
      }

      if (target) {
        if (acc.finalTranslation) {
          pendingTranslation = '';
          options.onEvent({
            kind: 'final',
            text: acc.finalTranslation,
            language: options.targetLanguage,
            isTranslation: true,
          });
        } else if (acc.partialTranslation) {
          pendingTranslation = acc.partialTranslation;
          options.onEvent({
            kind: 'partial',
            text: pendingTranslation,
            language: options.targetLanguage,
            isTranslation: true,
          });
        }
      }
    } catch {
      // ignore
    }
  });

  ws.on('error', (err) => {
    options.onEvent({
      kind: 'error',
      message: err instanceof Error ? err.message : 'Soniox WebSocket error',
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
          message: error instanceof Error ? error.message : 'Soniox send failed',
        });
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          // Empty frame signals end of audio.
          sendWsBinary(ws, Buffer.alloc(0));
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
