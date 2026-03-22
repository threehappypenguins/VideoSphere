import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildVimeoCategorySuggestBatchBody,
  waitUntilVimeoUploadAndTranscodeComplete,
} from '@/lib/platforms/vimeo';

describe('buildVimeoCategorySuggestBatchBody', () => {
  it('parses /categories/{slug} into Vimeo batch format', () => {
    expect(buildVimeoCategorySuggestBatchBody('/categories/animation')).toEqual([
      { category: 'animation' },
    ]);
  });

  it('parses plain slug', () => {
    expect(buildVimeoCategorySuggestBatchBody('music')).toEqual([{ category: 'music' }]);
  });

  it('parses subcategory path as two batch entries', () => {
    expect(buildVimeoCategorySuggestBatchBody('/categories/animation/subcategories/2d')).toEqual([
      { category: 'animation' },
      { category: '2d' },
    ]);
  });

  it('parses https://vimeo.com/categories/...', () => {
    expect(buildVimeoCategorySuggestBatchBody('https://vimeo.com/categories/documentary')).toEqual([
      { category: 'documentary' },
    ]);
  });

  it('returns null for unrecognizable strings', () => {
    expect(buildVimeoCategorySuggestBatchBody('')).toBeNull();
    expect(buildVimeoCategorySuggestBatchBody('   ')).toBeNull();
    expect(buildVimeoCategorySuggestBatchBody('/foo/bar')).toBeNull();
  });
});

describe('waitUntilVimeoUploadAndTranscodeComplete', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('resolves when upload and transcode are complete', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ upload: { status: 'complete' }, transcode: { status: 'complete' } }),
        { status: 200 }
      )
    );

    await expect(
      waitUntilVimeoUploadAndTranscodeComplete('videos/1', 'tok', {
        deadlineMs: 5_000,
        pollIntervalMs: 10,
      })
    ).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries after non-2xx status probe then completes', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ upload: { status: 'complete' }, transcode: { status: 'complete' } }),
          { status: 200 }
        )
      );

    const p = waitUntilVimeoUploadAndTranscodeComplete('videos/1', 'tok', {
      deadlineMs: 120_000,
      pollIntervalMs: 10,
    });
    const settled = expect(p).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
    await settled;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects when upload.status is error', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ upload: { status: 'error' }, reason: 'x' }), { status: 200 })
    );

    await expect(
      waitUntilVimeoUploadAndTranscodeComplete('videos/1', 'tok', {
        deadlineMs: 5_000,
        pollIntervalMs: 10,
      })
    ).rejects.toThrow(/upload\.status error/i);
  });

  it('rejects when transcode.status is error', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          upload: { status: 'complete' },
          transcode: { status: 'error' },
        }),
        { status: 200 }
      )
    );

    await expect(
      waitUntilVimeoUploadAndTranscodeComplete('videos/1', 'tok', {
        deadlineMs: 5_000,
        pollIntervalMs: 10,
      })
    ).rejects.toThrow(/transcode\.status error/i);
  });

  it('rejects on timeout when ingest never finishes', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            upload: { status: 'in_progress' },
            transcode: { status: 'in_progress' },
          }),
          { status: 200 }
        )
      )
    );

    const p = waitUntilVimeoUploadAndTranscodeComplete('videos/1', 'tok', {
      deadlineMs: 80,
      pollIntervalMs: 10,
    });
    const settled = expect(p).rejects.toThrow(/Timed out waiting for Vimeo upload and transcode/);
    await vi.runAllTimersAsync();
    await settled;
  });
});
