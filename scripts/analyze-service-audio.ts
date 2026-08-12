// =============================================================================
// Calibrates speech/music detection against a real service recording
// =============================================================================
// Usage:
//   pnpm translation:analyze-audio <recording> [--verbose] [--csv out.csv]
//
// Accepts anything ffmpeg can decode (the OBS recording of a service is ideal).
// Prints every state transition with a timestamp so you can compare the detected
// timeline against what actually happened, then tune the TRANSLATION_MUSIC_*
// environment variables until the transitions line up.
//
// Settings come from the same .env files the app reads, so what you calibrate here is
// what runs live. A one-off override can still be passed inline:
//   TRANSLATION_MUSIC_THRESHOLD=0.6 pnpm translation:analyze-audio service.mkv
// =============================================================================

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { config as loadEnvFiles } from 'dotenv';
import {
  audioActivityDetectorOptionsFromEnv,
  createAudioActivityDetector,
  resolveAudioActivityDetectorOptions,
  type AudioActivityScores,
} from '@/lib/translation/audio-activity';

// Next.js loads these automatically for the app, but a plain tsx script gets none of
// them — without this the script would silently ignore every TRANSLATION_MUSIC_* value
// in .env.local and calibrate the compiled-in defaults instead. Order mirrors Next.js
// precedence, and variables already set in the shell still win.
loadEnvFiles({
  path: ['.env.development.local', '.env.local', '.env.development', '.env'].filter((file) =>
    existsSync(file)
  ),
  quiet: true,
});

/** Music episodes shorter than this are almost certainly false positives. */
const SUSPECT_EPISODE_MS = 15000;

/** Sample rate the pipeline ingests at. */
const SAMPLE_RATE = 16000;
/** Frame size fed to the detector, matching the live RTMP puller. */
const FRAME_MS = 250;
/** Bytes per frame of PCM16 mono. */
const FRAME_BYTES = (SAMPLE_RATE * 2 * FRAME_MS) / 1000;

/**
 * Formats an elapsed audio offset as `h:mm:ss.s`.
 * @param ms - Offset in milliseconds.
 * @returns Human-readable timestamp.
 */
function formatOffset(ms: number): string {
  const totalSeconds = ms / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = seconds.toFixed(1).padStart(4, '0');
  return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`;
}

/**
 * Renders one window's features as a compact single line.
 * @param scores - Classifier output for the window.
 * @returns Formatted feature summary.
 */
function formatScores(scores: AudioActivityScores): string {
  const f = scores.features;
  return [
    `music=${scores.music.toFixed(2)}`,
    `syll=${f.syllableRatio.toFixed(2)}`,
    `sustain=${f.pitchSustainRatio.toFixed(2)}`,
    `voiced=${f.voicedRatio.toFixed(2)}`,
    `lowE=${f.lowEnergyRatio.toFixed(2)}`,
    `cents=${f.semitoneDeviationCents.toFixed(1)}`,
    `rms=${f.rms.toFixed(3)}`,
  ].join('  ');
}

/**
 * Decodes a media file to 16 kHz mono PCM16 on stdout.
 * @param input - Path to any ffmpeg-readable media file.
 * @returns Spawned ffmpeg process.
 */
function spawnDecoder(input: string) {
  return spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      input,
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(SAMPLE_RATE),
      '-f',
      's16le',
      '-acodec',
      'pcm_s16le',
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  );
}

/**
 * Replays a recording through the detector and reports the activity timeline.
 * @returns Resolves when the whole recording has been analysed.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const input = args.find((arg) => !arg.startsWith('--'));
  const verbose = args.includes('--verbose');
  const csvIndex = args.indexOf('--csv');
  const csvPath = csvIndex >= 0 ? args[csvIndex + 1] : undefined;

  if (!input) {
    console.error('Usage: pnpm translation:analyze-audio <recording> [--verbose] [--csv out.csv]');
    process.exitCode = 1;
    return;
  }

  try {
    await access(input);
  } catch {
    console.error(`Cannot read ${input}`);
    process.exitCode = 1;
    return;
  }

  const overrides = audioActivityDetectorOptionsFromEnv();
  const detector = createAudioActivityDetector(overrides);
  const csv = csvPath ? createWriteStream(csvPath) : null;
  csv?.write(
    'offset_ms,state,music,syllable_ratio,pitch_sustain,voiced_ratio,low_energy,semitone_cents,rms\n'
  );

  // Print what is actually in effect, not just the overrides: an empty override list
  // reads as "my .env edits were ignored", which is exactly the confusion to avoid.
  console.log(`Classifier: ${detector.classifierId}`);
  console.log('In effect:');
  for (const [key, value] of Object.entries(resolveAudioActivityDetectorOptions(overrides))) {
    const source = key in overrides ? 'env' : 'default';
    console.log(`  ${key.padEnd(16)} ${String(value).padEnd(8)} (${source})`);
  }
  console.log('');

  const decoder = spawnDecoder(input);
  let pending = Buffer.alloc(0);
  let offsetMs = 0;
  const durationByState = new Map<string, number>();
  const musicEpisodes: Array<{ startMs: number; endMs: number }> = [];
  let transitions = 0;

  for await (const chunk of decoder.stdout) {
    pending = Buffer.concat([pending, chunk as Buffer]);
    while (pending.length >= FRAME_BYTES) {
      const frame = pending.subarray(0, FRAME_BYTES);
      pending = pending.subarray(FRAME_BYTES);

      const before = detector.state;
      const update = detector.push(frame, SAMPLE_RATE);
      durationByState.set(before, (durationByState.get(before) ?? 0) + FRAME_MS);

      if (update.changed) {
        transitions += 1;
        if (update.state === 'music') {
          musicEpisodes.push({ startMs: offsetMs, endMs: offsetMs });
        } else if (before === 'music' && musicEpisodes.length > 0) {
          musicEpisodes[musicEpisodes.length - 1]!.endMs = offsetMs;
        }
        const detail = update.scores ? `  (${formatScores(update.scores)})` : '';
        console.log(`${formatOffset(offsetMs)}  ${before} -> ${update.state}${detail}`);
      } else if (verbose && update.scores) {
        console.log(
          `${formatOffset(offsetMs)}  ${update.state.padEnd(7)} ${formatScores(update.scores)}`
        );
      }

      if (csv && update.scores) {
        const f = update.scores.features;
        csv.write(
          [
            offsetMs,
            update.state,
            update.scores.music.toFixed(4),
            f.syllableRatio.toFixed(4),
            f.pitchSustainRatio.toFixed(4),
            f.voicedRatio.toFixed(4),
            f.lowEnergyRatio.toFixed(4),
            f.semitoneDeviationCents.toFixed(2),
            f.rms.toFixed(5),
          ].join(',') + '\n'
        );
      }

      offsetMs += FRAME_MS;
    }
  }

  const exitCode = await new Promise<number>((resolve) => {
    decoder.on('close', (code) => resolve(code ?? 0));
  });
  csv?.end();

  console.log('');
  console.log(`Analysed ${formatOffset(offsetMs)} of audio with ${transitions} transitions.`);
  for (const [state, ms] of durationByState) {
    const share = offsetMs > 0 ? ((ms / offsetMs) * 100).toFixed(1) : '0.0';
    console.log(`  ${state.padEnd(7)} ${formatOffset(ms)}  (${share}%)`);
  }

  if (musicEpisodes.length > 0) {
    const lastEpisode = musicEpisodes[musicEpisodes.length - 1]!;
    if (lastEpisode.endMs === lastEpisode.startMs) lastEpisode.endMs = offsetMs;

    // Real songs run for minutes. Anything only a few seconds long is the detector
    // entering music and immediately wanting back out, which is the signature of a
    // false positive rather than a short song.
    const suspect = musicEpisodes.filter((e) => e.endMs - e.startMs < SUSPECT_EPISODE_MS);
    console.log('');
    console.log(`Music episodes: ${musicEpisodes.length} (${suspect.length} under 15s)`);
    for (const episode of musicEpisodes) {
      const lengthMs = episode.endMs - episode.startMs;
      const flag = lengthMs < SUSPECT_EPISODE_MS ? '  <- suspect' : '';
      console.log(
        `  ${formatOffset(episode.startMs)} .. ${formatOffset(episode.endMs)}  ` +
          `${(lengthMs / 1000).toFixed(1)}s${flag}`
      );
    }
  }

  if (csvPath) console.log(`Per-window features written to ${csvPath}`);

  if (exitCode !== 0) process.exitCode = exitCode;
}

void main();
