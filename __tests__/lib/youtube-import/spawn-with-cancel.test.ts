import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawnProcess = vi.hoisted(() => vi.fn());

vi.mock('@/lib/youtube-import/spawn-process', () => ({
  spawnProcess: (...args: unknown[]) => mockSpawnProcess(...args),
}));

import {
  runSpawnWithCancel,
  YoutubeImportJobCancelledError,
} from '@/lib/youtube-import/spawn-with-cancel';

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => {
    child.emit('close', null);
  });
  return child;
}

describe('runSpawnWithCancel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSpawnProcess.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('kills the child process when isCancelled returns true', async () => {
    let cancelled = false;
    const child = createMockChild();
    mockSpawnProcess.mockReturnValue(child);

    const runPromise = runSpawnWithCancel('ffmpeg', ['-version'], 'ffmpeg test', {
      isCancelled: async () => cancelled,
    });
    const expectation = expect(runPromise).rejects.toBeInstanceOf(YoutubeImportJobCancelledError);

    cancelled = true;
    await vi.advanceTimersByTimeAsync(1_100);

    await expectation;
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('resolves when the child exits zero and the job is not cancelled', async () => {
    const child = createMockChild();
    mockSpawnProcess.mockReturnValue(child);

    const runPromise = runSpawnWithCancel('ffmpeg', ['-version'], 'ffmpeg test');

    child.emit('close', 0);

    await expect(runPromise).resolves.toBeUndefined();
  });
});
