// =============================================================================
// Audio activity detection — public surface
// =============================================================================

export type {
  AudioActivityClassifier,
  AudioActivityFeatures,
  AudioActivityScores,
  AudioActivityState,
} from '@/lib/translation/audio-activity/types';

export {
  createAudioActivityDetector,
  DEFAULT_ENTER_MUSIC_MS,
  DEFAULT_EXIT_MUSIC_MS,
  DEFAULT_HOP_MS,
  DEFAULT_MIN_MUSIC_DWELL_MS,
  DEFAULT_MUSIC_THRESHOLD,
  DEFAULT_SPEECH_THRESHOLD,
  DEFAULT_WINDOW_MS,
  resolveAudioActivityDetectorOptions,
  type AudioActivityDetector,
  type AudioActivityDetectorOptions,
  type AudioActivityUpdate,
  type ResolvedAudioActivityDetectorOptions,
} from '@/lib/translation/audio-activity/detector';

export {
  ACTIVITY_SILENCE_PEAK,
  ACTIVITY_SILENCE_RMS,
  createHeuristicAudioActivityClassifier,
  musicScoreFromFeatures,
  type HeuristicClassifierOptions,
  type ProviderMusicHint,
} from '@/lib/translation/audio-activity/heuristic-classifier';

export {
  extractAudioActivityFeatures,
  pcm16ToFloat32,
  resampleMono,
} from '@/lib/translation/audio-activity/features';

export {
  audioActivityDetectorOptionsFromEnv,
  isMusicDetectionEnabled,
} from '@/lib/translation/audio-activity/config';
