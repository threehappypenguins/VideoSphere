import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawnProcess = vi.hoisted(() => vi.fn());

vi.mock('@/lib/youtube-import/spawn-process', () => ({
  spawnProcess: (...args: unknown[]) => mockSpawnProcess(...args),
}));

import {
  getDirectMediaUrl,
  parseFfprobeKeyframeCsv,
  probeNearbyKeyframes,
  setYouTubeImportProcessTimeoutMsForTests,
} from '@/lib/youtube-import/probe-keyframes';

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function createMockChild(options: {
  stdout?: string;
  stderr?: string;
  code?: number;
  delayMs?: number;
  hangUntilKilled?: boolean;
}): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => {
    child.emit('close', options.code ?? null);
  });

  setTimeout(() => {
    if (options.stdout) {
      child.stdout.emit('data', Buffer.from(options.stdout));
    }
    if (options.stderr) {
      child.stderr.emit('data', Buffer.from(options.stderr));
    }
    if (!options.hangUntilKilled) {
      child.emit('close', options.code ?? 0);
    }
  }, options.delayMs ?? 0);

  return child;
}

describe('parseFfprobeKeyframeCsv', () => {
  it('parses keyframe rows from ffprobe csv output', () => {
    const stdout = ['1,0.000000', '0,0.040000', '1,2.000000', '0,2.040000'].join('\n');

    expect(parseFfprobeKeyframeCsv(stdout)).toEqual([0, 2]);
  });

  it('returns an empty array when no keyframes are present', () => {
    expect(parseFfprobeKeyframeCsv('0,0.040000\n0,0.080000\n')).toEqual([]);
  });
});

describe('probeNearbyKeyframes', () => {
  beforeEach(() => {
    mockSpawnProcess.mockReset();
    setYouTubeImportProcessTimeoutMsForTests(null);
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs ffprobe with a centered read interval and returns parsed keyframes', async () => {
    mockSpawnProcess.mockImplementationOnce(() =>
      createMockChild({
        stdout: '1,10.000000\n0,10.040000\n1,12.000000\n',
      })
    );

    const keyframes = await probeNearbyKeyframes('https://example.com/video.mp4', 14, 8);

    expect(keyframes).toEqual([10, 12]);
    expect(mockSpawnProcess).toHaveBeenCalledWith(
      'ffprobe',
      [
        '-read_intervals',
        '10%+8',
        '-select_streams',
        'v:0',
        '-show_entries',
        'frame=key_frame,pts_time',
        '-of',
        'csv=p=0',
        'https://example.com/video.mp4',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
  });

  it('returns an empty array when ffprobe finds no keyframes in the window', async () => {
    mockSpawnProcess.mockImplementationOnce(() =>
      createMockChild({
        stdout: '0,1.000000\n0,1.040000\n',
      })
    );

    await expect(probeNearbyKeyframes('https://example.com/video.mp4', 1)).resolves.toEqual([]);
  });

  it('rejects when ffprobe exits non-zero', async () => {
    mockSpawnProcess.mockImplementationOnce(() =>
      createMockChild({
        stderr: 'Invalid data found when processing input',
        code: 1,
      })
    );

    await expect(probeNearbyKeyframes('https://example.com/video.mp4', 5)).rejects.toThrow(
      /ffprobe keyframe probe failed/
    );
  });

  it('rejects when ffprobe exceeds the process timeout', async () => {
    setYouTubeImportProcessTimeoutMsForTests(50);

    mockSpawnProcess.mockImplementationOnce(() =>
      createMockChild({
        hangUntilKilled: true,
      })
    );

    await expect(probeNearbyKeyframes('https://example.com/video.mp4', 5)).rejects.toThrow(
      /timed out after 50ms/
    );
  });
});

describe('getDirectMediaUrl', () => {
  beforeEach(() => {
    mockSpawnProcess.mockReset();
    setYouTubeImportProcessTimeoutMsForTests(null);
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('selects a low-resolution progressive format from yt-dlp metadata', async () => {
    mockSpawnProcess.mockImplementationOnce(() =>
      createMockChild({
        stdout: JSON.stringify({
          formats: [
            {
              url: 'https://example.com/high.mp4',
              height: 1080,
              vcodec: 'avc1',
              acodec: 'mp4a',
            },
            {
              url: 'https://example.com/low.mp4?expire=2000000000',
              height: 360,
              vcodec: 'avc1',
              acodec: 'mp4a',
            },
          ],
        }),
      })
    );

    const result = await getDirectMediaUrl('dQw4w9WgXcQ');

    expect(result.url).toBe('https://example.com/low.mp4?expire=2000000000');
    expect(result.expiresAt).toBe(2_000_000_000_000);
    expect(mockSpawnProcess).toHaveBeenCalledWith(
      'yt-dlp',
      ['-J', '--no-playlist', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
  });

  it('rejects when yt-dlp exits non-zero', async () => {
    mockSpawnProcess.mockImplementationOnce(() =>
      createMockChild({
        stderr: 'Video unavailable',
        code: 1,
      })
    );

    await expect(getDirectMediaUrl('dQw4w9WgXcQ')).rejects.toThrow(/yt-dlp metadata lookup failed/);
  });

  it('rejects when yt-dlp exceeds the process timeout', async () => {
    setYouTubeImportProcessTimeoutMsForTests(50);

    mockSpawnProcess.mockImplementationOnce(() =>
      createMockChild({
        hangUntilKilled: true,
      })
    );

    await expect(getDirectMediaUrl('dQw4w9WgXcQ')).rejects.toThrow(/timed out after 50ms/);
  });
});
