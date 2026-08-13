// =============================================================================
// AssemblyAI Universal Streaming WebSocket adapter
// =============================================================================

import WebSocket from 'ws';
import {
  assemblyaiLanguageParam,
  type StreamingAsrCreateOptions,
  type StreamingAsrEvent,
  type StreamingAsrSession,
} from '@/lib/translation/streaming-asr/types';
import { applyCumulativeUtteranceTranscript } from '@/lib/translation/streaming-asr/utterance-split';
import { sendWsBinary, sendWsText } from '@/lib/translation/streaming-asr/ws-send';

/**
 * Maps an AssemblyAI Turn frame to a soft-split kind for caption emission.
 *
 * With `format_turns=true`, AssemblyAI sends an unformatted `end_of_turn` then a
 * formatted one — treating both as provider finals would duplicate captions.
 * Soft-split still runs on the unformatted turn as a partial so long speech
 * becomes sentence-sized finals before the formatted flush.
 * @param msg - Parsed Turn fields.
 * @returns `final` when the turn is complete (formatted if formatting is on).
 */
export function assemblyaiTurnKind(msg: {
  end_of_turn?: boolean;
  turn_is_formatted?: boolean;
}): 'partial' | 'final' {
  if (!msg.end_of_turn) return 'partial';
  // format_turns off → turn_is_formatted is absent; end_of_turn alone is enough.
  if (msg.turn_is_formatted === false) return 'partial';
  return 'final';
}

/**
 * Soft-splits AssemblyAI cumulative turn text into caption-sized hub events.
 * @param input - Latest frame kind/text plus text already emitted as finals.
 * @returns Updated finalized prefix and zero or more hub events (in order).
 */
export function applyAssemblyaiTranscript(input: {
  kind: 'partial' | 'final';
  text: string;
  finalizedPrefix: string;
  sourceLanguage: string;
}): { finalizedPrefix: string; events: StreamingAsrEvent[] } {
  return applyCumulativeUtteranceTranscript(input);
}

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
  /** Cumulative text already emitted as caption finals for the active AssemblyAI turn. */
  let finalizedPrefix = '';
  /** AssemblyAI turn id — transcript resets per turn, so the soft-split lock must too. */
  let currentTurnOrder: number | null = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(String(data)) as {
        type?: string;
        transcript?: string;
        end_of_turn?: boolean;
        turn_is_formatted?: boolean;
        turn_order?: number;
      };
      if (msg.type === 'Termination' || msg.type === 'error') {
        if (msg.type === 'error') {
          options.onEvent({ kind: 'error', message: 'AssemblyAI streaming error' });
        }
        return;
      }
      const text = msg.transcript?.trim() ?? '';
      if (!text) return;

      if (typeof msg.turn_order === 'number' && msg.turn_order !== currentTurnOrder) {
        currentTurnOrder = msg.turn_order;
        finalizedPrefix = '';
      }

      const applied = applyAssemblyaiTranscript({
        kind: assemblyaiTurnKind(msg),
        text,
        finalizedPrefix,
        sourceLanguage: options.sourceLanguage,
      });
      finalizedPrefix = applied.finalizedPrefix;
      for (const event of applied.events) {
        options.onEvent(event);
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
      finalizedPrefix = '';
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
