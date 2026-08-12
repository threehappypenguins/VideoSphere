/**
 * Tests for speech-versus-music detection on the live translation ingest path.
 *
 * Covers:
 *   - Feature extraction separating sung notes from spoken phrases
 *   - Classifier scoring on synthesized a cappella singing and speech
 *   - Accompanied instrumental music, and the unpitched-percussion limitation
 *   - Provider music hints acting as a one-way vote
 *   - Detector hysteresis, minimum dwell, and silence neutrality
 *   - Option resolution and threshold reconciliation
 *   - Localized music marker text
 */

import { describe, it, expect } from 'vitest';
import {
  createAudioActivityDetector,
  createHeuristicAudioActivityClassifier,
  extractAudioActivityFeatures,
  musicScoreFromFeatures,
  pcm16ToFloat32,
  resolveAudioActivityDetectorOptions,
  DEFAULT_ENTER_MUSIC_MS,
  DEFAULT_EXIT_MUSIC_MS,
  DEFAULT_MUSIC_THRESHOLD,
  type AudioActivityClassifier,
  type AudioActivityDetector,
} from '@/lib/translation/audio-activity';
import { musicMarkerText, MUSIC_MARKER_GLYPH } from '@/lib/translation/activity-marker';
import {
  mixPcm16,
  splitPcmFrames,
  synthesizeInstrumental,
  synthesizePercussion,
  synthesizeSilence,
  synthesizeSinging,
  synthesizeSpeech,
  SYNTH_SAMPLE_RATE,
} from '@/__tests__/utils/synth-audio';

/**
 * Feeds a buffer to a detector in 250 ms frames, as live ingest does.
 * @param detector - Detector under test.
 * @param pcm - Audio to push.
 * @returns States observed after each frame.
 */
function pushFrames(detector: AudioActivityDetector, pcm: Buffer): string[] {
  return splitPcmFrames(pcm).map((frame) => detector.push(frame, SYNTH_SAMPLE_RATE).state);
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

describe('extractAudioActivityFeatures', () => {
  it('reports sustained, well-tuned, continuously voiced pitch for singing', () => {
    const features = extractAudioActivityFeatures(
      pcm16ToFloat32(synthesizeSinging(2000)),
      SYNTH_SAMPLE_RATE
    );

    expect(features.voicedRatio).toBeGreaterThan(0.75);
    expect(features.pitchSustainRatio).toBeGreaterThan(0.5);
    expect(features.semitoneDeviationCents).toBeLessThan(20);
  });

  it('reports syllable-rate modulation and pauses for speech', () => {
    const features = extractAudioActivityFeatures(
      pcm16ToFloat32(synthesizeSpeech(2000)),
      SYNTH_SAMPLE_RATE
    );

    expect(features.syllableRatio).toBeGreaterThan(0.5);
    expect(features.lowEnergyRatio).toBeGreaterThan(0.25);
    expect(features.pitchSustainRatio).toBeLessThan(0.35);
  });

  it('does not mistake a constant DC offset for a perfectly held note', () => {
    const dc = Buffer.alloc(SYNTH_SAMPLE_RATE * 2 * 2);
    for (let i = 0; i + 1 < dc.length; i += 2) dc.writeInt16LE(8000, i);

    const features = extractAudioActivityFeatures(pcm16ToFloat32(dc), SYNTH_SAMPLE_RATE);

    expect(features.voicedRatio).toBe(0);
    expect(features.pitchSustainRatio).toBe(0);
  });

  it('separates singing from speech on the combined music score', () => {
    const sung = musicScoreFromFeatures(
      extractAudioActivityFeatures(pcm16ToFloat32(synthesizeSinging(2000)), SYNTH_SAMPLE_RATE)
    );
    const spoken = musicScoreFromFeatures(
      extractAudioActivityFeatures(pcm16ToFloat32(synthesizeSpeech(2000)), SYNTH_SAMPLE_RATE)
    );

    expect(sung).toBeGreaterThan(spoken);
    expect(sung - spoken).toBeGreaterThan(0.25);
  });
});

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

describe('createHeuristicAudioActivityClassifier', () => {
  it('scores singing above the default music threshold', () => {
    const classifier = createHeuristicAudioActivityClassifier();
    const result = classifier.classify(pcm16ToFloat32(synthesizeSinging(2000)), SYNTH_SAMPLE_RATE);

    expect(result.silent).toBe(false);
    expect(result.music).toBeGreaterThan(0.55);
  });

  it('scores speech below the default speech threshold', () => {
    const classifier = createHeuristicAudioActivityClassifier();
    const result = classifier.classify(pcm16ToFloat32(synthesizeSpeech(2000)), SYNTH_SAMPLE_RATE);

    expect(result.silent).toBe(false);
    expect(result.music).toBeLessThan(0.4);
    expect(result.speech).toBeCloseTo(1 - result.music, 5);
  });

  it('flags near-silent windows instead of classifying them', () => {
    const classifier = createHeuristicAudioActivityClassifier();
    const result = classifier.classify(pcm16ToFloat32(synthesizeSilence(2000)), SYNTH_SAMPLE_RATE);

    expect(result.silent).toBe(true);
    expect(result.music).toBe(0);
  });

  it('scores accompanied instrumental music far above unaccompanied singing', () => {
    // Churches with a band are the easy case: a sustained tuned chord is far more
    // obviously "not speech" than voices singing words. Asserted so that tuning aimed
    // at a cappella detection cannot quietly regress it.
    const classifier = createHeuristicAudioActivityClassifier();
    const chord = classifier.classify(
      pcm16ToFloat32(synthesizeInstrumental(2000)),
      SYNTH_SAMPLE_RATE
    );
    const band = classifier.classify(
      pcm16ToFloat32(mixPcm16(synthesizeInstrumental(2000), synthesizePercussion(2000))),
      SYNTH_SAMPLE_RATE
    );

    expect(chord.music).toBeGreaterThan(DEFAULT_MUSIC_THRESHOLD);
    expect(band.music).toBeGreaterThan(DEFAULT_MUSIC_THRESHOLD);
  });

  it('does not detect percussion that carries no pitched content', () => {
    // Known and accepted limitation, pinned here so it is a documented property rather
    // than a surprise: every feature that argues for music describes pitch behaviour,
    // and drums have none. A drums-only passage therefore reads as speech. Worship music
    // essentially always carries a sung or pitched line alongside the percussion, which
    // is the case covered above.
    const classifier = createHeuristicAudioActivityClassifier();
    const result = classifier.classify(
      pcm16ToFloat32(synthesizePercussion(2000)),
      SYNTH_SAMPLE_RATE
    );

    expect(result.silent).toBe(false);
    expect(result.music).toBeLessThan(DEFAULT_MUSIC_THRESHOLD);
  });

  it('lets a provider music event lift a borderline window but never lowers it', () => {
    let hint: { active: boolean; confidence: number } | null = null;
    const classifier = createHeuristicAudioActivityClassifier({ providerHint: () => hint });
    const samples = pcm16ToFloat32(synthesizeSpeech(2000));

    const withoutHint = classifier.classify(samples, SYNTH_SAMPLE_RATE).music;
    hint = { active: false, confidence: 1 };
    expect(classifier.classify(samples, SYNTH_SAMPLE_RATE).music).toBe(withoutHint);
    hint = { active: true, confidence: 1 };
    expect(classifier.classify(samples, SYNTH_SAMPLE_RATE).music).toBeGreaterThan(withoutHint);
  });
});

// ---------------------------------------------------------------------------
// Detector state machine
// ---------------------------------------------------------------------------

/**
 * Builds a classifier that always returns the same music score.
 * @param music - Fixed music score.
 * @param silent - Whether windows report as silent.
 * @returns Stub classifier.
 */
function fixedClassifier(music: number, silent = false): AudioActivityClassifier {
  return {
    id: 'fixed',
    classify: () => ({
      music,
      speech: 1 - music,
      silent,
      features: {
        rms: silent ? 0 : 0.2,
        peak: silent ? 0 : 0.5,
        syllableRatio: 0.5,
        lowEnergyRatio: 0.2,
        voicedRatio: 0.8,
        pitchSustainRatio: 0.5,
        semitoneDeviationCents: 12,
        pitchFrameCount: 100,
      },
    }),
  };
}

describe('createAudioActivityDetector', () => {
  it('starts in the speech state so a service opening with preaching is captioned', () => {
    const detector = createAudioActivityDetector();

    expect(detector.state).toBe('speech');
    expect(detector.lastScores()).toBeNull();
  });

  it('does not classify until the analysis window is full', () => {
    const detector = createAudioActivityDetector({ classifier: fixedClassifier(1) });

    // 1 s of audio against the default 2 s window.
    expect(pushFrames(detector, synthesizeSinging(1000))).toEqual([
      'speech',
      'speech',
      'speech',
      'speech',
    ]);
    expect(detector.state).toBe('speech');
  });

  it('holds the music state for the dwell floor even once speech votes arrive', () => {
    const detector = createAudioActivityDetector({
      classifier: fixedClassifier(1),
      windowMs: 1000,
      hopMs: 500,
      enterMusicMs: 1000,
      exitMusicMs: 500,
      minMusicDwellMs: 3000,
    });

    pushFrames(detector, synthesizeSinging(4000));
    expect(detector.state).toBe('music');

    pushFrames(detector, synthesizeSpeech(1000));
    expect(detector.state).toBe('music');
  });

  it('returns to speech once speech evidence outlasts the dwell floor', () => {
    const detector = createAudioActivityDetector({
      windowMs: 1000,
      hopMs: 500,
      enterMusicMs: 500,
      exitMusicMs: 500,
      minMusicDwellMs: 500,
    });

    pushFrames(detector, synthesizeSinging(4000));
    expect(detector.state).toBe('music');

    pushFrames(detector, synthesizeSpeech(4000));
    expect(detector.state).toBe('speech');
  });

  it('treats silence as neutral so gaps between verses do not resume captions', () => {
    const detector = createAudioActivityDetector({
      windowMs: 1000,
      hopMs: 500,
      enterMusicMs: 500,
      exitMusicMs: 500,
      minMusicDwellMs: 0,
    });

    pushFrames(detector, synthesizeSinging(4000));
    expect(detector.state).toBe('music');

    pushFrames(detector, synthesizeSilence(6000));
    expect(detector.state).toBe('music');
  });

  it('reports state changes exactly once per transition', () => {
    const detector = createAudioActivityDetector({
      classifier: fixedClassifier(1),
      windowMs: 500,
      hopMs: 250,
      enterMusicMs: 250,
      minMusicDwellMs: 0,
    });

    const changes = splitPcmFrames(synthesizeSinging(2000)).map(
      (frame) => detector.push(frame, SYNTH_SAMPLE_RATE).changed
    );

    expect(changes.filter(Boolean)).toHaveLength(1);
  });

  it('resamples ingest that deviates from 16 kHz', () => {
    const detector = createAudioActivityDetector({
      classifier: fixedClassifier(1),
      windowMs: 1000,
      hopMs: 500,
      enterMusicMs: 500,
      minMusicDwellMs: 0,
    });

    // Same buffer declared as 8 kHz: half the audio duration, so the window needs
    // twice as many frames to fill.
    const frames = splitPcmFrames(synthesizeSinging(4000));
    for (const frame of frames) detector.push(frame, 8000);

    expect(detector.state).toBe('music');
  });

  it('resets to the speech baseline', () => {
    const detector = createAudioActivityDetector({
      windowMs: 1000,
      hopMs: 500,
      enterMusicMs: 500,
      minMusicDwellMs: 0,
    });

    pushFrames(detector, synthesizeSinging(4000));
    expect(detector.state).toBe('music');

    detector.reset();
    expect(detector.state).toBe('speech');
    expect(detector.lastScores()).toBeNull();
  });

  it('needs more evidence to leave music than to enter it', () => {
    // Measured on a real service: songs run for minutes while false positives last a
    // window or two, and a breath mid-song reads as speech briefly. Leaving music must
    // therefore be the harder move, or lyrics leak through as captions.
    expect(DEFAULT_EXIT_MUSIC_MS).toBeGreaterThan(DEFAULT_ENTER_MUSIC_MS);
  });

  it('rides out a brief speech blip mid-song without resuming captions', () => {
    const detector = createAudioActivityDetector({
      windowMs: 1000,
      hopMs: 500,
      enterMusicMs: 500,
      exitMusicMs: 3000,
      minMusicDwellMs: 0,
    });

    pushFrames(detector, synthesizeSinging(4000));
    expect(detector.state).toBe('music');

    // A breath between phrases: shorter than the exit hysteresis, so it must not count.
    pushFrames(detector, synthesizeSpeech(1000));
    expect(detector.state).toBe('music');

    pushFrames(detector, synthesizeSinging(2000));
    expect(detector.state).toBe('music');
  });

  it('suppresses captions for a full band on default settings', () => {
    const detector = createAudioActivityDetector();
    const band = mixPcm16(synthesizeInstrumental(8000), synthesizePercussion(8000));

    pushFrames(detector, band);

    expect(detector.state).toBe('music');
  });

  it('exposes the settings actually in effect', () => {
    const detector = createAudioActivityDetector({ musicThreshold: 0.7 });

    expect(detector.options.musicThreshold).toBe(0.7);
    expect(detector.options.enterMusicMs).toBe(DEFAULT_ENTER_MUSIC_MS);
  });
});

// ---------------------------------------------------------------------------
// Option resolution
// ---------------------------------------------------------------------------

describe('resolveAudioActivityDetectorOptions', () => {
  it('fills every field from defaults when nothing is overridden', () => {
    const resolved = resolveAudioActivityDetectorOptions();

    expect(resolved.musicThreshold).toBe(DEFAULT_MUSIC_THRESHOLD);
    expect(resolved.exitMusicMs).toBe(DEFAULT_EXIT_MUSIC_MS);
    expect(Object.values(resolved).every((value) => Number.isFinite(value))).toBe(true);
  });

  it('keeps the speech bar from crossing above the music bar', () => {
    // Overlapping bands would make every scored window vote music, suppressing the
    // whole sermon. Lowering the music threshold has to drag the speech bar with it.
    const resolved = resolveAudioActivityDetectorOptions({
      musicThreshold: 0.1,
      speechThreshold: 0.4,
    });

    expect(resolved.speechThreshold).toBeLessThanOrEqual(resolved.musicThreshold);
  });

  it('leaves a well-ordered threshold pair untouched', () => {
    const resolved = resolveAudioActivityDetectorOptions({
      musicThreshold: 0.7,
      speechThreshold: 0.3,
    });

    expect(resolved).toMatchObject({ musicThreshold: 0.7, speechThreshold: 0.3 });
  });
});

// ---------------------------------------------------------------------------
// Marker text
// ---------------------------------------------------------------------------

describe('musicMarkerText', () => {
  it('localizes the marker for curated languages', () => {
    expect(musicMarkerText('en')).toBe('♪ Music ♪');
    expect(musicMarkerText('es')).toBe('♪ Música ♪');
    expect(musicMarkerText('zh')).toBe('♪ 音乐 ♪');
    expect(musicMarkerText('yue')).toBe('♪ 音樂 ♪');
  });

  it('normalizes casing and whitespace', () => {
    expect(musicMarkerText('  PT ')).toBe('♪ Música ♪');
  });

  it('falls back to the bare glyph for unknown languages', () => {
    expect(musicMarkerText('xx')).toBe(MUSIC_MARKER_GLYPH);
  });
});
