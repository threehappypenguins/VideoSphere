import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawnProcess = vi.hoisted(() => vi.fn());

vi.mock('@/lib/youtube-import/spawn-process', () => ({
  spawnProcess: (...args: unknown[]) => mockSpawnProcess(...args),
}));

import {
  buildFfprobeReadInterval,
  getDirectMediaUrl,
  isBrowserStreamableMp4Format,
  parseFfprobeKeyframeCsv,
  pickYtDlpProbeFormat,
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

  it('applies a pts offset for read-interval relative timestamps', () => {
    const stdout = ['1,0.000000', '1,2.000000'].join('\n');

    expect(parseFfprobeKeyframeCsv(stdout, 10)).toEqual([10, 12]);
  });

  it('returns an empty array when no keyframes are present', () => {
    expect(parseFfprobeKeyframeCsv('0,0.040000\n0,0.080000\n')).toEqual([]);
  });
});

describe('buildFfprobeReadInterval', () => {
  it('uses file percentage plus a duration window', () => {
    expect(buildFfprobeReadInterval(14, 8, 100)).toEqual({
      readInterval: '10%+8',
      intervalStartSeconds: 10,
    });
    expect(buildFfprobeReadInterval(4683, 8, 6666)).toEqual({
      readInterval: `${(4679 / 6666) * 100}%+8`,
      intervalStartSeconds: 4679,
    });
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
        stdout: '1,0.000000\n0,0.040000\n1,2.000000\n',
      })
    );

    const keyframes = await probeNearbyKeyframes('https://example.com/video.mp4', 14, 100, 8);

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

    await expect(probeNearbyKeyframes('https://example.com/video.mp4', 1, 100)).resolves.toEqual(
      []
    );
  });

  it('returns an empty array when ffprobe exits non-zero', async () => {
    mockSpawnProcess.mockImplementationOnce(() =>
      createMockChild({
        stderr: 'Invalid data found when processing input',
        code: 1,
      })
    );

    await expect(probeNearbyKeyframes('https://example.com/video.mp4', 5, 100)).resolves.toEqual(
      []
    );
  });

  it('returns an empty array when ffprobe exceeds the process timeout', async () => {
    setYouTubeImportProcessTimeoutMsForTests(50);

    mockSpawnProcess.mockImplementationOnce(() =>
      createMockChild({
        hangUntilKilled: true,
      })
    );

    await expect(probeNearbyKeyframes('https://example.com/video.mp4', 5, 100)).resolves.toEqual(
      []
    );
  });
});

describe('pickYtDlpProbeFormat', () => {
  it('prefers the lowest progressive mp4 within the preview cap over video-only streams', () => {
    const selected = pickYtDlpProbeFormat([
      {
        url: 'https://example.com/720.mp4',
        height: 720,
        vcodec: 'avc1',
        acodec: 'mp4a',
        ext: 'mp4',
        protocol: 'https',
      },
      {
        url: 'https://example.com/360.mp4',
        height: 360,
        vcodec: 'avc1',
        acodec: 'mp4a',
        ext: 'mp4',
        protocol: 'https',
      },
      {
        url: 'https://example.com/144.mp4',
        height: 144,
        vcodec: 'avc1',
        acodec: 'none',
        ext: 'mp4',
        protocol: 'https',
      },
    ]);

    expect(selected?.url).toBe('https://example.com/360.mp4');
  });

  it('excludes manifest and non-mp4 formats', () => {
    expect(
      pickYtDlpProbeFormat([
        {
          url: 'https://example.com/v.m3u8',
          height: 144,
          vcodec: 'avc1',
          ext: 'mp4',
          protocol: 'm3u8_native',
        },
        {
          url: 'https://example.com/v.webm',
          height: 144,
          vcodec: 'vp9',
          ext: 'webm',
          protocol: 'https',
        },
        {
          url: 'https://example.com/v.mp4',
          height: 360,
          vcodec: 'avc1',
          ext: 'mp4',
          protocol: 'https',
        },
      ])?.url
    ).toBe('https://example.com/v.mp4');
  });

  it('falls back to the lowest progressive mp4 when none are within the preview height cap', () => {
    const selected = pickYtDlpProbeFormat([
      {
        url: 'https://example.com/1080.mp4',
        height: 1080,
        vcodec: 'avc1',
        acodec: 'mp4a',
        ext: 'mp4',
        protocol: 'https',
      },
      {
        url: 'https://example.com/720.mp4',
        height: 720,
        vcodec: 'avc1',
        acodec: 'mp4a',
        ext: 'mp4',
        protocol: 'https',
      },
    ]);

    expect(selected?.url).toBe('https://example.com/720.mp4');
  });

  it('falls back to video-only mp4 when no progressive formats exist', () => {
    const selected = pickYtDlpProbeFormat([
      {
        url: 'https://example.com/360.mp4',
        height: 360,
        vcodec: 'avc1',
        acodec: 'none',
        ext: 'mp4',
        protocol: 'https',
      },
      {
        url: 'https://example.com/144.mp4',
        height: 144,
        vcodec: 'avc1',
        acodec: 'none',
        ext: 'mp4',
        protocol: 'https',
      },
    ]);

    expect(selected?.url).toBe('https://example.com/144.mp4');
  });
});

describe('isBrowserStreamableMp4Format', () => {
  it('rejects DASH and HLS manifests', () => {
    expect(
      isBrowserStreamableMp4Format({
        url: 'https://example.com/v.mpd',
        vcodec: 'avc1',
        ext: 'mp4',
        protocol: 'http_dash_segments',
      })
    ).toBe(false);
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
          duration: 212,
          formats: [
            {
              url: 'https://example.com/high.mp4',
              height: 1080,
              vcodec: 'avc1',
              acodec: 'mp4a',
              ext: 'mp4',
              protocol: 'https',
            },
            {
              url: 'https://example.com/low.mp4?expire=2000000000',
              height: 360,
              vcodec: 'avc1',
              acodec: 'mp4a',
              ext: 'mp4',
              protocol: 'https',
            },
          ],
        }),
      })
    );

    const result = await getDirectMediaUrl('dQw4w9WgXcQ');

    expect(result.url).toBe('https://example.com/low.mp4?expire=2000000000');
    expect(result.expiresAt).toBe(2_000_000_000_000);
    expect(result.durationSeconds).toBe(212);
    expect(mockSpawnProcess).toHaveBeenCalledWith(
      'yt-dlp',
      expect.arrayContaining([
        '-J',
        '--no-playlist',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      ]),
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const args = mockSpawnProcess.mock.calls[0]?.[1] as string[];
    expect(args).toContain('--js-runtimes');
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

  it('returns a friendly message when yt-dlp reports a private video', async () => {
    mockSpawnProcess.mockImplementationOnce(() =>
      createMockChild({
        stderr:
          "ERROR: [youtube] h3DhnqpppU8: Private video. Sign in if you've been granted access to this video.",
        code: 1,
      })
    );

    await expect(getDirectMediaUrl('dQw4w9WgXcQ')).rejects.toThrow(
      'This video is private. Make it public or unlisted on YouTube before importing.'
    );
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
