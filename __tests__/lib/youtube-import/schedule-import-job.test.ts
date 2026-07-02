import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecuteYoutubeImportJobWorker, mockAfter } = vi.hoisted(() => {
  const execute = vi.fn();
  const after = vi.fn((callback: () => void | Promise<void>) => {
    void callback();
  });
  return { mockExecuteYoutubeImportJobWorker: execute, mockAfter: after };
});

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: mockAfter };
});

vi.mock('@/lib/youtube-import/execute-import-job', () => ({
  executeYoutubeImportJobWorker: (...args: unknown[]) => mockExecuteYoutubeImportJobWorker(...args),
}));

import { scheduleYoutubeImportJob } from '@/lib/youtube-import/schedule-import-job';

beforeEach(() => {
  vi.clearAllMocks();
  mockExecuteYoutubeImportJobWorker.mockResolvedValue({ outcome: 'ran' });
});

describe('scheduleYoutubeImportJob', () => {
  it('runs the worker via after()', async () => {
    scheduleYoutubeImportJob('import-job-1', 'user-123');

    expect(mockAfter).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(mockExecuteYoutubeImportJobWorker).toHaveBeenCalledWith('import-job-1', 'user-123');
  });
});
