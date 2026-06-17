/**
 * Regression tests for draft thumbnail upload and save-draft behavior in DraftMetadataModal.
 * Guards against stuck "Uploading…" state and Save draft being blocked during thumbnail PUT.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { MAX_DRAFT_THUMBNAIL_BYTES } from '@/lib/draft-thumbnail';
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

type XhrListener = (...args: unknown[]) => void;

/** Minimal XMLHttpRequest stand-in for presigned R2 PUT uploads. */
class MockXMLHttpRequest {
  static readonly instances: MockXMLHttpRequest[] = [];

  status = 0;
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

  dispatch(type: string, ...args: unknown[]) {
    for (const cb of this.listeners.get(type) ?? []) {
      cb(...args);
    }
  }

  simulateLoadStart() {
    for (const cb of this.upload.listeners.get('loadstart') ?? []) {
      cb();
    }
  }

  simulateProgress(loaded: number, total: number) {
    const event = { lengthComputable: true, loaded, total };
    for (const cb of this.upload.listeners.get('progress') ?? []) {
      cb(event);
    }
  }

  simulateSuccess(status = 200) {
    this.status = status;
    this.dispatch('load');
  }

  simulateError() {
    this.dispatch('error');
  }
}

const draftValue: DraftEditorValues = {
  id: 'draft-thumb-regression',
  title: 'Regression draft title',
  description: '',
  tags: [],
  visibility: 'public',
  targets: ['youtube'],
  platforms: {},
};

const PRESIGN_URL = 'https://r2.example/presigned-thumb-put';
const PENDING_KEY = 'temp/draft-thumbnail-pending/user/draft/pending.jpg';

function mockListFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/thumbnail/presign') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ uploadUrl: PRESIGN_URL, pendingKey: PENDING_KEY }),
        } as Response;
      }

      if (url.includes('/thumbnail/complete') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            data: {
              id: draftValue.id,
              title: draftValue.title,
              description: draftValue.description,
              tags: draftValue.tags,
              visibility: draftValue.visibility,
              targets: draftValue.targets,
              platforms: draftValue.platforms,
              thumbnailR2Key: 'draft-thumbnails/user/draft/final.jpg',
              thumbnailContentType: 'image/jpeg',
              thumbnailPreviewUrl: 'https://r2.example/preview.jpg',
            },
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({ data: [] }),
      } as Response;
    })
  );
}

type DraftSaveHandler = (options?: {
  closeAfterSave?: boolean;
}) => Promise<{ saved: boolean; draftId?: string; message?: string }>;
type DraftChangeHandler = (next: DraftEditorValues) => void;

function renderThumbnailModal(options?: {
  onSave?: DraftSaveHandler;
  onChange?: DraftChangeHandler;
}) {
  const onSave =
    options?.onSave ??
    vi.fn<DraftSaveHandler>().mockResolvedValue({
      saved: true,
      draftId: draftValue.id,
      message: 'Draft updated',
    });
  const onChange = options?.onChange ?? vi.fn<DraftChangeHandler>();

  render(
    <DraftMetadataModal
      mode="edit"
      value={draftValue}
      initialConnectedPlatforms={['youtube']}
      initialConnectionsResolved
      isSaving={false}
      onClose={vi.fn()}
      onSave={onSave}
      onChange={onChange}
    />
  );

  return { onSave, onChange };
}

async function startThumbnailUpload(user: ReturnType<typeof userEvent.setup>) {
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'thumb.jpg', {
    type: 'image/jpeg',
  });
  const input = document.getElementById('draft-thumbnail-file-shared') as HTMLInputElement;
  expect(input).toBeTruthy();
  await user.upload(input, file);
}

async function waitForInFlightThumbnailPut() {
  await waitFor(() => {
    expect(MockXMLHttpRequest.instances.length).toBeGreaterThan(0);
  });
  return MockXMLHttpRequest.instances.at(-1)!;
}

/** Asserts the modal is not stuck in the pre-fix "Uploading… 0%" state. */
function expectThumbnailUploadUiCleared() {
  expect(screen.queryByText(/Uploading thumbnail/i)).not.toBeInTheDocument();
  expect(getThumbnailChooseFileButton()).toBeEnabled();
  expect(screen.getByRole('button', { name: /Save draft/i })).toBeEnabled();
}

function getThumbnailChooseFileButton() {
  return screen.getAllByRole('button', { name: /^Choose file$/i })[0]!;
}

type ThumbnailUploadHarnessApi = {
  closeModal: () => void;
  switchDraft: () => void;
};

/** Parent harness with imperative controls (modal overlay blocks external button clicks). */
function createThumbnailUploadHarness(options?: { onChange?: DraftChangeHandler }) {
  const onChange = options?.onChange ?? vi.fn<DraftChangeHandler>();
  const harnessApi: { current: ThumbnailUploadHarnessApi | null } = { current: null };

  function Harness() {
    const [value, setValue] = useState<DraftEditorValues | null>(draftValue);

    useEffect(() => {
      harnessApi.current = {
        closeModal: () => setValue(null),
        switchDraft: () =>
          setValue({
            ...draftValue,
            id: 'draft-switched-id',
            title: 'Switched draft',
          }),
      };
      return () => {
        harnessApi.current = null;
      };
    }, []);

    return (
      <DraftMetadataModal
        mode="edit"
        value={value}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={() => setValue(null)}
        onSave={vi.fn<DraftSaveHandler>().mockResolvedValue({ saved: true })}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }

  return {
    Harness,
    closeModal: () => harnessApi.current?.closeModal(),
    switchDraft: () => harnessApi.current?.switchDraft(),
    onChange,
  };
}

describe('DraftMetadataModal thumbnail upload regressions', () => {
  beforeEach(() => {
    MockXMLHttpRequest.instances.length = 0;
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest as unknown as typeof XMLHttpRequest);
    mockListFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not keep rejected oversized thumbnail filename in the selection label', async () => {
    const user = userEvent.setup();
    renderThumbnailModal();

    await screen.findByRole('dialog');

    const videoInput = document.getElementById('draft-video-file') as HTMLInputElement;
    await user.upload(
      videoInput,
      new File([new Uint8Array([0, 1, 2])], 'sermon.mp4', { type: 'video/mp4' })
    );

    const oversized = new File([new Uint8Array(MAX_DRAFT_THUMBNAIL_BYTES + 1)], 'huge-thumb.jpg', {
      type: 'image/jpeg',
    });
    const input = document.getElementById('draft-thumbnail-file-shared') as HTMLInputElement;
    await user.upload(input, oversized);

    expect(toast.error).toHaveBeenCalled();
    expect(screen.queryByText('huge-thumb.jpg')).not.toBeInTheDocument();
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('/thumbnail/presign'),
      expect.anything()
    );
  });

  it('does not keep rejected disallowed-type thumbnail filename in the selection label', async () => {
    const user = userEvent.setup();
    renderThumbnailModal();

    await screen.findByRole('dialog');

    const videoInput = document.getElementById('draft-video-file') as HTMLInputElement;
    await user.upload(
      videoInput,
      new File([new Uint8Array([0, 1, 2])], 'sermon.mp4', { type: 'video/mp4' })
    );

    const invalidType = new File([new Uint8Array([0x47, 0x49, 0x46])], 'animation.gif', {
      type: 'image/gif',
    });
    const input = document.getElementById('draft-thumbnail-file-shared') as HTMLInputElement;
    await user.upload(input, invalidType);

    expect(toast.error).toHaveBeenCalled();
    expect(screen.queryByText('animation.gif')).not.toBeInTheDocument();
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('/thumbnail/presign'),
      expect.anything()
    );
  });

  it('keeps Save draft enabled but disables Upload & Save while a thumbnail PUT is in progress', async () => {
    const user = userEvent.setup();
    const { onSave } = renderThumbnailModal();

    await screen.findByRole('dialog');

    const videoInput = document.getElementById('draft-video-file') as HTMLInputElement;
    const videoFile = new File([new Uint8Array([0, 1, 2])], 'sermon.mp4', { type: 'video/mp4' });
    await user.upload(videoInput, videoFile);

    await startThumbnailUpload(user);

    await waitFor(() => {
      expect(getThumbnailChooseFileButton()).toBeDisabled();
    });

    expect(screen.getByRole('button', { name: /Save draft/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Upload & Save/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Save draft/i }));
    expect(onSave).toHaveBeenCalledWith({ closeAfterSave: true });

    const xhr = MockXMLHttpRequest.instances.at(-1);
    expect(xhr).toBeDefined();
    xhr!.simulateSuccess();

    await waitFor(() => {
      expect(screen.queryByText(/Uploading thumbnail/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Upload & Save/i })).toBeEnabled();
    });
  });

  it('completes thumbnail upload and updates draft thumbnail fields', async () => {
    const user = userEvent.setup();
    const { onChange } = renderThumbnailModal();

    await screen.findByRole('dialog');
    await startThumbnailUpload(user);

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances.length).toBeGreaterThan(0);
    });

    const xhr = MockXMLHttpRequest.instances.at(-1)!;
    xhr.simulateProgress(50, 100);
    xhr.simulateSuccess();

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          thumbnailR2Key: 'draft-thumbnails/user/draft/final.jpg',
          thumbnailContentType: 'image/jpeg',
          thumbnailPreviewUrl: 'https://r2.example/preview.jpg',
        })
      );
      expect(getThumbnailChooseFileButton()).toBeEnabled();
      expect(screen.queryByText(/Uploading thumbnail/i)).not.toBeInTheDocument();
    });

    expect(screen.getByText('thumb.jpg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save draft/i })).toBeEnabled();
  });

  it('keeps Choose file after parent state picks up completed thumbnail upload', async () => {
    const user = userEvent.setup();

    function ControlledModal() {
      const [value, setValue] = useState(draftValue);
      return (
        <DraftMetadataModal
          mode="edit"
          value={value}
          initialConnectedPlatforms={['youtube']}
          initialConnectionsResolved
          isSaving={false}
          onClose={vi.fn()}
          onSave={vi.fn().mockResolvedValue({ saved: true, draftId: draftValue.id })}
          onChange={setValue}
        />
      );
    }

    render(<ControlledModal />);

    await screen.findByRole('dialog');
    await startThumbnailUpload(user);

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances.length).toBeGreaterThan(0);
    });

    MockXMLHttpRequest.instances.at(-1)!.simulateSuccess();

    await waitFor(() => {
      expect(getThumbnailChooseFileButton()).toBeEnabled();
      expect(screen.getByText('thumb.jpg')).toBeInTheDocument();
    });
  });

  it('clears uploading state after storage PUT failure so Save draft stays usable', async () => {
    const user = userEvent.setup();
    renderThumbnailModal();

    await screen.findByRole('dialog');
    await startThumbnailUpload(user);

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances.length).toBeGreaterThan(0);
    });

    MockXMLHttpRequest.instances.at(-1)!.simulateError();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
      expect(getThumbnailChooseFileButton()).toBeEnabled();
      expect(screen.getByRole('button', { name: /Save draft/i })).toBeEnabled();
    });

    expect(screen.queryByText(/Uploading thumbnail/i)).not.toBeInTheDocument();
  });

  it('clears uploading state after presign failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/thumbnail/presign') && init?.method === 'POST') {
          return {
            ok: false,
            json: async () => ({ message: 'Failed to presign thumbnail upload' }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ data: [] }),
        } as Response;
      })
    );

    const user = userEvent.setup();
    renderThumbnailModal();

    await screen.findByRole('dialog');
    await startThumbnailUpload(user);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to presign thumbnail upload');
      expect(getThumbnailChooseFileButton()).toBeEnabled();
      expect(screen.getByRole('button', { name: /Save draft/i })).toBeEnabled();
    });
  });

  it('does not leave uploading state stuck when the PUT is aborted before completion', async () => {
    const user = userEvent.setup();
    renderThumbnailModal();

    await screen.findByRole('dialog');
    await startThumbnailUpload(user);

    const xhr = await waitForInFlightThumbnailPut();
    xhr.abort();

    await waitFor(() => {
      expectThumbnailUploadUiCleared();
    });
  });

  it('shows non-zero progress once the PUT starts (loadstart)', async () => {
    const user = userEvent.setup();
    renderThumbnailModal();

    await screen.findByRole('dialog');
    await startThumbnailUpload(user);

    const xhr = await waitForInFlightThumbnailPut();
    xhr.simulateLoadStart();

    await waitFor(() => {
      expect(screen.getByText('1%')).toBeInTheDocument();
    });
  });

  it('clears uploading state when parent closes the modal (value null) during in-flight PUT', async () => {
    const user = userEvent.setup();
    const { Harness, closeModal } = createThumbnailUploadHarness();

    render(<Harness />);
    await screen.findByRole('dialog');
    await startThumbnailUpload(user);
    const xhr = await waitForInFlightThumbnailPut();

    act(() => {
      closeModal();
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(xhr.abort).toHaveBeenCalled();
  });

  it('clears uploading state when draft id changes during in-flight PUT', async () => {
    const user = userEvent.setup();
    const { Harness, switchDraft } = createThumbnailUploadHarness();
    render(<Harness />);

    await screen.findByRole('dialog');
    await startThumbnailUpload(user);
    const xhr = await waitForInFlightThumbnailPut();

    act(() => {
      switchDraft();
    });

    await waitFor(() => {
      expectThumbnailUploadUiCleared();
    });
    expect(xhr.abort).toHaveBeenCalled();
  });

  it('ignores stale PUT completion after draft id changes and does not call thumbnail complete', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(global.fetch);
    const { Harness, switchDraft, onChange } = createThumbnailUploadHarness();

    render(<Harness />);
    await screen.findByRole('dialog');
    await startThumbnailUpload(user);
    const xhr = await waitForInFlightThumbnailPut();

    const completeCallsBefore = fetchMock.mock.calls.filter(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString();
      return url.includes('/thumbnail/complete') && init?.method === 'POST';
    }).length;

    act(() => {
      switchDraft();
    });
    xhr.simulateSuccess();

    await waitFor(() => {
      expectThumbnailUploadUiCleared();
    });

    const completeCallsAfter = fetchMock.mock.calls.filter(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString();
      return url.includes('/thumbnail/complete') && init?.method === 'POST';
    }).length;
    expect(completeCallsAfter).toBe(completeCallsBefore);
    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({
        thumbnailR2Key: 'draft-thumbnails/user/draft/final.jpg',
      })
    );
  });

  it('surfaces timeout error and clears UI when XHR hangs and fetch fallback fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();

        if (url.includes('/thumbnail/presign') && init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ uploadUrl: PRESIGN_URL, pendingKey: PENDING_KEY }),
          } as Response;
        }

        if (url === PRESIGN_URL && init?.method === 'PUT') {
          return { ok: false, status: 503 } as Response;
        }

        return {
          ok: true,
          json: async () => ({ data: [] }),
        } as Response;
      })
    );

    renderThumbnailModal();

    await screen.findByRole('dialog');
    await startThumbnailUpload(user);
    const xhr = await waitForInFlightThumbnailPut();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to upload thumbnail to storage (503)');
      expectThumbnailUploadUiCleared();
    });
    expect(xhr.abort).toHaveBeenCalled();

    vi.useRealTimers();
  });
});

const VIDEO_PRESIGN_URL = 'https://r2.example/presigned-video-put';
const VIDEO_UPLOAD_JOB_ID = 'upload-job-video-regression';

function mockVideoUploadFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/uploads/presign') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            uploadUrl: VIDEO_PRESIGN_URL,
            uploadJobId: VIDEO_UPLOAD_JOB_ID,
          }),
        } as Response;
      }

      if (url.includes(`/api/uploads/${VIDEO_UPLOAD_JOB_ID}/complete`) && init?.method === 'POST') {
        return { ok: true, json: async () => ({}) } as Response;
      }

      return {
        ok: true,
        json: async () => ({ data: [] }),
      } as Response;
    })
  );
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
    const user = userEvent.setup();
    renderThumbnailModal();

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
      expect(screen.getByRole('button', { name: /Close/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Choose video file/i })).toBeDisabled();
      expect(getThumbnailChooseFileButton()).toBeEnabled();
    });
  });
});
