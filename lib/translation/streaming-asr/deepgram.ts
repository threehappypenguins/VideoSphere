// =============================================================================
// Deepgram live listen WebSocket adapter
// =============================================================================

import WebSocket from 'ws';
import {
  deepgramLanguageParam,
  type StreamingAsrCreateOptions,
  type StreamingAsrSession,
} from '@/lib/translation/streaming-asr/types';
import {
  shouldFinalizeCompleteSentence,
  takeUtteranceChunk,
  STREAMING_MIN_SENTENCE_FINAL_CHARS,
  STREAMING_UTTERANCE_HARD_MAX_CHARS,
  STREAMING_UTTERANCE_SOFT_MAX_CHARS,
} from '@/lib/translation/streaming-asr/utterance-split';
import { sendWsBinary, sendWsText } from '@/lib/translation/streaming-asr/ws-send';

const KEEP_ALIVE_MS = 8_000;

/** @deprecated Prefer STREAMING_UTTERANCE_SOFT_MAX_CHARS — kept for existing imports/tests. */
export const DEEPGRAM_UTTERANCE_SOFT_MAX_CHARS = STREAMING_UTTERANCE_SOFT_MAX_CHARS;
/** @deprecated Prefer STREAMING_UTTERANCE_HARD_MAX_CHARS. */
export const DEEPGRAM_UTTERANCE_HARD_MAX_CHARS = STREAMING_UTTERANCE_HARD_MAX_CHARS;
/** @deprecated Prefer STREAMING_MIN_SENTENCE_FINAL_CHARS. */
export const DEEPGRAM_MIN_SENTENCE_FINAL_CHARS = STREAMING_MIN_SENTENCE_FINAL_CHARS;

export { takeUtteranceChunk };

/**
 * Applies one Deepgram Results frame to the current utterance buffers.
 *
 * Deepgram `is_final` only locks a time-slice; the next interim starts a new
 * slice. `speech_final` marks end-of-utterance (pause). Empty-transcript
 * `speech_final` still flushes committed text (Deepgram often signals EOS that way).
 *
 * @param committed - Text already locked by prior `is_final` slices this utterance.
 * @param transcript - Transcript from this Results frame.
 * @param isFinal - Deepgram `is_final`.
 * @param speechFinal - Deepgram `speech_final`.
 * @returns Updated committed text plus the event to emit (if any).
 */
export function applyDeepgramResult(input: {
  committed: string;
  transcript: string;
  isFinal: boolean;
  speechFinal: boolean;
}): {
  committed: string;
  event: { kind: 'partial' | 'final'; text: string } | null;
} {
  const transcript = input.transcript.trim();
  if (!transcript) {
    if (input.speechFinal && input.committed.trim()) {
      return {
        committed: '',
        event: { kind: 'final', text: input.committed.trim() },
      };
    }
    return { committed: input.committed, event: null };
  }

  if (input.isFinal) {
    const committed = [input.committed, transcript].filter(Boolean).join(' ').trim();
    if (input.speechFinal) {
      return {
        committed: '',
        event: committed ? { kind: 'final', text: committed } : null,
      };
    }
    return {
      committed,
      event: committed ? { kind: 'partial', text: committed } : null,
    };
  }

  const display = [input.committed, transcript].filter(Boolean).join(' ').trim();
  return {
    committed: input.committed,
    event: display ? { kind: 'partial', text: display } : null,
  };
}

/**
 * Opens a Deepgram streaming recognition session.
 * @param options - API key, language, and event handler.
 * @returns Session that accepts PCM16 mono frames.
 */
export function createDeepgramAsrSession(options: StreamingAsrCreateOptions): StreamingAsrSession {
  const language = deepgramLanguageParam(options.sourceLanguage);
  const params = new URLSearchParams({
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    punctuate: 'true',
    // Endpointing drives speech_final after a short pause (ms of silence).
    endpointing: '400',
    // UtteranceEnd covers cases where speech_final never fires (long turns).
    utterance_end_ms: '1000',
    vad_events: 'true',
    language,
  });
  const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  const ws = new WebSocket(url, {
    headers: { Authorization: `Token ${options.apiKey}` },
  });

  let closed = false;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  /** Locked transcript slices for the current utterance (between speech_final). */
  let committed = '';

  const stopKeepAlive = () => {
    if (keepAlive) {
      clearInterval(keepAlive);
      keepAlive = null;
    }
  };

  /**
   * Emits a final caption/TTS unit and clears or shrinks the committed buffer.
   * @param text - Finalized utterance text.
   */
  const emitFinal = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    options.onEvent({
      kind: 'final',
      text: trimmed,
      language: options.sourceLanguage,
    });
  };

  /**
   * Emits a partial (in-progress) caption for the current utterance.
   * @param text - Display text.
   */
  const emitPartial = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    options.onEvent({
      kind: 'partial',
      text: trimmed,
      language: options.sourceLanguage,
    });
  };

  /**
   * Flushes committed text as one or more caption/TTS units (never one giant blurb).
   */
  const flushCommittedAsCaptionUnits = () => {
    softFinalizeCommitted();
    if (committed.trim()) {
      emitFinal(committed.trim());
      committed = '';
    }
  };

  /**
   * After locking more `is_final` text, emit caption-sized finals so continuous
   * speech does not become one multi-minute blurb before the first pause.
   * Leaves any remainder in `committed` for the caller to show as a partial.
   */
  const softFinalizeCommitted = () => {
    for (;;) {
      const split = takeUtteranceChunk(committed);
      if (!split) break;
      emitFinal(split.chunk);
      committed = split.rest;
    }
  };

  /**
   * True when locked text already ends a sentence and is long enough to speak alone.
   * @param text - Committed transcript.
   */
  const shouldFlushSentence = (text: string): boolean => shouldFinalizeCompleteSentence(text);

  ws.on('open', () => {
    keepAlive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          sendWsText(ws, JSON.stringify({ type: 'KeepAlive' }));
        } catch {
          // ignore keep-alive failures; close path will surface hard errors
        }
      }
    }, KEEP_ALIVE_MS);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(String(data)) as {
        type?: string;
        is_final?: boolean;
        speech_final?: boolean;
        channel?: { alternatives?: Array<{ transcript?: string }> };
      };

      // Deepgram: finalize when UtteranceEnd arrives without a prior speech_final.
      if (msg.type === 'UtteranceEnd') {
        flushCommittedAsCaptionUnits();
        return;
      }

      if (msg.type && msg.type !== 'Results') return;
      const transcript = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? '';
      const isFinal = Boolean(msg.is_final);
      const speechFinal = Boolean(msg.speech_final);
      const applied = applyDeepgramResult({
        committed,
        transcript,
        isFinal,
        speechFinal,
      });
      committed = applied.committed;

      // speech_final / full utterance — soft-split so TTS never gets a paragraph.
      if (speechFinal) {
        if (applied.event?.kind === 'final') {
          committed = applied.event.text;
        }
        flushCommittedAsCaptionUnits();
        return;
      }

      // Locked slices: split oversized text; also flush a complete sentence promptly.
      if (isFinal) {
        softFinalizeCommitted();
        if (committed && shouldFlushSentence(committed)) {
          emitFinal(committed.trim());
          committed = '';
        } else if (committed) {
          emitPartial(committed);
        }
        return;
      }

      if (applied.event) {
        options.onEvent({
          kind: applied.event.kind,
          text: applied.event.text,
          language: options.sourceLanguage,
        });
      }
    } catch {
      // ignore malformed frames
    }
  });

  ws.on('error', (err) => {
    options.onEvent({
      kind: 'error',
      message: err instanceof Error ? err.message : 'Deepgram WebSocket error',
    });
  });

  ws.on('close', () => {
    stopKeepAlive();
  });

  return {
    writePcm(pcm: Buffer) {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      try {
        sendWsBinary(ws, pcm);
      } catch (error) {
        options.onEvent({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Deepgram send failed',
        });
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      stopKeepAlive();
      flushCommittedAsCaptionUnits();
      if (ws.readyState === WebSocket.OPEN) {
        try {
          sendWsText(ws, JSON.stringify({ type: 'CloseStream' }));
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
