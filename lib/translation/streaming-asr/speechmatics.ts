// =============================================================================
// Speechmatics Realtime WebSocket adapter
// =============================================================================

import WebSocket from 'ws';
import {
  shortLanguageCode,
  type StreamingAsrCreateOptions,
  type StreamingAsrEvent,
  type StreamingAsrSession,
} from '@/lib/translation/streaming-asr/types';
import {
  shouldFinalizeCompleteSentence,
  takeUtteranceChunk,
} from '@/lib/translation/streaming-asr/utterance-split';
import { sendWsBinary, sendWsText } from '@/lib/translation/streaming-asr/ws-send';

/** One Speechmatics recognition result (word / punctuation / entity). */
export type SpeechmaticsResult = {
  alternatives?: Array<{ content?: string }>;
  type?: string;
};

/**
 * Builds display text from a Speechmatics transcript message.
 * Prefers `metadata.transcript` (already spaced); falls back to joining `results`.
 * @param metadataTranscript - Prefabricated transcript from the message metadata.
 * @param results - Per-token recognition results.
 * @returns Trimmed transcript text, or empty when nothing usable is present.
 */
export function buildSpeechmaticsTranscriptText(
  metadataTranscript: string | undefined,
  results: SpeechmaticsResult[] | undefined
): string {
  const fromMeta = metadataTranscript?.trim();
  if (fromMeta) return fromMeta;
  if (!results?.length) return '';
  const parts: string[] = [];
  for (const result of results) {
    const content = result.alternatives?.[0]?.content;
    if (!content) continue;
    if (result.type === 'punctuation' && parts.length > 0) {
      parts[parts.length - 1] = `${parts[parts.length - 1]!}${content}`;
    } else {
      parts.push(content);
    }
  }
  return parts.join(' ').trim();
}

/**
 * Appends a finalized Speechmatics segment onto the committed utterance buffer.
 * @param committed - Text already locked from prior `AddTranscript` messages.
 * @param segment - Latest final segment (often a word or short phrase).
 * @returns Updated committed transcript.
 */
export function appendSpeechmaticsFinalSegment(committed: string, segment: string): string {
  const a = committed.trim();
  const b = segment.trim();
  if (!a) return b;
  if (!b) return a;
  if (/^[.,!?;:]/.test(b)) return `${a}${b}`;
  return `${a} ${b}`;
}

/**
 * Soft-splits oversized committed text into caption finals, leaving a remainder.
 * @param committed - Accumulated final transcript awaiting a pause / sentence end.
 * @param sourceLanguage - Language metadata for hub events.
 * @returns Events to emit and the leftover committed buffer.
 */
export function softSplitSpeechmaticsCommitted(
  committed: string,
  sourceLanguage: string
): { events: StreamingAsrEvent[]; committed: string } {
  let rest = committed.trim();
  const events: StreamingAsrEvent[] = [];
  for (;;) {
    const split = takeUtteranceChunk(rest);
    if (!split) break;
    events.push({ kind: 'final', text: split.chunk, language: sourceLanguage });
    rest = split.rest;
  }
  return { events, committed: rest };
}

/**
 * Opens a Speechmatics realtime recognition session.
 *
 * Speechmatics streams many small `AddTranscript` finals (often a word or two).
 * Those are accumulated and soft-split into caption-sized units so we do not emit
 * one hub caption per vendor word.
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
  /** Locked text from `AddTranscript` segments not yet emitted as caption finals. */
  let committed = '';
  /** Latest partial hypothesis (replaces prior partial; does not append). */
  let partial = '';

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
            // Slightly higher delay → fewer tiny finals; still interactive for live listen.
            max_delay: 2.0,
          },
          // Corroborates local speech/music detection. Speechmatics documents realtime
          // music events as over-sensitive, so the hub treats these as a vote only.
          audio_events_config: { types: ['music'] },
        })
      );
      resolve();
    });
    ws.once('error', (err) => reject(err));
  });

  const emit = (event: StreamingAsrEvent) => {
    options.onEvent(event);
  };

  const emitPartialDisplay = () => {
    const display = [committed, partial]
      .filter((s) => s.trim())
      .join(' ')
      .trim();
    if (display) {
      emit({ kind: 'partial', text: display, language: options.sourceLanguage });
    }
  };

  const flushCommitted = () => {
    const split = softSplitSpeechmaticsCommitted(committed, options.sourceLanguage);
    for (const event of split.events) emit(event);
    committed = split.committed;
    if (committed.trim()) {
      emit({ kind: 'final', text: committed.trim(), language: options.sourceLanguage });
      committed = '';
    }
  };

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(String(data)) as {
        message?: string;
        metadata?: { transcript?: string };
        results?: SpeechmaticsResult[];
        event?: { type?: string; confidence?: number };
      };
      if (msg.message === 'Error') {
        emit({ kind: 'error', message: 'Speechmatics recognition error' });
        return;
      }
      if (msg.message === 'AudioEventStarted' || msg.message === 'AudioEventEnded') {
        if (msg.event?.type === 'music') {
          emit({
            kind: 'audio_event',
            event: 'music',
            active: msg.message === 'AudioEventStarted',
            confidence: typeof msg.event.confidence === 'number' ? msg.event.confidence : undefined,
          });
        }
        return;
      }

      if (msg.message === 'EndOfTranscript') {
        partial = '';
        flushCommitted();
        return;
      }

      const text = buildSpeechmaticsTranscriptText(msg.metadata?.transcript, msg.results);
      if (!text) return;

      if (msg.message === 'AddTranscript') {
        partial = '';
        committed = appendSpeechmaticsFinalSegment(committed, text);
        const split = softSplitSpeechmaticsCommitted(committed, options.sourceLanguage);
        for (const event of split.events) emit(event);
        committed = split.committed;
        if (committed && shouldFinalizeCompleteSentence(committed)) {
          emit({ kind: 'final', text: committed.trim(), language: options.sourceLanguage });
          committed = '';
        } else if (committed) {
          emitPartialDisplay();
        }
        return;
      }

      if (msg.message === 'AddPartialTranscript') {
        // Partials replace the in-flight hypothesis; finals already live in `committed`.
        partial = text;
        emitPartialDisplay();
      }
    } catch {
      // ignore
    }
  });

  ws.on('error', (err) => {
    emit({
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
        emit({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Speechmatics send failed',
        });
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      partial = '';
      flushCommitted();
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
