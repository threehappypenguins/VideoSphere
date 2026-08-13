// =============================================================================
// Synthetic worship audio for speech/music detection tests
// =============================================================================
// Generates 16 kHz mono PCM16 that mimics the cases the live translation pipeline
// must distinguish: unaccompanied congregational singing (held notes on a semitone
// grid, near-continuous voicing) and preaching (syllable-rate modulation, continuously
// gliding pitch, pauses between phrases).
//
// Accompanied music is covered too, for deployments that do have instruments. It is
// the easier case — a sustained chord is far more obviously "not speech" than voices
// singing words — so it exists mainly to keep tuning for a cappella from regressing it.
//
// Synthetic audio only proves the features point the right way. Real thresholds
// come from `pnpm translation:analyze-audio` on a recording of an actual service.
// =============================================================================

/** Sample rate matching the live ingest contract. */
export const SYNTH_SAMPLE_RATE = 16000;

/**
 * Deterministic pseudo-random generator so synthesized audio is reproducible.
 * @param seed - Initial state.
 * @returns Function yielding values in `[-1, 1)`.
 */
function noiseSource(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return (state / 4294967296) * 2 - 1;
  };
}

/**
 * Adds a falling harmonic stack, approximating a voiced glottal source.
 * @param out - Destination samples.
 * @param start - First sample index to write.
 * @param length - Number of samples to write.
 * @param f0 - Fundamental frequency in Hz for a given offset within the segment.
 * @param amplitude - Peak amplitude for a given offset within the segment.
 * @param phaseStart - Starting phase in radians.
 * @returns Ending phase in radians.
 */
function addHarmonicStack(
  out: Float32Array,
  start: number,
  length: number,
  f0: (offset: number) => number,
  amplitude: (offset: number) => number,
  phaseStart: number
): number {
  let phase = phaseStart;
  for (let i = 0; i < length; i += 1) {
    const index = start + i;
    if (index >= out.length) break;
    phase += (2 * Math.PI * f0(i)) / SYNTH_SAMPLE_RATE;
    let value = 0;
    for (let h = 1; h <= 8; h += 1) {
      value += Math.sin(phase * h) / h;
    }
    out[index] += value * amplitude(i) * 0.35;
  }
  return phase;
}

/**
 * Converts float samples to PCM16 LE mono with a light noise floor.
 * @param samples - Samples in `[-1, 1]`.
 * @param noise - Noise generator.
 * @returns PCM16 LE mono buffer.
 */
function toPcm16(samples: Float32Array, noise: () => number): Buffer {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]! + noise() * 0.004));
    pcm.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  return pcm;
}

/**
 * Synthesizes unaccompanied singing: held notes on a semitone grid with vibrato.
 * @param durationMs - Total duration to generate.
 * @param seed - Noise seed.
 * @returns PCM16 LE mono buffer at {@link SYNTH_SAMPLE_RATE}.
 */
export function synthesizeSinging(durationMs: number, seed = 7): Buffer {
  const total = Math.round((SYNTH_SAMPLE_RATE * durationMs) / 1000);
  const samples = new Float32Array(total);
  // A hymn line in A minor at roughly 1.4 notes per second.
  const scale = [220, 246.94, 261.63, 293.66, 329.63, 293.66, 261.63, 246.94];
  const noteSamples = Math.round((SYNTH_SAMPLE_RATE * 700) / 1000);

  let phase = 0;
  let cursor = 0;
  let noteIndex = 0;
  while (cursor < total) {
    const base = scale[noteIndex % scale.length]!;
    const length = Math.min(noteSamples, total - cursor);
    // Choirs breathe between notes only briefly; voicing is near-continuous.
    const sustain = Math.round(length * 0.94);
    phase = addHarmonicStack(
      samples,
      cursor,
      sustain,
      (i) => base * (1 + 0.004 * Math.sin((2 * Math.PI * 5 * i) / SYNTH_SAMPLE_RATE)),
      (i) => {
        const attack = Math.min(1, i / (SYNTH_SAMPLE_RATE * 0.04));
        const release = Math.min(1, (sustain - i) / (SYNTH_SAMPLE_RATE * 0.04));
        return 0.7 * attack * Math.max(0, release);
      },
      phase
    );
    cursor += length;
    noteIndex += 1;
  }

  return toPcm16(samples, noiseSource(seed));
}

/**
 * Synthesizes preaching: syllables at ~4.5 Hz with gliding pitch and phrase pauses.
 * @param durationMs - Total duration to generate.
 * @param seed - Noise seed.
 * @returns PCM16 LE mono buffer at {@link SYNTH_SAMPLE_RATE}.
 */
export function synthesizeSpeech(durationMs: number, seed = 11): Buffer {
  const total = Math.round((SYNTH_SAMPLE_RATE * durationMs) / 1000);
  const samples = new Float32Array(total);
  const noise = noiseSource(seed);
  const syllableSamples = Math.round((SYNTH_SAMPLE_RATE * 220) / 1000);

  let phase = 0;
  let cursor = 0;
  let syllable = 0;
  while (cursor < total) {
    // Every fifth syllable becomes a pause (breath / sentence break).
    if (syllable % 5 === 4) {
      cursor += syllableSamples;
      syllable += 1;
      continue;
    }
    const voicedLength = Math.min(Math.round(syllableSamples * 0.62), total - cursor);
    // Declining intonation across the phrase, plus a glide within each syllable.
    const phraseStart = 150 - (syllable % 10) * 6;
    phase = addHarmonicStack(
      samples,
      cursor,
      voicedLength,
      (i) => phraseStart * (1 - 0.16 * (i / voicedLength)),
      (i) => {
        const attack = Math.min(1, i / (SYNTH_SAMPLE_RATE * 0.012));
        const release = Math.min(1, (voicedLength - i) / (SYNTH_SAMPLE_RATE * 0.03));
        return 0.62 * attack * Math.max(0, release);
      },
      phase
    );
    // Unvoiced consonant burst closing the syllable.
    const burstStart = cursor + voicedLength;
    const burstLength = Math.round(syllableSamples * 0.12);
    for (let i = 0; i < burstLength; i += 1) {
      const index = burstStart + i;
      if (index >= total) break;
      samples[index] += noise() * 0.22;
    }
    cursor += syllableSamples;
    syllable += 1;
  }

  return toPcm16(samples, noise);
}

/**
 * Synthesizes accompanied instrumental music: sustained, tuned chords.
 *
 * Approximates an organ, keyboard, or strummed guitar holding harmony — the profile of
 * pitched accompaniment, as opposed to the single unaccompanied voice line that
 * {@link synthesizeSinging} produces.
 * @param durationMs - Total duration to generate.
 * @param seed - Noise seed.
 * @returns PCM16 LE mono buffer at {@link SYNTH_SAMPLE_RATE}.
 */
export function synthesizeInstrumental(durationMs: number, seed = 23): Buffer {
  const total = Math.round((SYNTH_SAMPLE_RATE * durationMs) / 1000);
  const samples = new Float32Array(total);
  // i–vii–VI in A minor, two seconds per chord.
  const progression = [
    [220, 261.63, 329.63],
    [196, 246.94, 293.66],
    [174.61, 220, 261.63],
  ];
  const chordSamples = SYNTH_SAMPLE_RATE * 2;

  let cursor = 0;
  let chordIndex = 0;
  while (cursor < total) {
    const notes = progression[chordIndex % progression.length]!;
    const length = Math.min(chordSamples, total - cursor);
    for (const note of notes) {
      addHarmonicStack(
        samples,
        cursor,
        length,
        () => note,
        (i) => 0.28 * Math.min(1, i / (SYNTH_SAMPLE_RATE * 0.02)),
        0
      );
    }
    cursor += length;
    chordIndex += 1;
  }

  return toPcm16(samples, noiseSource(seed));
}

/**
 * Synthesizes unpitched percussion: decaying transients at 120 BPM.
 *
 * Exists to pin down a known limitation rather than a supported case. The classifier
 * reasons about pitch behaviour, and percussion has none, so a drums-only passage reads
 * as speech.
 * @param durationMs - Total duration to generate.
 * @param seed - Noise seed.
 * @returns PCM16 LE mono buffer at {@link SYNTH_SAMPLE_RATE}.
 */
export function synthesizePercussion(durationMs: number, seed = 29): Buffer {
  const total = Math.round((SYNTH_SAMPLE_RATE * durationMs) / 1000);
  const samples = new Float32Array(total);
  const noise = noiseSource(seed);
  const beatSamples = Math.round(SYNTH_SAMPLE_RATE * 0.5);
  const hitSamples = Math.round(SYNTH_SAMPLE_RATE * 0.2);

  for (let i = 0; i < total; i += 1) {
    const offset = i % beatSamples;
    if (offset >= hitSamples) continue;
    samples[i] += noise() * 0.5 * Math.exp(-offset / (SYNTH_SAMPLE_RATE * 0.05));
  }

  return toPcm16(samples, noise);
}

/**
 * Sums PCM16 buffers sample-wise, clipping at full scale.
 *
 * Used to layer percussion over pitched accompaniment into a full-band mix.
 * @param buffers - Equal-length PCM16 LE mono buffers.
 * @returns Mixed PCM16 LE mono buffer, truncated to the shortest input.
 */
export function mixPcm16(...buffers: Buffer[]): Buffer {
  const length = Math.min(...buffers.map((buffer) => buffer.length));
  const out = Buffer.alloc(length - (length % 2));
  for (let offset = 0; offset + 1 < out.length; offset += 2) {
    let sum = 0;
    for (const buffer of buffers) sum += buffer.readInt16LE(offset);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, sum)), offset);
  }
  return out;
}

/**
 * Synthesizes room silence (very low-level noise floor).
 * @param durationMs - Total duration to generate.
 * @returns PCM16 LE mono buffer at {@link SYNTH_SAMPLE_RATE}.
 */
export function synthesizeSilence(durationMs: number): Buffer {
  const total = Math.round((SYNTH_SAMPLE_RATE * durationMs) / 1000);
  const pcm = Buffer.alloc(total * 2);
  const noise = noiseSource(3);
  for (let i = 0; i < total; i += 1) {
    pcm.writeInt16LE(Math.round(noise() * 0.0008 * 32767), i * 2);
  }
  return pcm;
}

/**
 * Splits PCM into fixed-duration frames, as the live ingest paths do.
 * @param pcm - PCM16 LE mono buffer.
 * @param frameMs - Frame duration in milliseconds.
 * @returns Frame buffers in order, dropping any trailing partial frame.
 */
export function splitPcmFrames(pcm: Buffer, frameMs = 250): Buffer[] {
  const frameBytes = (SYNTH_SAMPLE_RATE * 2 * frameMs) / 1000;
  const frames: Buffer[] = [];
  for (let offset = 0; offset + frameBytes <= pcm.length; offset += frameBytes) {
    frames.push(pcm.subarray(offset, offset + frameBytes));
  }
  return frames;
}
