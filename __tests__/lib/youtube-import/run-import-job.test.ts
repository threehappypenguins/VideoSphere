import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawnProcess = vi.hoisted(() => vi.fn());
const mockGetYoutubeImportJobById = vi.hoisted(() => vi.fn());
const mockUpdateYoutubeImportJobStatus = vi.hoisted(() => vi.fn());
const mockCreateUploadJob = vi.hoisted(() => vi.fn());
const mockUploadLocalFileToR2 = vi.hoisted(() => vi.fn());
const mockFinalizeUploadJobAndDistribute = vi.hoisted(() => vi.fn());
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
}));

vi.mock('@/lib/r2', () => ({
  uploadLocalFileToR2: (...args: unknown[]) => mockUploadLocalFileToR2(...args),
}));

vi.mock('@/lib/api/finalize-upload-job', () => ({
  finalizeUploadJobAndDistribute: (...args: unknown[]) =>
    mockFinalizeUploadJobAndDistribute(...args),
}));

vi.mock('@/lib/youtube-import/import-job-fs', () => ({
  mkdtemp: (...args: unknown[]) => mockMkdtemp(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

import {
  buildYoutubeImportUploadKey,
  computeTrimOffsets,
  parseYtDlpDownloadPercent,
  runYoutubeImportJob,
} from '@/lib/youtube-import/run-import-job';

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
  $createdAt: '2000-01-01T00:00:00.000Z',
  $updatedAt: '2000-01-01T00:00:00.000Z',
};

const WORK_DIR = '/tmp/yt-import/yt-import-job-abc';

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdtemp.mockResolvedValue(WORK_DIR);
  mockRm.mockResolvedValue(undefined);
  mockReadFile.mockResolvedValue(JSON.stringify({ section_start: 95 }));
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
  mockFinalizeUploadJobAndDistribute.mockResolvedValue({ distributing: true });

  mockSpawnProcess.mockImplementation((command: string) => {
    if (command === 'yt-dlp') {
      return createMockChild({
        stderr: '[download]  50.0% of ~10.00MiB at 1.00MiB/s ETA 00:05\n',
      });
    }
    if (command === 'ffprobe') {
      return createMockChild({ stdout: '120.5\n' });
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

describe('computeTrimOffsets', () => {
  it('computes relative trim points inside a section download', () => {
    expect(
      computeTrimOffsets({
        jobStartSeconds: 100,
        jobEndSeconds: 160,
        sectionStartSeconds: 95,
        downloadedDurationSeconds: 120,
      })
    ).toEqual({ relativeStart: 5, relativeEnd: 65 });
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
    expect(mockFinalizeUploadJobAndDistribute).toHaveBeenCalledWith('upload-job-1', 'user-123');
    expect(mockUpdateYoutubeImportJobStatus).toHaveBeenCalledWith('yt-import-1', {
      status: 'completed',
      progressPercent: 100,
      errorMessage: null,
    });
    expect(mockRm).toHaveBeenCalledWith(WORK_DIR, { recursive: true, force: true });
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
      errorMessage: expect.stringContaining('yt-dlp section download failed'),
    });
    expect(mockUploadLocalFileToR2).not.toHaveBeenCalled();
    expect(mockRm).toHaveBeenCalledWith(WORK_DIR, { recursive: true, force: true });
  });

  it('honors cancellation between phases before trim starts', async () => {
    mockGetYoutubeImportJobById
      .mockResolvedValueOnce(baseJob)
      .mockResolvedValueOnce(baseJob)
      .mockResolvedValueOnce({ ...baseJob, status: 'cancelled' });

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
});
