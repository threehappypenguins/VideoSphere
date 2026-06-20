import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPartByteRange,
  MULTIPART_PART_BACKOFF_BASE_MS,
  MULTIPART_PART_MAX_ATTEMPTS,
  normalizePartEtag,
  uploadPartWithRetry,
} from '@/lib/uploads/browser-multipart-upload';

describe('browser-multipart-upload helpers', () => {
  describe('getPartByteRange', () => {
    it('returns fixed-size ranges for interior parts', () => {
      expect(getPartByteRange(1, 10, 25)).toEqual({ start: 0, end: 10 });
      expect(getPartByteRange(2, 10, 25)).toEqual({ start: 10, end: 20 });
    });

    it('clips the last part to the file size remainder', () => {
      expect(getPartByteRange(3, 10, 25)).toEqual({ start: 20, end: 25 });
    });
  });

  describe('normalizePartEtag', () => {
    it('strips surrounding quotes', () => {
      expect(normalizePartEtag('"abc123"')).toBe('abc123');
    });

    it('returns unquoted values unchanged', () => {
      expect(normalizePartEtag('abc123')).toBe('abc123');
    });

    it('returns null for missing values', () => {
      expect(normalizePartEtag(null)).toBeNull();
      expect(normalizePartEtag('   ')).toBeNull();
    });
  });

  describe('uploadPartWithRetry', () => {
    const sleepFn = vi.fn(async () => undefined);

    beforeEach(() => {
      sleepFn.mockClear();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('succeeds on the third attempt without restarting earlier logic', async () => {
      let attempts = 0;

      const xhrFactory = vi.fn(() => {
        attempts += 1;
        return {
          upload: { addEventListener: vi.fn() },
          addEventListener: vi.fn((type: string, cb: () => void) => {
            queueMicrotask(() => {
              if (type === 'load') {
                if (attempts < 3) {
                  Object.defineProperty(xhrFactory.mock.results[attempts - 1]?.value, 'status', {
                    value: 500,
                  });
                } else {
                  Object.defineProperty(xhrFactory.mock.results[attempts - 1]?.value, 'status', {
                    value: 200,
                  });
                }
                cb();
              }
            });
          }),
          open: vi.fn(),
          setRequestHeader: vi.fn(),
          send: vi.fn(),
          getResponseHeader: vi.fn(() => '"etag-3"'),
          status: 500,
        } as unknown as XMLHttpRequest;
      });

      const eTag = await uploadPartWithRetry({
        url: 'https://r2.example/part-1',
        blob: new Blob(['abc']),
        contentType: 'video/mp4',
        onProgress: vi.fn(),
        isCancelled: () => false,
        xhrFactory,
        sleepFn,
      });

      expect(eTag).toBe('etag-3');
      expect(xhrFactory).toHaveBeenCalledTimes(3);
      expect(sleepFn).toHaveBeenCalledTimes(2);
      expect(sleepFn).toHaveBeenNthCalledWith(1, MULTIPART_PART_BACKOFF_BASE_MS);
      expect(sleepFn).toHaveBeenNthCalledWith(2, MULTIPART_PART_BACKOFF_BASE_MS * 2);
    });

    it('returns null after exhausting all retry attempts', async () => {
      const xhrFactory = vi.fn(
        () =>
          ({
            upload: { addEventListener: vi.fn() },
            addEventListener: vi.fn((type: string, cb: () => void) => {
              queueMicrotask(() => {
                if (type === 'error') cb();
              });
            }),
            open: vi.fn(),
            setRequestHeader: vi.fn(),
            send: vi.fn(),
            getResponseHeader: vi.fn(() => null),
            status: 0,
          }) as unknown as XMLHttpRequest
      );

      const eTag = await uploadPartWithRetry({
        url: 'https://r2.example/part-1',
        blob: new Blob(['abc']),
        contentType: 'video/mp4',
        onProgress: vi.fn(),
        isCancelled: () => false,
        xhrFactory,
        sleepFn,
      });

      expect(eTag).toBeNull();
      expect(xhrFactory).toHaveBeenCalledTimes(MULTIPART_PART_MAX_ATTEMPTS);
      expect(sleepFn).toHaveBeenCalledTimes(MULTIPART_PART_MAX_ATTEMPTS - 1);
    });
  });
});
