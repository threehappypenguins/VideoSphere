import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { YouTubeImportModal } from '@/components/youtube-import/YouTubeImportModal';
import type { Livestream, YoutubeImportJob } from '@/types';

vi.mock('next/image', () => ({
  default: ({ alt, priority: _priority, ...rest }: { alt: string; priority?: boolean }) => (
    <span role="img" aria-label={alt} {...rest} />
  ),
}));

vi.mock('@/components/youtube-import/YouTubePreviewPlayer', () => ({
  YouTubePreviewPlayer: () => <div data-testid="youtube-preview-player" />,
}));

vi.mock('@/components/youtube-import/TrimRangeSlider', () => ({
  TrimRangeSlider: ({
    onChange,
  }: {
    onChange: (value: { startSeconds: number; endSeconds: number }) => void;
  }) => (
    <button
      type="button"
      onClick={() => onChange({ startSeconds: 5, endSeconds: 95 })}
      data-testid="trim-range-slider"
    >
      Adjust trim
    </button>
  ),
}));

const DRAFT_ID = 'draft-1';
const VIDEO_ID = 'dQw4w9WgXcQ';

const resolvedSource = {
  youtubeVideoId: VIDEO_ID,
  title: 'Sunday Service',
  durationSeconds: 3600,
  thumbnailUrl: 'https://img.youtube.com/high.jpg',
  previewStreamUrl: `/api/youtube-import/preview/stream?youtubeVideoId=${VIDEO_ID}`,
  previewExpiresAt: Date.now() + 3_600_000,
};

const livestreamRow: Livestream = {
  id: 'livestream-1',
  userId: 'user-1',
  status: 'ended',
  title: 'Sunday Morning Service',
  description: '',
  tags: [],
  visibility: 'public',
  targets: ['youtube'],
  youtubeBroadcastId: VIDEO_ID,
  platforms: {
    youtube: {
      thumbnailUrl: 'https://img.youtube.com/live.jpg',
    },
  },
  scheduledStartTime: '2026-01-15T15:00:00.000Z',
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-16T00:00:00.000Z',
};

function makeImportJob(overrides: Partial<YoutubeImportJob> = {}): YoutubeImportJob {
  return {
    id: 'import-job-1',
    userId: 'user-1',
    draftId: DRAFT_ID,
    sourceUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    youtubeVideoId: VIDEO_ID,
    livestreamId: null,
    startSeconds: 0,
    endSeconds: 3600,
    status: 'downloading',
    progressPercent: 42,
    errorMessage: null,
    r2Key: null,
    uploadJobId: null,
    distributeQueued: false,
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:05:00.000Z',
    ...overrides,
  };
}

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function installFetchMock(handlers: {
  active?: FetchHandler;
  livestreams?: FetchHandler;
  resolve?: FetchHandler;
  start?: FetchHandler;
  run?: FetchHandler;
  job?: FetchHandler;
  cancel?: FetchHandler;
}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const urlStr = String(url);

    if (urlStr.includes('/api/youtube-import/active') && method === 'GET') {
      return (
        handlers.active?.(urlStr, init) ??
        new Response(JSON.stringify({ job: null }), { status: 200 })
      );
    }

    if (urlStr.includes('/api/livestreams?') && method === 'GET') {
      return (
        handlers.livestreams?.(urlStr, init) ??
        new Response(
          JSON.stringify({
            data: [livestreamRow],
            meta: { total: 1, limit: 20, offset: 0 },
          }),
          { status: 200 }
        )
      );
    }

    if (urlStr.endsWith('/api/youtube-import/resolve') && method === 'POST') {
      return (
        handlers.resolve?.(urlStr, init) ??
        new Response(JSON.stringify({ data: resolvedSource }), { status: 200 })
      );
    }

    if (urlStr.endsWith('/api/youtube-import/start') && method === 'POST') {
      return (
        handlers.start?.(urlStr, init) ??
        new Response(JSON.stringify({ jobId: 'import-job-1' }), { status: 201 })
      );
    }

    if (urlStr.includes('/api/youtube-import/') && urlStr.endsWith('/run') && method === 'POST') {
      return (
        handlers.run?.(urlStr, init) ??
        new Response(JSON.stringify({ data: makeImportJob({ status: 'downloading' }) }), {
          status: 200,
        })
      );
    }

    if (
      urlStr.includes('/api/youtube-import/') &&
      !urlStr.endsWith('/api/youtube-import/active') &&
      !urlStr.endsWith('/api/youtube-import/resolve') &&
      !urlStr.endsWith('/api/youtube-import/start') &&
      !urlStr.endsWith('/run') &&
      !urlStr.includes('/cancel') &&
      method === 'GET'
    ) {
      return (
        handlers.job?.(urlStr, init) ??
        new Response(JSON.stringify({ data: makeImportJob() }), { status: 200 })
      );
    }

    if (
      urlStr.includes('/api/youtube-import/') &&
      urlStr.endsWith('/cancel') &&
      method === 'POST'
    ) {
      return (
        handlers.cancel?.(urlStr, init) ??
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );
    }

    return new Response(JSON.stringify({ message: `Unhandled fetch: ${method} ${urlStr}` }), {
      status: 500,
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderModal(props: Partial<ComponentProps<typeof YouTubeImportModal>> = {}) {
  const onOpenChange = props.onOpenChange ?? vi.fn();
  const onImportComplete = props.onImportComplete ?? vi.fn();

  const view = render(
    <YouTubeImportModal
      draftId={DRAFT_ID}
      open={props.open ?? true}
      onOpenChange={onOpenChange}
      onImportComplete={onImportComplete}
    />
  );

  return { onOpenChange, onImportComplete, ...view };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('YouTubeImportModal', () => {
  it('transitions from source picker to editor after resolve succeeds', async () => {
    installFetchMock({});
    const user = userEvent.setup();

    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Sunday Morning Service')).toBeInTheDocument();
    });

    await user.type(
      screen.getByLabelText(/youtube link/i),
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
    await user.click(screen.getByRole('button', { name: /use this link/i }));

    await waitFor(() => {
      expect(screen.getByTestId('youtube-preview-player')).toBeInTheDocument();
      expect(screen.getByTestId('trim-range-slider')).toBeInTheDocument();
      expect(screen.getByText('Sunday Service')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Preview uses the same yt-dlp media source as import, so scrubbing should match the trimmed result/i
        )
      ).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/youtube-import/resolve',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      })
    );
  });

  it('selects a livestream row to resolve and open the trim editor', async () => {
    installFetchMock({});
    const user = userEvent.setup();

    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Sunday Morning Service')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('youtube-preview-player')).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/youtube-import/resolve',
      expect.objectContaining({ method: 'POST' })
    );

    await user.click(screen.getByRole('button', { name: /sunday morning service/i }));

    await waitFor(() => {
      expect(screen.getByTestId('trim-range-slider')).toBeInTheDocument();
      expect(screen.getByText('Sunday Service')).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/youtube-import/resolve',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ livestreamId: 'livestream-1' }),
      })
    );
  });

  it('polls job status after start and calls onImportComplete when finished', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync });

    let pollCount = 0;
    installFetchMock({
      job: () => {
        pollCount += 1;
        const status = pollCount >= 2 ? 'completed' : 'downloading';
        const progressPercent = pollCount >= 2 ? 100 : 55;
        return new Response(
          JSON.stringify({
            data: makeImportJob({ status, progressPercent }),
          }),
          { status: 200 }
        );
      },
    });

    const onImportComplete = vi.fn();
    const onOpenChange = vi.fn();
    renderModal({ onImportComplete, onOpenChange });

    await waitFor(() => {
      expect(screen.getByText('Sunday Morning Service')).toBeInTheDocument();
    });

    await user.type(
      screen.getByLabelText(/youtube link/i),
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
    await user.click(screen.getByRole('button', { name: /use this link/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start import/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /start import/i }));

    await waitFor(() => {
      expect(screen.getByText(/downloading/i)).toBeInTheDocument();
    });

    await vi.advanceTimersByTimeAsync(3000);

    await waitFor(() => {
      expect(onImportComplete).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/video staged for this draft/i)).toBeInTheDocument();
    });
  });

  it('offers to watch an existing import when start returns 409', async () => {
    installFetchMock({
      start: () =>
        new Response(
          JSON.stringify({
            error: 'Conflict',
            message: 'You already have an import in progress',
            statusCode: 409,
            activeJobId: 'existing-job-99',
          }),
          { status: 409 }
        ),
      job: (_url, init) => {
        if ((init?.method ?? 'GET') !== 'GET') {
          return new Response(null, { status: 405 });
        }
        return new Response(
          JSON.stringify({
            data: makeImportJob({ id: 'existing-job-99', progressPercent: 70 }),
          }),
          { status: 200 }
        );
      },
    });

    const fetchMock = vi.mocked(global.fetch);
    const user = userEvent.setup();

    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Sunday Morning Service')).toBeInTheDocument();
    });

    await user.type(
      screen.getByLabelText(/youtube link/i),
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
    await user.click(screen.getByRole('button', { name: /use this link/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start import/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /start import/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /watch existing import/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /watch existing import/i }));

    await waitFor(() => {
      expect(screen.getByText('70%')).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/youtube-import/existing-job-99',
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('resumes an active import on reopen via the active endpoint', async () => {
    installFetchMock({
      active: () =>
        new Response(
          JSON.stringify({
            job: makeImportJob({ id: 'active-job-77', progressPercent: 33 }),
          }),
          { status: 200 }
        ),
      job: () =>
        new Response(
          JSON.stringify({
            data: makeImportJob({ id: 'active-job-77', progressPercent: 33 }),
          }),
          { status: 200 }
        ),
    });

    renderModal();

    await waitFor(() => {
      expect(screen.getByText('33%')).toBeInTheDocument();
      expect(screen.queryByText('Pick a past livestream')).not.toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/youtube-import/active', {
      cache: 'no-store',
    });
  });

  it('asks for confirmation before cancelling an in-flight import', async () => {
    const user = userEvent.setup({ delay: null });
    const cancelSpy = vi.fn();
    installFetchMock({
      cancel: () => {
        cancelSpy();
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      },
      job: () =>
        new Response(
          JSON.stringify({
            data: makeImportJob({ status: 'downloading', progressPercent: 40 }),
          }),
          { status: 200 }
        ),
    });

    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Sunday Morning Service')).toBeInTheDocument();
    });

    await user.type(
      screen.getByLabelText(/youtube link/i),
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
    await user.click(screen.getByRole('button', { name: /use this link/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start import/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /start import/i }));

    await waitFor(() => {
      expect(screen.getByText(/downloading/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /^cancel import$/i }));

    const confirmDialog = await screen.findByRole('alertdialog', {
      name: /cancel youtube import/i,
    });
    expect(cancelSpy).not.toHaveBeenCalled();

    await user.click(within(confirmDialog).getByRole('button', { name: /^cancel import$/i }));

    await waitFor(() => {
      expect(cancelSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Pick a past livestream')).toBeInTheDocument();
    });
  });
});
