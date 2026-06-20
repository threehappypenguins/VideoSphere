/**
 * Tests for UploadVideoForm multipart browser upload flow.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadVideoForm from '@/components/UploadVideoForm';
import {
  MULTIPART_PART_BACKOFF_BASE_MS,
  MULTIPART_PART_MAX_ATTEMPTS,
} from '@/lib/uploads/browser-multipart-upload';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

type XhrListener = (...args: unknown[]) => void;

class MockXMLHttpRequest {
  static readonly instances: MockXMLHttpRequest[] = [];

  status = 200;
  responseHeaders: Record<string, string> = { ETag: '"part-etag"' };
  upload = {
    listeners: new Map<string, XhrListener[]>(),
    addEventListener(type: string, cb: XhrListener) {
      const bucket = this.listeners.get(type) ?? [];
      bucket.push(cb);
      this.listeners.set(type, bucket);
    },
  };

  private readonly listeners = new Map<string, XhrListener[]>();

  constructor() {
    MockXMLHttpRequest.instances.push(this);
  }

  open = vi.fn();
  setRequestHeader = vi.fn();
  abort = vi.fn(() => {
    this.dispatch('abort');
  });
  send = vi.fn();

  addEventListener(type: string, cb: XhrListener) {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(cb);
    this.listeners.set(type, bucket);
  }

  getResponseHeader(name: string) {
    return this.responseHeaders[name] ?? null;
  }

  dispatch(type: string, ...args: unknown[]) {
    for (const cb of this.listeners.get(type) ?? []) {
      cb(...args);
    }
  }

  simulateProgress(loaded: number, total: number) {
    for (const cb of this.upload.listeners.get('progress') ?? []) {
      cb({ lengthComputable: true, loaded, total });
    }
  }

  simulateSuccess(status = 200, eTag = '"part-etag"') {
    this.status = status;
    this.responseHeaders.ETag = eTag;
    this.dispatch('load');
  }

  simulateError() {
    this.dispatch('error');
  }
}

const UPLOAD_JOB_ID = 'job-multipart-123';
const UPLOAD_ID = 'multipart-upload-id-abc';
const R2_KEY = 'temp/uploads/user-123/clip.mp4';
const PART_SIZE = 10;

function makePresignResponse(partCount: number) {
  return {
    uploadId: UPLOAD_ID,
    key: R2_KEY,
    bucketName: 'videosphere-uploads',
    partSize: PART_SIZE,
    parts: Array.from({ length: partCount }, (_, index) => ({
      partNumber: index + 1,
      url: `https://r2.example/part-${index + 1}`,
    })),
    uploadJobId: UPLOAD_JOB_ID,
  };
}

function mockFetch(handlers: {
  onComplete?: (body: unknown) => void;
  onCancel?: (body: unknown) => void;
  completeFails?: boolean;
  completeThrows?: boolean;
}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/api/uploads/presign') && init?.method === 'POST') {
      const requestBody = JSON.parse(String(init.body)) as { fileSize: number };
      const partCount = Math.ceil(requestBody.fileSize / PART_SIZE);
      return {
        ok: true,
        json: async () => makePresignResponse(partCount),
      } as Response;
    }

    if (url.includes(`/api/uploads/${UPLOAD_JOB_ID}/complete`) && init?.method === 'POST') {
      handlers.onComplete?.(JSON.parse(String(init.body)));
      if (handlers.completeThrows) {
        throw new TypeError('Failed to fetch');
      }
      if (handlers.completeFails) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'Multipart upload completion failed' }),
        } as Response;
      }
      return { ok: true, json: async () => ({ success: true, distributing: true }) } as Response;
    }

    if (url.includes(`/api/uploads/${UPLOAD_JOB_ID}/cancel`) && init?.method === 'POST') {
      handlers.onCancel?.(JSON.parse(String(init.body)));
      return { ok: true, json: async () => ({ success: true }) } as Response;
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });
}

function getFileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('Expected file input');
  }
  return input;
}

async function startUpload(user: ReturnType<typeof userEvent.setup>, file: File) {
  render(<UploadVideoForm draftId="draft-123" backHref="/dashboard/drafts/draft-123" />);
  await user.upload(getFileInput(), file);
  await user.click(screen.getByRole('button', { name: 'Upload' }));
}

describe('UploadVideoForm multipart upload', () => {
  beforeEach(() => {
    MockXMLHttpRequest.instances.length = 0;
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest as unknown as typeof XMLHttpRequest);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('completes a multi-part upload and sends part ETags to /complete', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    vi.stubGlobal('fetch', mockFetch({ onComplete }));

    const file = new File([new Uint8Array(15).fill(7)], 'clip.mp4', { type: 'video/mp4' });
    await startUpload(user, file);

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances.length).toBe(1);
    });
    MockXMLHttpRequest.instances[0]!.simulateSuccess(200, '"etag-part-1"');

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances.length).toBe(2);
    });
    MockXMLHttpRequest.instances[1]!.simulateSuccess(200, '"etag-part-2"');

    await waitFor(() => {
      expect(screen.getByText('Upload complete!')).toBeInTheDocument();
    });

    expect(onComplete).toHaveBeenCalledWith({
      uploadId: UPLOAD_ID,
      parts: [
        { partNumber: 1, eTag: 'etag-part-1' },
        { partNumber: 2, eTag: 'etag-part-2' },
      ],
    });
  });

  it('retries a failed part without re-uploading earlier parts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.stubGlobal('fetch', mockFetch({}));

    const file = new File([new Uint8Array(8).fill(1)], 'small.mp4', { type: 'video/mp4' });
    await startUpload(user, file);

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances.length).toBe(1);
    });

    MockXMLHttpRequest.instances[0]!.simulateError();
    await vi.advanceTimersByTimeAsync(1000);
    await waitFor(() => {
      expect(MockXMLHttpRequest.instances.length).toBe(2);
    });

    MockXMLHttpRequest.instances[1]!.simulateError();
    await vi.advanceTimersByTimeAsync(2000);
    await waitFor(() => {
      expect(MockXMLHttpRequest.instances.length).toBe(3);
    });

    MockXMLHttpRequest.instances[2]!.simulateSuccess(200, '"etag-after-retry"');

    await waitFor(() => {
      expect(screen.getByText('Upload complete!')).toBeInTheDocument();
    });

    expect(MockXMLHttpRequest.instances).toHaveLength(3);
  });

  it('calls cancel and shows an error when a part exhausts all retries', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onCancel = vi.fn();
    vi.stubGlobal('fetch', mockFetch({ onCancel }));

    const file = new File([new Uint8Array(5).fill(2)], 'retry-fail.mp4', { type: 'video/mp4' });
    await startUpload(user, file);

    for (let attempt = 0; attempt < MULTIPART_PART_MAX_ATTEMPTS; attempt++) {
      await waitFor(() => {
        expect(MockXMLHttpRequest.instances.length).toBe(attempt + 1);
      });
      MockXMLHttpRequest.instances[attempt]!.simulateError();
      if (attempt < MULTIPART_PART_MAX_ATTEMPTS - 1) {
        await vi.advanceTimersByTimeAsync(MULTIPART_PART_BACKOFF_BASE_MS * 2 ** attempt);
      }
    }

    await waitFor(() => {
      expect(screen.getByText('Upload failed')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(onCancel).toHaveBeenCalledWith({ uploadId: UPLOAD_ID });
  });

  it('calls cancel with uploadId when /complete returns non-2xx', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    vi.stubGlobal('fetch', mockFetch({ onCancel, completeFails: true }));

    const file = new File([new Uint8Array(5).fill(4)], 'complete-fail.mp4', { type: 'video/mp4' });
    await startUpload(user, file);

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances.length).toBe(1);
    });
    MockXMLHttpRequest.instances[0]!.simulateSuccess(200, '"etag-part-1"');

    await waitFor(() => {
      expect(screen.getByText('Upload failed')).toBeInTheDocument();
    });

    expect(onCancel).toHaveBeenCalledWith({ uploadId: UPLOAD_ID });
  });

  it('calls cancel with uploadId when /complete throws a network error', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    vi.stubGlobal('fetch', mockFetch({ onCancel, completeThrows: true }));

    const file = new File([new Uint8Array(5).fill(5)], 'complete-network-fail.mp4', {
      type: 'video/mp4',
    });
    await startUpload(user, file);

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances.length).toBe(1);
    });
    MockXMLHttpRequest.instances[0]!.simulateSuccess(200, '"etag-part-1"');

    await waitFor(() => {
      expect(
        screen.getByText('Network error while finalizing upload. Please try again.')
      ).toBeInTheDocument();
    });

    expect(onCancel).toHaveBeenCalledWith({ uploadId: UPLOAD_ID });
  });

  it('aborts the in-flight part and calls cancel with uploadId on user cancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    vi.stubGlobal('fetch', mockFetch({ onCancel }));

    const file = new File([new Uint8Array(20).fill(3)], 'cancel-me.mp4', { type: 'video/mp4' });
    await startUpload(user, file);

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances.length).toBe(1);
    });

    const inFlight = MockXMLHttpRequest.instances[0]!;
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(inFlight.abort).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledWith({ uploadId: UPLOAD_ID });
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
  });
});
