import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawnProcess = vi.hoisted(() => vi.fn());
const mockGetYoutubeImportJobById = vi.hoisted(() => vi.fn());
const mockUpdateYoutubeImportJobStatus = vi.hoisted(() => vi.fn());
const mockCreateUploadJob = vi.hoisted(() => vi.fn());
const mockUpdateUploadJobStatus = vi.hoisted(() => vi.fn());
const mockUploadLocalFileToR2 = vi.hoisted(() => vi.fn());
const mockDistributeStagedYoutubeImportUpload = vi.hoisted(() => vi.fn());
const mockMkdir = vi.hoisted(() => vi.fn());
const mockMkdtemp = vi.hoisted(() => vi.fn());
const mockRm = vi.hoisted(() => vi.fn());
const mockReadFile = vi.hoisted(() => vi.fn());
const mockStat = vi.hoisted(() => vi.fn());

vi.mock('@/lib/youtube-import/spawn-process', () => ({
  spawnProcess: (...args: unknown[]) => mockSpawnProcess(...args),
}));

vi.mock('@/lib/repositories/youtube-import-jobs', () => ({
  getYoutubeImportJobById: (...args: unknown[]) => mockGetYoutubeImportJobById(...args),
  updateYoutubeImportJobStatus: (...args: unknown[]) => mockUpdateYoutubeImportJobStatus(...args),
}));

vi.mock('@/lib/repositories/upload-jobs', () => ({
  createUploadJob: (...args: unknown[]) => mockCreateUploadJob(...args),
  updateUploadJobStatus: (...args: unknown[]) => mockUpdateUploadJobStatus(...args),
}));

vi.mock('@/lib/r2', () => ({
  uploadLocalFileToR2: (...args: unknown[]) => mockUploadLocalFileToR2(...args),
}));

vi.mock('@/lib/youtube-import/queue-import-distribute', () => ({
  distributeStagedYoutubeImportUpload: (...args: unknown[]) =>
    mockDistributeStagedYoutubeImportUpload(...args),
}));

const mockTrimWithSmartCut = vi.hoisted(() => vi.fn());

vi.mock('@/lib/youtube-import/smart-cut', () => ({
  trimWithSmartCut: (...args: unknown[]) => mockTrimWithSmartCut(...args),
}));

vi.mock('@/lib/youtube-import/import-job-fs', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  mkdtemp: (...args: unknown[]) => mockMkdtemp(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

import {
  buildYoutubeImportUploadKey,
  computeDownloadPhaseProgressPercent,
  computeTrimOffsets,
  parseFfmpegTimeSeconds,
  parseYtDlpDownloadPercent,
  parseYtDlpDownloadProgressLine,
  parseYtDlpDownloadSizeToBytes,
  runYoutubeImportJob,
  YtDlpMultiStreamDownloadProgressTracker,
} from '@/lib/youtube-import/run-import-job';
import {
  YT_DLP_IMPORT_CONCURRENT_FRAGMENTS,
  YT_DLP_IMPORT_DOWNLOAD_FORMAT,
  YT_DLP_IMPORT_HTTP_CHUNK_SIZE,
} from '@/lib/youtube-import/yt-dlp-args';

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
  onClose?: () => void;
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
    child.emit('close', options.code ?? 0);
    options.onClose?.();
  }, options.delayMs ?? 0);

  return child;
}

const baseJob = {
  id: 'yt-import-1',
  userId: 'user-123',
  draftId: 'draft-abc',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  youtubeVideoId: 'dQw4w9WgXcQ',
  livestreamId: null,
  startSeconds: 100,
  endSeconds: 160,
  status: 'pending' as const,
  progressPercent: 0,
  errorMessage: null,
  r2Key: null,
  uploadJobId: null,
  distributeQueued: false,
  smartCut: false,
  $createdAt: '2000-01-01T00:00:00.000Z',
  $updatedAt: '2000-01-01T00:00:00.000Z',
};

const FULL_SOURCE_DURATION_SECONDS = 3600;

const WORK_DIR = '/tmp/yt-import/yt-import-job-abc';

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  mockMkdtemp.mockResolvedValue(WORK_DIR);
  mockRm.mockResolvedValue(undefined);
  mockReadFile.mockResolvedValue(JSON.stringify({ duration: FULL_SOURCE_DURATION_SECONDS }));
  mockStat.mockResolvedValue({ size: 4096 });
  mockGetYoutubeImportJobById.mockResolvedValue(baseJob);
  mockUpdateYoutubeImportJobStatus.mockResolvedValue(undefined);
  mockUploadLocalFileToR2.mockResolvedValue(4096);
  mockCreateUploadJob.mockResolvedValue({
    id: 'upload-job-1',
    userId: 'user-123',
    draftId: 'draft-abc',
    r2Key: 'temp/uploads/user-123/x/youtube-import-dQw4w9WgXcQ.mp4',
    status: 'pending',
    errorMessage: null,
    $createdAt: '2000-01-01T00:00:00.000Z',
    $updatedAt: '2000-01-01T00:00:00.000Z',
  });
  mockUpdateUploadJobStatus.mockResolvedValue(undefined);
  mockDistributeStagedYoutubeImportUpload.mockResolvedValue({ distributing: false });
  mockTrimWithSmartCut.mockResolvedValue(`${WORK_DIR}/trimmed.mp4`);

  mockSpawnProcess.mockImplementation((command: string) => {
    if (command === 'yt-dlp') {
      return createMockChild({
        stderr: '[download]  50.0% of ~10.00MiB at 1.00MiB/s ETA 00:05\n',
      });
    }
    if (command === 'ffprobe') {
      return createMockChild({ stdout: `${FULL_SOURCE_DURATION_SECONDS}\n` });
    }
    if (command === 'ffmpeg') {
      return createMockChild({});
    }
    throw new Error(`Unexpected command: ${command}`);
  });
});

describe('parseYtDlpDownloadPercent', () => {
  it('parses yt-dlp download progress lines', () => {
    expect(parseYtDlpDownloadPercent('[download]  42.5% of file')).toBe(42.5);
    expect(parseYtDlpDownloadPercent('noise')).toBeNull();
  });
});

describe('parseYtDlpDownloadSizeToBytes', () => {
  it('converts binary and decimal size suffixes to bytes', () => {
    expect(parseYtDlpDownloadSizeToBytes('10', 'MiB')).toBe(10 * 1024 ** 2);
    expect(parseYtDlpDownloadSizeToBytes('1.5', 'GiB')).toBe(1.5 * 1024 ** 3);
    expect(parseYtDlpDownloadSizeToBytes('512', 'KiB')).toBe(512 * 1024);
  });
});

describe('parseYtDlpDownloadProgressLine', () => {
  it('parses percent and total size from yt-dlp download output', () => {
    expect(
      parseYtDlpDownloadProgressLine('[download]  50.0% of ~ 745.00MiB at 5.00MiB/s ETA 01:14')
    ).toEqual({
      percent: 50,
      totalBytes: 745 * 1024 ** 2,
    });
  });
});

describe('YtDlpMultiStreamDownloadProgressTracker', () => {
  it('weights video and audio downloads into one continuous percent', () => {
    const tracker = new YtDlpMultiStreamDownloadProgressTracker();

    expect(tracker.update('[download]  50.0% of ~ 700.00MiB at 5.00MiB/s ETA 01:10')).toBeCloseTo(
      50,
      1
    );
    expect(tracker.update('[download] 100.0% of  700.00MiB in 00:02:10 at 5.00MiB/s')).toBeCloseTo(
      100,
      1
    );
    expect(tracker.update('[download]  50.0% of ~  50.00MiB at 2.00MiB/s ETA 00:12')).toBeCloseTo(
      ((700 + 25) / 750) * 100,
      1
    );
    expect(tracker.update('[download] 100.0% of   50.00MiB in 00:00:20 at 2.00MiB/s')).toBeCloseTo(
      100,
      1
    );
  });

  it('does not reset when the next stream starts without size hints', () => {
    const tracker = new YtDlpMultiStreamDownloadProgressTracker();

    tracker.update('[download] 100.0% of  700.00MiB in 00:02:10 at 5.00MiB/s');
    const afterAudioStarts = tracker.update('[download]   1.0% of file at 1.00MiB/s ETA 00:05');

    expect(afterAudioStarts).toBeGreaterThan(45);
    expect(afterAudioStarts).toBeLessThan(55);
  });
});

describe('parseFfmpegTimeSeconds', () => {
  it('parses the latest non-negative ffmpeg time value', () => {
    expect(parseFfmpegTimeSeconds('size=0kB time=-00:00:02.96 bitrate=N/A')).toBeNull();
    expect(parseFfmpegTimeSeconds('size=512kB time=00:00:15.52 bitrate=11891.1kbits/s')).toBe(
      15.52
    );
    expect(
      parseFfmpegTimeSeconds(
        'size=512kB time=00:00:10.00 bitrate=N/A\rsize=1024kB time=00:00:20.00 bitrate=N/A'
      )
    ).toBe(20);
  });
});

describe('computeDownloadPhaseProgressPercent', () => {
  it('prefers yt-dlp percent over ffmpeg time', () => {
    expect(
      computeDownloadPhaseProgressPercent({
        downloadPercent: 50,
        ffmpegTimeSeconds: 10,
        sourceDurationSeconds: 60,
      })
    ).toBe(35);
  });

  it('maps ffmpeg time into the download phase when yt-dlp percent is absent', () => {
    expect(
      computeDownloadPhaseProgressPercent({
        downloadPercent: null,
        ffmpegTimeSeconds: 30,
        sourceDurationSeconds: 60,
      })
    ).toBe(35);
  });
});

describe('computeTrimOffsets', () => {
  it('computes absolute trim points inside a full source download', () => {
    expect(
      computeTrimOffsets({
        jobStartSeconds: 100,
        jobEndSeconds: 160,
        downloadedDurationSeconds: 3600,
      })
    ).toEqual({ relativeStart: 100, relativeEnd: 160 });
  });
});

describe('buildYoutubeImportUploadKey', () => {
  it('scopes keys under temp/uploads/{userId}', () => {
    const key = buildYoutubeImportUploadKey('user-123', 'dQw4w9WgXcQ');
    expect(key).toMatch(/^temp\/uploads\/user-123\/\d+-[^/]+\/youtube-import-dQw4w9WgXcQ\.mp4$/);
  });
});

describe('runYoutubeImportJob', () => {
  it('runs download, trim, upload, and handoff with status transitions', async () => {
    await runYoutubeImportJob('yt-import-1');

    const ytDlpArgs = mockSpawnProcess.mock.calls.find(([command]) => command === 'yt-dlp')?.[1];
    expect(ytDlpArgs).toEqual(expect.arrayContaining(['-f', YT_DLP_IMPORT_DOWNLOAD_FORMAT]));
    expect(ytDlpArgs).toEqual(
      expect.arrayContaining([
        '--http-chunk-size',
        YT_DLP_IMPORT_HTTP_CHUNK_SIZE,
        '--concurrent-fragments',
        String(YT_DLP_IMPORT_CONCURRENT_FRAGMENTS),
      ])
    );
    expect(ytDlpArgs).not.toEqual(expect.arrayContaining(['--download-sections']));
    expect(ytDlpArgs).not.toEqual(expect.arrayContaining(['--force-keyframes-at-cuts']));

    const ffmpegArgs = mockSpawnProcess.mock.calls.find(([command]) => command === 'ffmpeg')?.[1];
    expect(ffmpegArgs).toEqual(expect.arrayContaining(['-ss', '100', '-t', '60']));

    expect(mockUpdateYoutubeImportJobStatus).toHaveBeenCalledWith('yt-import-1', {
      status: 'downloading',
      progressPercent: 0,
    });
    expect(mockUpdateYoutubeImportJobStatus).toHaveBeenCalledWith('yt-import-1', {
      progressPercent: 35,
    });
    expect(mockUpdateYoutubeImportJobStatus).toHaveBeenCalledWith('yt-import-1', {
      status: 'trimming',
      progressPercent: 70,
    });
    expect(mockUpdateYoutubeImportJobStatus).toHaveBeenCalledWith('yt-import-1', {
      status: 'uploading',
      progressPercent: 85,
    });
    expect(mockUploadLocalFileToR2).toHaveBeenCalledWith(
      `${WORK_DIR}/trimmed.mp4`,
      expect.stringMatching(/^temp\/uploads\/user-123\//),
      'video/mp4'
    );
    expect(mockCreateUploadJob).toHaveBeenCalledWith({
      userId: 'user-123',
      draftId: 'draft-abc',
      r2Key: expect.stringMatching(/^temp\/uploads\/user-123\//),
    });
    expect(mockUpdateUploadJobStatus).toHaveBeenCalledWith('upload-job-1', 'uploading');
    expect(mockDistributeStagedYoutubeImportUpload).not.toHaveBeenCalled();
    expect(mockUpdateYoutubeImportJobStatus).toHaveBeenCalledWith('yt-import-1', {
      status: 'completed',
      progressPercent: 100,
      errorMessage: null,
    });
    expect(mockRm).toHaveBeenCalledWith(WORK_DIR, { recursive: true, force: true });
  });

  it('uses smart cut trimming when the job requests it', async () => {
    mockGetYoutubeImportJobById.mockResolvedValue({ ...baseJob, smartCut: true });

    await runYoutubeImportJob('yt-import-1');

    expect(mockTrimWithSmartCut).toHaveBeenCalledWith(
      expect.objectContaining({
        inputPath: `${WORK_DIR}/download.mp4`,
        outputPath: `${WORK_DIR}/trimmed.mp4`,
        relativeStart: 100,
        relativeEnd: 160,
        durationSeconds: FULL_SOURCE_DURATION_SECONDS,
        isCancelled: expect.any(Function),
      })
    );
    const ffmpegCalls = mockSpawnProcess.mock.calls.filter(([command]) => command === 'ffmpeg');
    expect(ffmpegCalls).toHaveLength(0);
  });

  it('distributes immediately when distributeQueued was set before staging finished', async () => {
    mockGetYoutubeImportJobById.mockResolvedValue({ ...baseJob, distributeQueued: true });

    await runYoutubeImportJob('yt-import-1');

    expect(mockDistributeStagedYoutubeImportUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'yt-import-1',
        distributeQueued: true,
        uploadJobId: 'upload-job-1',
      }),
      'user-123'
    );
    expect(mockUpdateUploadJobStatus).not.toHaveBeenCalled();
  });

  it('marks the job failed and still cleans up temp files on errors', async () => {
    mockSpawnProcess.mockImplementationOnce((command: string) => {
      if (command === 'yt-dlp') {
        return createMockChild({ stderr: 'boom', code: 1 });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await runYoutubeImportJob('yt-import-1');

    expect(mockUpdateYoutubeImportJobStatus).toHaveBeenCalledWith('yt-import-1', {
      status: 'failed',
      errorMessage: expect.stringContaining('yt-dlp source download failed'),
    });
    expect(mockUploadLocalFileToR2).not.toHaveBeenCalled();
    expect(mockRm).toHaveBeenCalledWith(WORK_DIR, { recursive: true, force: true });
  });

  it('honors cancellation between phases before trim starts', async () => {
    let ytDlpDone = false;
    let ffprobeDone = false;

    mockSpawnProcess.mockImplementation((command: string) => {
      if (command === 'yt-dlp') {
        return createMockChild({
          stderr: '[download]  50.0% of ~10.00MiB at 1.00MiB/s ETA 00:05\n',
          onClose: () => {
            ytDlpDone = true;
          },
        });
      }
      if (command === 'ffprobe') {
        return createMockChild({
          stdout: `${FULL_SOURCE_DURATION_SECONDS}\n`,
          onClose: () => {
            ffprobeDone = true;
          },
        });
      }
      if (command === 'ffmpeg') {
        return createMockChild({});
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    mockGetYoutubeImportJobById.mockImplementation(async () => {
      if (ytDlpDone && ffprobeDone) {
        return { ...baseJob, status: 'cancelled' };
      }
      return { ...baseJob, status: 'downloading' };
    });

    await runYoutubeImportJob('yt-import-1');

    expect(mockSpawnProcess).toHaveBeenCalledTimes(2);
    expect(mockSpawnProcess.mock.calls[0]?.[0]).toBe('yt-dlp');
    expect(mockSpawnProcess.mock.calls[1]?.[0]).toBe('ffprobe');
    expect(mockUpdateYoutubeImportJobStatus).not.toHaveBeenCalledWith('yt-import-1', {
      status: 'trimming',
      progressPercent: 70,
    });
    expect(mockUploadLocalFileToR2).not.toHaveBeenCalled();
    expect(mockRm).toHaveBeenCalledWith(WORK_DIR, { recursive: true, force: true });
  });

  it('kills yt-dlp when cancelled during download and does not mark the job failed', async () => {
    vi.useFakeTimers();

    let ytDlpChild: MockChild | null = null;
    let getCount = 0;
    mockGetYoutubeImportJobById.mockImplementation(async () => {
      getCount += 1;
      if (getCount < 5) {
        return baseJob;
      }
      return { ...baseJob, status: 'cancelled' };
    });

    mockSpawnProcess.mockImplementation((command: string) => {
      if (command === 'yt-dlp') {
        const child = new EventEmitter() as MockChild;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = vi.fn(() => {
          child.emit('close', null);
        });
        ytDlpChild = child;
        return child;
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const runPromise = runYoutubeImportJob('yt-import-1');
    await vi.advanceTimersByTimeAsync(2_600);
    await runPromise;

    expect(ytDlpChild?.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mockUpdateYoutubeImportJobStatus).not.toHaveBeenCalledWith('yt-import-1', {
      status: 'failed',
      errorMessage: expect.any(String),
    });
    expect(mockUploadLocalFileToR2).not.toHaveBeenCalled();
    expect(mockRm).toHaveBeenCalledWith(WORK_DIR, { recursive: true, force: true });

    vi.useRealTimers();
  });
});
