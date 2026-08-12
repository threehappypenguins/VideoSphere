// =============================================================================
// Streaming ASR shared types
// =============================================================================

/**
 * Events emitted by a streaming ASR session toward the session hub.
 */
export type StreamingAsrEvent =
  | {
      kind: 'partial';
      text: string;
      language?: string;
      /** True when the text is a translation (Soniox). */
      isTranslation?: boolean;
    }
  | {
      kind: 'final';
      text: string;
      language?: string;
      isTranslation?: boolean;
    }
  | {
      /**
       * Non-speech audio event reported by providers that classify it.
       * Corroborates local music detection; only Speechmatics emits this today.
       */
      kind: 'audio_event';
      /** Event class. Only music affects caption suppression. */
      event: 'music';
      /** True when the event started, false when it ended. */
      active: boolean;
      /** Provider confidence in `[0, 1]`, when supplied. */
      confidence?: number;
    }
  | { kind: 'error'; message: string };

/**
 * Callback invoked for each ASR event.
 * @param event - Partial, final, or error event.
 */
export type StreamingAsrEventHandler = (event: StreamingAsrEvent) => void;

/**
 * Long-lived upstream speech recognition session.
 */
export interface StreamingAsrSession {
  /**
   * Forwards PCM16 LE mono audio to the provider.
   * @param pcm - Raw PCM buffer.
   * @param sampleRate - Sample rate in Hz (typically 16000).
   */
  writePcm(pcm: Buffer, sampleRate: number): void;
  /**
   * Closes the upstream connection and releases timers.
   * @returns Resolves when closed.
   */
  close(): Promise<void>;
}

/**
 * Options shared by all streaming ASR adapters.
 */
export interface StreamingAsrCreateOptions {
  /** Provider API key. */
  apiKey: string;
  /** Spoken source language (ISO / BCP-47). */
  sourceLanguage: string;
  /**
   * Target language for combined STT+MT providers (Soniox).
   * Omit for STT-only streams.
   */
  targetLanguage?: string;
  /** Event sink. */
  onEvent: StreamingAsrEventHandler;
}

/**
 * Maps VideoSphere language codes to Deepgram language query values.
 * @param language - Channel language code.
 * @returns Deepgram language parameter.
 */
export function deepgramLanguageParam(language: string): string {
  const base = language.trim().toLowerCase().split('-')[0] || 'en';
  if (base === 'zh') return 'zh';
  if (base === 'yue') return 'zh-HK';
  return base;
}

/**
 * Maps VideoSphere language codes to AssemblyAI language codes.
 * @param language - Channel language code.
 * @returns AssemblyAI language_code.
 */
export function assemblyaiLanguageParam(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (normalized.startsWith('zh')) return 'zh';
  return normalized.split('-')[0] || 'en';
}

/**
 * Maps VideoSphere language codes to Gladia / Speechmatics / Soniox hints.
 * @param language - Channel language code.
 * @returns Short language code.
 */
export function shortLanguageCode(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (normalized.startsWith('zh')) return 'zh';
  return normalized.split('-')[0] || 'en';
}
