// =============================================================================
// Soniox real-time STT (+ optional one-way translation) adapter
// https://soniox.com/docs/stt/rt/real-time-transcription
// =============================================================================

import WebSocket from 'ws';
import {
  shortLanguageCode,
  type StreamingAsrCreateOptions,
  type StreamingAsrEvent,
  type StreamingAsrSession,
} from '@/lib/translation/streaming-asr/types';
import { applyCumulativeUtteranceTranscript } from '@/lib/translation/streaming-asr/utterance-split';
import { sendWsBinary, sendWsText } from '@/lib/translation/streaming-asr/ws-send';

type SonioxToken = {
  text?: string;
  is_final?: boolean;
  language?: string;
  translation_status?: 'none' | 'original' | 'translation';
  source_language?: string;
};

/** Soniox control tokens — never shown as captions. */
const SONIOX_CONTROL_TOKENS = new Set(['<end>', '<fin>']);

/**
 * Soft-splits cumulative Soniox transcript text into caption-sized hub events.
 * @param input - Latest frame kind/text plus text already emitted as finals.
 * @returns Updated finalized prefix and zero or more hub events (in order).
 */
export function applySonioxTranscript(input: {
  kind: 'partial' | 'final';
  text: string;
  finalizedPrefix: string;
  sourceLanguage: string;
}): { finalizedPrefix: string; events: StreamingAsrEvent[] } {
  return applyCumulativeUtteranceTranscript(input);
}

/**
 * True when a Soniox token is an endpoint / finalize marker (not caption text).
 * @param text - Raw token text.
 * @returns Whether the token should be filtered from captions.
 */
export function isSonioxControlToken(text: string): boolean {
  return SONIOX_CONTROL_TOKENS.has(text.trim());
}

/**
 * Parses one Soniox WebSocket token frame into delta finals, replaceable partials,
 * and whether an utterance endpoint (`<end>` / `<fin>`) was signaled.
 *
 * Final tokens are deltas (sent once, never repeated). Partials rewrite each frame.
 * @param tokens - Token array from a Soniox response frame.
 * @returns Delta finals, current partials, and endpoint flag.
 */
export function parseSonioxTokenFrame(tokens: SonioxToken[]): {
  deltaFinalOriginal: string;
  deltaFinalTranslation: string;
  partialOriginal: string;
  partialTranslation: string;
  endpoint: boolean;
} {
  let deltaFinalOriginal = '';
  let deltaFinalTranslation = '';
  let partialOriginal = '';
  let partialTranslation = '';
  let endpoint = false;

  for (const token of tokens) {
    const text = typeof token.text === 'string' ? token.text : '';
    if (!text) continue;
    if (isSonioxControlToken(text)) {
      endpoint = true;
      continue;
    }
    const status = token.translation_status ?? 'none';
    const isFinal = Boolean(token.is_final);
    if (status === 'translation') {
      if (isFinal) deltaFinalTranslation += text;
      else partialTranslation += text;
    } else if (isFinal) {
      deltaFinalOriginal += text;
    } else {
      partialOriginal += text;
    }
  }

  return {
    deltaFinalOriginal,
    deltaFinalTranslation,
    partialOriginal,
    partialTranslation,
    endpoint,
  };
}

/**
 * Accumulates Soniox tokens into partial/final original and translation strings.
 * Prefer {@link parseSonioxTokenFrame} for live sessions (exposes endpoint markers).
 * @param tokens - Token array from a Soniox response frame.
 * @returns Accumulated strings keyed by channel (control tokens omitted).
 */
export function accumulateSonioxTokens(tokens: SonioxToken[]): {
  partialOriginal: string;
  finalOriginal: string;
  partialTranslation: string;
  finalTranslation: string;
} {
  const frame = parseSonioxTokenFrame(tokens);
  return {
    partialOriginal: frame.partialOriginal.trim(),
    finalOriginal: frame.deltaFinalOriginal.trim(),
    partialTranslation: frame.partialTranslation.trim(),
    finalTranslation: frame.deltaFinalTranslation.trim(),
  };
}

/**
 * Per-channel soft-split lock for one Soniox WebSocket (source and optional target).
 */
export type SonioxUtteranceState = {
  /** All final tokens received for the current utterance (source). */
  committedOriginal: string;
  /** All final tokens received for the current utterance (translation). */
  committedTranslation: string;
  /** Source text already emitted as caption finals. */
  finalizedPrefixOriginal: string;
  /** Translation text already emitted as caption finals. */
  finalizedPrefixTranslation: string;
};

/**
 * Creates an empty Soniox utterance soft-split state.
 * @returns Fresh state.
 */
export function createSonioxUtteranceState(): SonioxUtteranceState {
  return {
    committedOriginal: '',
    committedTranslation: '',
    finalizedPrefixOriginal: '',
    finalizedPrefixTranslation: '',
  };
}

/**
 * Joins committed finals with the current non-final rewrite for display / soft-split.
 * @param committed - Accumulated final token text.
 * @param partial - Current non-final tokens (rewritten each frame).
 * @returns Combined transcript trimmed for hub emission.
 */
export function joinSonioxCommittedAndPartial(committed: string, partial: string): string {
  return `${committed}${partial}`.replace(/\s+/g, ' ').trim();
}

/**
 * Applies one Soniox token frame: append final deltas, soft-split growing text, and
 * flush on endpoint. Does not emit a final for every incremental final-token batch.
 * @param input - Tokens plus prior utterance state and languages.
 * @returns Updated state and ordered hub events.
 */
export function applySonioxTokenFrame(input: {
  tokens: SonioxToken[];
  state: SonioxUtteranceState;
  sourceLanguage: string;
  targetLanguage?: string;
}): { state: SonioxUtteranceState; events: StreamingAsrEvent[] } {
  const frame = parseSonioxTokenFrame(input.tokens);
  const state: SonioxUtteranceState = { ...input.state };
  const events: StreamingAsrEvent[] = [];
  const kind: 'partial' | 'final' = frame.endpoint ? 'final' : 'partial';

  state.committedOriginal += frame.deltaFinalOriginal;
  state.committedTranslation += frame.deltaFinalTranslation;

  const emitChannel = (opts: {
    committedKey: 'committedOriginal' | 'committedTranslation';
    prefixKey: 'finalizedPrefixOriginal' | 'finalizedPrefixTranslation';
    partial: string;
    language: string;
    isTranslation: boolean;
  }) => {
    const text = joinSonioxCommittedAndPartial(state[opts.committedKey], opts.partial);
    if (!text && !frame.endpoint) return;

    const applied = applySonioxTranscript({
      kind,
      text,
      finalizedPrefix: state[opts.prefixKey],
      sourceLanguage: input.sourceLanguage,
    });
    state[opts.prefixKey] = applied.finalizedPrefix;
    for (const event of applied.events) {
      if (event.kind === 'partial' || event.kind === 'final') {
        events.push({
          ...event,
          language: opts.language,
          isTranslation: opts.isTranslation,
        });
      } else {
        events.push(event);
      }
    }
    if (frame.endpoint) {
      state[opts.committedKey] = '';
      state[opts.prefixKey] = '';
    }
  };

  emitChannel({
    committedKey: 'committedOriginal',
    prefixKey: 'finalizedPrefixOriginal',
    partial: frame.partialOriginal,
    language: input.sourceLanguage,
    isTranslation: false,
  });

  if (input.targetLanguage) {
    emitChannel({
      committedKey: 'committedTranslation',
      prefixKey: 'finalizedPrefixTranslation',
      partial: frame.partialTranslation,
      language: input.targetLanguage,
      isTranslation: true,
    });
  }

  return { state, events };
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
  let utterance = createSonioxUtteranceState();

  const emit = (event: StreamingAsrEvent) => {
    if (closed) return;
    options.onEvent(event);
  };

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
        // Semantic endpointing: flush soft-split remainders on natural pauses (`<end>`).
        // Without this, short trailing phrases can linger as partials mid-sermon.
        enable_endpoint_detection: true,
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
    if (closed) return;
    try {
      const msg = JSON.parse(String(data)) as {
        tokens?: SonioxToken[];
        finished?: boolean;
        error_code?: number;
        error_message?: string;
      };
      if (msg.error_message) {
        emit({ kind: 'error', message: msg.error_message });
        return;
      }
      if (!Array.isArray(msg.tokens) || msg.tokens.length === 0) {
        return;
      }

      const applied = applySonioxTokenFrame({
        tokens: msg.tokens,
        state: utterance,
        sourceLanguage: options.sourceLanguage,
        targetLanguage: options.targetLanguage,
      });
      utterance = applied.state;
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
      message: err instanceof Error ? err.message : 'Soniox WebSocket error',
    });
  });

  return {
    writePcm(pcm: Buffer) {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      try {
        sendWsBinary(ws, pcm);
      } catch (error) {
        emit({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Soniox send failed',
        });
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      // Flush any soft-split remainder so a short trailing phrase is not dropped
      // when the last listener leaves mid-utterance.
      const flushRemaining = (committed: string, prefix: string, isTranslation: boolean) => {
        const text = committed.trim();
        if (!text) return;
        const applied = applySonioxTranscript({
          kind: 'final',
          text,
          finalizedPrefix: prefix,
          sourceLanguage: options.sourceLanguage,
        });
        for (const event of applied.events) {
          if (event.kind === 'partial' || event.kind === 'final') {
            options.onEvent({
              ...event,
              language: isTranslation ? options.targetLanguage : options.sourceLanguage,
              isTranslation,
            });
          }
        }
      };
      flushRemaining(utterance.committedOriginal, utterance.finalizedPrefixOriginal, false);
      if (options.targetLanguage) {
        flushRemaining(utterance.committedTranslation, utterance.finalizedPrefixTranslation, true);
      }
      utterance = createSonioxUtteranceState();
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
