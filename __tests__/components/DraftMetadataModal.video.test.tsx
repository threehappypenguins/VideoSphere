/**
 * Regression tests for draft video upload behavior in DraftMetadataModal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DraftMetadataModal, type DraftEditorValues } from '@/components/drafts/DraftMetadataModal';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/image', () => ({
  default: ({ alt, priority: _priority, ...rest }: any) => (
    <span role="img" aria-label={alt} {...rest} />
  ),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/components/youtube-import/YouTubeImportModal', () => ({
  YouTubeImportModal: ({
    open,
    draftId,
    onImportComplete,
  }: {
    open: boolean;
    draftId: string;
    onImportComplete: () => void | Promise<void>;
  }) =>
    open ? (
      <div data-testid="youtube-import-modal" data-draft-id={draftId}>
        <button type="button" onClick={() => void onImportComplete()}>
          Complete YouTube import
        </button>
      </div>
    ) : null,
}));

import { toast } from 'sonner';

type XhrListener = (...args: unknown[]) => void;

/** Minimal XMLHttpRequest stand-in for presigned R2 multipart PUT uploads. */
class MockXMLHttpRequest {
  static readonly instances: MockXMLHttpRequest[] = [];

  status = 0;
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

  simulateSuccess(status = 200, eTag = '"part-etag"') {
    this.status = status;
    this.responseHeaders.ETag = eTag;
    this.dispatch('load');
  }
}

const VIDEO_UPLOAD_ID = 'multipart-upload-id-regression';
const VIDEO_UPLOAD_JOB_ID = 'upload-job-video-regression';
const PART_SIZE = 10;

function mockVideoUploadFetch(options?: {
  completeFails?: boolean;
  completeThrows?: boolean;
  onCancel?: (body: unknown) => void;
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/uploads/presign') && init?.method === 'POST') {
        const requestBody = JSON.parse(String(init.body)) as { fileSize: number };
        const partCount = Math.max(1, Math.ceil(requestBody.fileSize / PART_SIZE));
        return {
          ok: true,
          json: async () => ({
            uploadId: VIDEO_UPLOAD_ID,
            key: 'temp/uploads/user-123/clip.mp4',
            bucketName: 'videosphere-uploads',
            partSize: PART_SIZE,
            parts: Array.from({ length: partCount }, (_, index) => ({
              partNumber: index + 1,
              url: `https://r2.example/part-${index + 1}`,
            })),
            uploadJobId: VIDEO_UPLOAD_JOB_ID,
          }),
        } as Response;
      }

      if (url.includes(`/api/uploads/${VIDEO_UPLOAD_JOB_ID}/complete`) && init?.method === 'POST') {
        if (options?.completeThrows) {
          throw new TypeError('Failed to fetch');
        }
        if (options?.completeFails) {
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: 'Multipart upload completion failed' }),
          } as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      }

      if (url.includes(`/api/uploads/${VIDEO_UPLOAD_JOB_ID}/cancel`) && init?.method === 'POST') {
        options?.onCancel?.(JSON.parse(String(init.body)));
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }

      return {
        ok: true,
        json: async () => ({ data: [] }),
      } as Response;
    })
  );
}

const draftValue: DraftEditorValues = {
  id: 'draft-video-regression',
  title: 'Regression draft title',
  description: '',
  tags: [],
  visibility: 'public',
  targets: ['youtube'],
  platforms: {},
};

function renderVideoModal(
  overrides: Partial<React.ComponentProps<typeof DraftMetadataModal>> = {}
) {
  const onSave =
    overrides.onSave ??
    vi.fn().mockResolvedValue({
      saved: true,
      draftId: draftValue.id,
      message: 'Draft updated',
    });

  render(
    <DraftMetadataModal
      mode="edit"
      value={draftValue}
      initialConnectedPlatforms={['youtube']}
      initialConnectionsResolved
      isSaving={false}
      onClose={vi.fn()}
      onSave={onSave}
      onChange={vi.fn()}
      {...overrides}
    />
  );

  return { onSave };
}

function getThumbnailChooseFileButton() {
  return screen.getAllByRole('button', { name: /^Choose file$/i })[0]!;
}

describe('DraftMetadataModal video upload regressions', () => {
  beforeEach(() => {
    MockXMLHttpRequest.instances.length = 0;
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest as unknown as typeof XMLHttpRequest);
    mockVideoUploadFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('disables Choose video file after upload completes while thumbnail Choose file stays enabled', async () => {
    const user = userEvent.setup({ delay: null });
    renderVideoModal();

    await screen.findByRole('dialog');

    const videoInput = document.getElementById('draft-video-file') as HTMLInputElement;
    await user.upload(
      videoInput,
      new File([new Uint8Array([0, 1, 2])], 'sermon.mp4', { type: 'video/mp4' })
    );

    await user.click(screen.getByRole('button', { name: /Upload & Save/i }));
    await user.click(screen.getByRole('button', { name: /Yes, upload/i }));

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances.length).toBeGreaterThan(0);
    });

    MockXMLHttpRequest.instances.at(-1)!.simulateSuccess();

    await waitFor(() => {
      const uploadDialog = screen.getByRole('dialog', { name: /Upload complete/i });
      expect(
        within(uploadDialog).getByRole('button', { name: /Close upload/i })
      ).toBeInTheDocument();
    });

    const draftDialog = screen.getByRole('dialog', { name: /Edit draft/i, hidden: true });
    expect(
      within(draftDialog).getByRole('button', { name: /Choose video file/i, hidden: true })
    ).toBeDisabled();
    expect(
      within(draftDialog).getAllByRole('button', { name: /^Choose file$/i, hidden: true })[0]!
    ).toBeEnabled();
  }, 10000);

  it('calls cancel with uploadId when multipart completion fails', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    mockVideoUploadFetch({ completeFails: true, onCancel });

    renderVideoModal();
    await screen.findByRole('dialog');

    const videoInput = document.getElementById('draft-video-file') as HTMLInputElement;
    await user.upload(
      videoInput,
      new File([new Uint8Array([0, 1, 2])], 'sermon.mp4', { type: 'video/mp4' })
    );

    await user.click(screen.getByRole('button', { name: /Upload & Save/i }));
    await user.click(screen.getByRole('button', { name: /Yes, upload/i }));

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances.length).toBeGreaterThan(0);
    });
    MockXMLHttpRequest.instances.at(-1)!.simulateSuccess();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });

    expect(onCancel).toHaveBeenCalledWith({ uploadId: VIDEO_UPLOAD_ID });
  });
});

describe('DraftMetadataModal YouTube import entry point', () => {
  beforeEach(() => {
    MockXMLHttpRequest.instances.length = 0;
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest as unknown as typeof XMLHttpRequest);
    mockVideoUploadFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hides Import from YouTube when YouTube is not connected', async () => {
    renderVideoModal({ initialConnectedPlatforms: ['vimeo'] });

    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: /Import from YouTube/i })).not.toBeInTheDocument();
  });

  it('disables Import from YouTube while a normal upload is in progress', async () => {
    const user = userEvent.setup({ delay: null });
    renderVideoModal();

    await screen.findByRole('dialog');

    const videoInput = document.getElementById('draft-video-file') as HTMLInputElement;
    await user.upload(
      videoInput,
      new File([new Uint8Array([0, 1, 2])], 'sermon.mp4', { type: 'video/mp4' })
    );

    await user.click(screen.getByRole('button', { name: /Upload & Save/i }));
    await user.click(screen.getByRole('button', { name: /Yes, upload/i }));

    await waitFor(() => {
      const draftDialog = screen.getByRole('dialog', { name: /Edit draft/i, hidden: true });
      expect(
        within(draftDialog).getByRole('button', { name: /Import from YouTube/i, hidden: true })
      ).toBeDisabled();
      expect(
        within(draftDialog).getByRole('button', { name: /Choose video file/i, hidden: true })
      ).toBeDisabled();
    });
  });

  it('saves the draft and opens the import modal with the draft id', async () => {
    const user = userEvent.setup({ delay: null });
    const onSave = vi.fn().mockResolvedValue({
      saved: true,
      draftId: 'saved-draft-id',
      message: 'Draft updated',
    });
    renderVideoModal({ onSave });

    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /Import from YouTube/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ closeAfterSave: false });
      expect(screen.getByTestId('youtube-import-modal')).toHaveAttribute(
        'data-draft-id',
        'saved-draft-id'
      );
    });
  });

  it('refreshes upload history the same way as a completed normal upload', async () => {
    const user = userEvent.setup({ delay: null });
    const onUploadComplete = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.mocked(global.fetch);
    renderVideoModal({ onUploadComplete });

    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /Import from YouTube/i }));

    await waitFor(() => {
      expect(screen.getByTestId('youtube-import-modal')).toBeInTheDocument();
    });

    const historyCallsBefore = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/api/drafts/draft-video-regression/upload-history')
    ).length;

    fireEvent.click(screen.getByRole('button', { name: /Complete YouTube import/i, hidden: true }));

    await waitFor(() => {
      expect(onUploadComplete).toHaveBeenCalledTimes(1);
      const historyCallsAfter = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/api/drafts/draft-video-regression/upload-history')
      ).length;
      expect(historyCallsAfter).toBeGreaterThan(historyCallsBefore);
      expect(screen.getByRole('button', { name: /Upload history/i })).toHaveAttribute(
        'aria-expanded',
        'true'
      );
    });
  });
});
