// =============================================================================
// MediaMTX RTSP → PCM16 puller (OBS / RTMP ingest into session hub)
// =============================================================================
// One ffmpeg child per channel. STT billing still gated by session-hub listeners.
// =============================================================================

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { enqueueOwnerPcm, markIngestStopped } from '@/lib/translation/session-hub';
import {
  buildMediamtxRtspUrl,
  getMediamtxRtspBase,
  getRtmpHookSecret,
  streamKeyFromMtxPath,
} from '@/lib/translation/rtmp-config';

const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2;
/** Match browser streaming ingest frame size (~250 ms). */
const CHUNK_MS = 250;
const CHUNK_BYTES = (SAMPLE_RATE * BYTES_PER_SAMPLE * CHUNK_MS) / 1000;
/** Retry RTSP connect while OBS finishes publishing after auth. */
const CONNECT_RETRY_MS = 1_500;
const CONNECT_RETRY_MAX = 40;

type PullerState = {
  channelId: string;
  userId: string;
  mtxPath: string;
  child: ChildProcessWithoutNullStreams | null;
  stopping: boolean;
  generation: number;
};

const pullersByChannel = new Map<string, PullerState>();

/**
 * Constant-time compare for the optional publisher webhook secret.
 * @param provided - Header or body secret from the caller.
 * @returns True when configured secret matches.
 */
export function verifyRtmpHookSecret(provided: string | null | undefined): boolean {
  const expected = getRtmpHookSecret();
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Returns whether the app can pull RTSP from MediaMTX (env configured).
 * @returns True when TRANSLATION_MEDIAMTX_RTSP_BASE is set.
 */
export function isRtmpPcmPullConfigured(): boolean {
  return getMediamtxRtspBase() !== null;
}

/**
 * Starts (or restarts) an ffmpeg RTSP pull that feeds `enqueueOwnerPcm`.
 * No-op when RTSP base env is unset. Idempotent per channel.
 * @param params - Channel ownership and MediaMTX path.
 */
export function startRtmpPcmPuller(params: {
  channelId: string;
  userId: string;
  mtxPath: string;
}): void {
  if (!isRtmpPcmPullConfigured()) return;

  const mtxPath = params.mtxPath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!mtxPath || !streamKeyFromMtxPath(mtxPath)) return;

  const existing = pullersByChannel.get(params.channelId);
  if (existing && !existing.stopping && existing.mtxPath === mtxPath && existing.child) {
    return;
  }
  if (existing) {
    stopRtmpPcmPuller(params.channelId);
  }

  const state: PullerState = {
    channelId: params.channelId,
    userId: params.userId,
    mtxPath,
    child: null,
    stopping: false,
    generation: (existing?.generation ?? 0) + 1,
  };
  pullersByChannel.set(params.channelId, state);
  void runPullLoop(state);
}

/**
 * Stops the RTSP puller for a channel and marks ingest stopped.
 * @param channelId - Channel document id.
 */
export function stopRtmpPcmPuller(channelId: string): void {
  const state = pullersByChannel.get(channelId);
  if (!state) return;
  state.stopping = true;
  state.generation += 1;
  killChild(state.child);
  state.child = null;
  pullersByChannel.delete(channelId);
  markIngestStopped(channelId);
}

/**
 * Test helper — clears all pullers without calling markIngestStopped.
 */
export function __resetRtmpPcmPullersForTests(): void {
  for (const state of pullersByChannel.values()) {
    state.stopping = true;
    state.generation += 1;
    killChild(state.child);
  }
  pullersByChannel.clear();
}

/**
 * @param state - Puller state.
 * @returns Whether this generation is still the active puller.
 */
function isCurrent(state: PullerState): boolean {
  const current = pullersByChannel.get(state.channelId);
  return Boolean(current && current === state && !state.stopping);
}

/**
 * @param child - ffmpeg process or null.
 */
function killChild(child: ChildProcessWithoutNullStreams | null): void {
  if (!child || child.killed) return;
  try {
    child.kill('SIGTERM');
  } catch {
    // already exited
  }
}

/**
 * Retries ffmpeg until the RTSP path is readable or retries are exhausted.
 * @param state - Puller state.
 */
async function runPullLoop(state: PullerState): Promise<void> {
  const generation = state.generation;
  for (let attempt = 0; attempt < CONNECT_RETRY_MAX; attempt++) {
    if (!isCurrent(state) || state.generation !== generation) return;

    const rtspUrl = buildMediamtxRtspUrl(state.mtxPath);
    if (!rtspUrl) return;

    const exitedCleanly = await new Promise<boolean>((resolve) => {
      if (!isCurrent(state) || state.generation !== generation) {
        resolve(true);
        return;
      }

      const child = spawn(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-rtsp_transport',
          'tcp',
          '-i',
          rtspUrl,
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
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      state.child = child;

      let pending = Buffer.alloc(0);
      let gotData = false;

      child.stdout.on('data', (chunk: Buffer) => {
        if (!isCurrent(state) || state.generation !== generation) return;
        gotData = true;
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= CHUNK_BYTES) {
          const frame = pending.subarray(0, CHUNK_BYTES);
          pending = pending.subarray(CHUNK_BYTES);
          enqueueOwnerPcm(state.channelId, state.userId, Buffer.from(frame), SAMPLE_RATE);
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8').trim();
        if (text) {
          console.warn(`[rtmp-pcm-puller ${state.channelId}] ${text.slice(0, 400)}`);
        }
      });

      child.on('error', (error) => {
        console.error(`[rtmp-pcm-puller ${state.channelId}] spawn error`, error);
        resolve(false);
      });

      child.on('close', (code) => {
        state.child = null;
        // Exit before any audio usually means path not ready yet — retry.
        if (!gotData && code !== 0) {
          resolve(false);
          return;
        }
        resolve(true);
      });
    });

    if (!isCurrent(state) || state.generation !== generation) return;

    if (exitedCleanly) {
      // Publisher gone (or graceful stop) — end ingest for this channel.
      pullersByChannel.delete(state.channelId);
      markIngestStopped(state.channelId);
      return;
    }

    await sleep(CONNECT_RETRY_MS);
  }

  if (isCurrent(state) && state.generation === generation) {
    console.error(`[rtmp-pcm-puller ${state.channelId}] failed to connect after retries`);
    pullersByChannel.delete(state.channelId);
    markIngestStopped(state.channelId);
  }
}

/**
 * @param ms - Delay milliseconds.
 * @returns Promise that resolves after the delay.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
