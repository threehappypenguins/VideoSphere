// =============================================================================
// Streaming ASR factory
// =============================================================================

import type { LiveTranslationStreamingSttProvider } from '@/lib/translation/capabilities';
import { createAssemblyaiAsrSession } from '@/lib/translation/streaming-asr/assemblyai';
import { createDeepgramAsrSession } from '@/lib/translation/streaming-asr/deepgram';
import { createElevenLabsAsrSession } from '@/lib/translation/streaming-asr/elevenlabs';
import { createGladiaAsrSession } from '@/lib/translation/streaming-asr/gladia';
import { createModulateAsrSession } from '@/lib/translation/streaming-asr/modulate';
import { createSpeechmaticsAsrSession } from '@/lib/translation/streaming-asr/speechmatics';
import { createSonioxAsrSession } from '@/lib/translation/streaming-asr/soniox';
import type {
  StreamingAsrCreateOptions,
  StreamingAsrSession,
} from '@/lib/translation/streaming-asr/types';

/**
 * Creates a streaming ASR session for the given provider.
 * @param provider - Streaming STT provider id.
 * @param options - API key, languages, and event handler.
 * @returns Open session (async for providers that need HTTP handshake).
 */
export async function createStreamingAsrSession(
  provider: LiveTranslationStreamingSttProvider,
  options: StreamingAsrCreateOptions
): Promise<StreamingAsrSession> {
  switch (provider) {
    case 'deepgram':
      return createDeepgramAsrSession(options);
    case 'assemblyai':
      return createAssemblyaiAsrSession(options);
    case 'gladia':
      return createGladiaAsrSession(options);
    case 'speechmatics':
      return createSpeechmaticsAsrSession(options);
    case 'soniox':
      return createSonioxAsrSession(options);
    case 'modulate':
      return createModulateAsrSession(options);
    case 'elevenlabs':
      return createElevenLabsAsrSession(options);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported streaming STT provider: ${String(_exhaustive)}`);
    }
  }
}

export type { StreamingAsrEvent, StreamingAsrSession } from '@/lib/translation/streaming-asr/types';
