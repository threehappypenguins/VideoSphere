import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { DraftMetadataModal, type DraftEditorValues } from '@/components/drafts/DraftMetadataModal';
import {
  getDefaultScheduleDate,
  getDefaultScheduleTime,
  getLocalTimeZone,
  zonedDateTimeToUtcIso,
} from '@/lib/youtube-schedule';

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

const draftValue: DraftEditorValues = {
  id: 'draft-behavior-1',
  title: 'Existing metadata title',
  description: 'Existing metadata description',
  tags: ['demo'],
  visibility: 'public',
  targets: ['youtube'],
  platforms: {},
};

describe('DraftMetadataModal AI prompt behavior', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();

        if (url.includes('/api/ai/generate-metadata/stream')) {
          return {
            ok: false,
            json: async () => ({ message: 'forced test failure' }),
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ data: [] }),
        } as Response;
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('disables AI generate button for empty or whitespace-only prompt', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={draftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: draftValue.id })}
        onChange={vi.fn()}
        canUseAiMetadata
      />
    );

    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    const aiPromptInput = screen.getByLabelText(/ai prompt required for generation/i);
    const aiButton = screen.getByRole('button', { name: /generate with ai/i });

    expect(aiButton).toBeDisabled();

    await userEvent.type(aiPromptInput, '   \t');
    expect(aiButton).toBeDisabled();

    await userEvent.type(aiPromptInput, 'hello');
    expect(aiButton).toBeEnabled();
  });

  it('does not trigger AI generation on Enter when prompt is whitespace-only', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={draftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: draftValue.id })}
        onChange={vi.fn()}
        canUseAiMetadata
      />
    );

    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    const aiPromptInput = screen.getByLabelText(/ai prompt required for generation/i);
    await userEvent.type(aiPromptInput, '   {enter}');

    const fetchMock = vi.mocked(global.fetch);
    const aiCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/api/ai/generate-metadata/stream')
    );

    expect(aiCalls).toHaveLength(0);
  });

  it('triggers AI generation on Enter when prompt has non-whitespace content', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={draftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: draftValue.id })}
        onChange={vi.fn()}
        canUseAiMetadata
      />
    );

    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    const aiPromptInput = screen.getByLabelText(/ai prompt required for generation/i);
    await userEvent.type(aiPromptInput, 'some prompt{enter}');

    await waitFor(() => {
      const fetchMock = vi.mocked(global.fetch);
      const aiCalls = fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('/api/ai/generate-metadata/stream')
      );
      expect(aiCalls).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// announceInModal behavior – AI metadata generation success
// ---------------------------------------------------------------------------
// These tests guard against regressions where:
//  (a) The modal's in-process live region stops receiving the announced text.
//  (b) toast.success is erroneously added back for flows that use announceInModal.
// ---------------------------------------------------------------------------

/**
 * Builds a minimal ReadableStream that delivers a single JSON metadata delta
 * followed by a [DONE] event, simulating a successful SSE generation stream.
 *
 * @param metadataJson - The JSON string to deliver as the SSE delta content.
 * @returns A ReadableStream of Uint8Array chunks.
 */
function makeSuccessSseStream(metadataJson: string): ReadableStream<Uint8Array> {
  const deltaLine = `data: ${JSON.stringify({ choices: [{ delta: { content: metadataJson } }] })}\n`;
  const doneLine = 'data: [DONE]\n';
  const text = deltaLine + doneLine;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe('DraftMetadataModal announceInModal – AI metadata generation success', () => {
  const announceDraftValue: DraftEditorValues = {
    id: 'draft-announce-ai-1',
    title: 'Original title',
    description: 'Original description',
    tags: [],
    visibility: 'public',
    targets: ['youtube'],
    platforms: {},
  };

  const successMetadataJson = JSON.stringify({
    title: 'AI Title',
    description: 'AI Desc',
    tags: [],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/ai/generate-metadata/stream')) {
          return {
            ok: true,
            body: makeSuccessSseStream(successMetadataJson),
          } as unknown as Response;
        }
        return { ok: true, json: async () => ({ data: [] }) } as unknown as Response;
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the in-modal visual status banner after successful AI generation', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={announceDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: announceDraftValue.id })}
        onChange={vi.fn()}
        canUseAiMetadata
      />
    );

    await screen.findByRole('dialog');

    await userEvent.type(
      screen.getByLabelText(/ai prompt required for generation/i),
      'describe my video'
    );
    await userEvent.click(screen.getByRole('button', { name: /generate with ai/i }));

    // setModalStatusMsg is synchronous – the banner appears as soon as the
    // async stream processing resolves, before the RAF callback.
    // findAllByText succeeds even when both the visual banner and the live
    // region contain the same text; we just want at least one match.
    await screen.findAllByText('Metadata generated successfully');
  });

  it('populates the in-modal ARIA live region after successful AI generation', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={announceDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: announceDraftValue.id })}
        onChange={vi.fn()}
        canUseAiMetadata
      />
    );

    await screen.findByRole('dialog');

    await userEvent.type(
      screen.getByLabelText(/ai prompt required for generation/i),
      'describe my video'
    );
    await userEvent.click(screen.getByRole('button', { name: /generate with ai/i }));

    // The text node is appended inside a requestAnimationFrame callback.
    // waitFor retries until it appears (RAF fires via setTimeout in jsdom).
    // The modal is rendered in a portal so we query document, not container.
    await waitFor(() => {
      const liveRegion = document.querySelector(
        '[role="status"][aria-live="polite"][aria-atomic="true"]'
      );
      expect(liveRegion).toBeInTheDocument();
      expect(liveRegion?.textContent).toBe('Metadata generated successfully');
    });
  });

  it('does not call toast.success for the in-modal announcement after AI generation', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={announceDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: announceDraftValue.id })}
        onChange={vi.fn()}
        canUseAiMetadata
      />
    );

    await screen.findByRole('dialog');

    await userEvent.type(
      screen.getByLabelText(/ai prompt required for generation/i),
      'describe my video'
    );
    await userEvent.click(screen.getByRole('button', { name: /generate with ai/i }));

    // Wait for the announcement as a reliable signal that the async stream
    // processing (and the announceInModal call) has completed.
    // findAllByText succeeds when both the visual banner and live region match.
    await screen.findAllByText('Metadata generated successfully');

    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('DraftMetadataModal shared metadata overrides', () => {
  function ControlledModal({ initialValue }: { initialValue: DraftEditorValues }) {
    const [value, setValue] = useState(initialValue);
    return (
      <DraftMetadataModal
        mode="edit"
        value={value}
        initialConnectedPlatforms={initialValue.targets}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: initialValue.id })}
        onChange={setValue}
      />
    );
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }) as Response)
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('expands per-platform title fields in the shared metadata card when use shared metadata is unchecked', async () => {
    const user = userEvent.setup();
    render(
      <ControlledModal
        initialValue={{
          ...draftValue,
          targets: ['youtube', 'sermon_audio'],
          platforms: { sermon_audio: {} },
        }}
      />
    );

    await screen.findByRole('dialog');
    expect(screen.getByLabelText(/^Title$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Title \(YouTube\)$/i)).not.toBeInTheDocument();

    const titleSharedCheckbox = screen.getByTitle(/all selected platforms share one title/i);
    await user.click(titleSharedCheckbox);

    expect(screen.queryByLabelText(/^Title$/i)).not.toBeInTheDocument();
    expect(document.getElementById('edit-title-youtube')).toBeInTheDocument();
    expect(document.getElementById('edit-title-sermon_audio')).toBeInTheDocument();
    expect(screen.getByLabelText(/Title — YouTube/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Title — SermonAudio/i)).toBeInTheDocument();
  });
});

describe('DraftMetadataModal privacy field', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }) as Response)
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hides privacy when only SermonAudio is selected', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={{
          ...draftValue,
          targets: ['sermon_audio'],
          platforms: { sermon_audio: {} },
        }}
        initialConnectedPlatforms={['sermon_audio']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: draftValue.id })}
        onChange={vi.fn()}
      />
    );

    await screen.findByRole('dialog');
    expect(screen.queryByLabelText(/^Privacy$/i)).not.toBeInTheDocument();
  });

  it('shows privacy for YouTube and shared metadata checkbox when YouTube and Vimeo are selected', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={{
          ...draftValue,
          targets: ['youtube', 'vimeo'],
        }}
        initialConnectedPlatforms={['youtube', 'vimeo']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: draftValue.id })}
        onChange={vi.fn()}
      />
    );

    await screen.findByRole('dialog');
    expect(screen.getByLabelText(/^Privacy$/i)).toBeInTheDocument();
    expect(screen.getByTitle(/YouTube and Vimeo share one privacy setting/i)).toBeInTheDocument();
  });
});

describe('DraftMetadataModal YouTube fields', () => {
  const youtubeDraftValue: DraftEditorValues = {
    id: 'draft-youtube-1',
    title: 'Video title',
    description: 'Video description',
    tags: [],
    visibility: 'public',
    targets: ['youtube'],
    platforms: {},
  };

  const originalSupportedValuesOf = (
    Intl as typeof Intl & { supportedValuesOf?: typeof Intl.supportedValuesOf }
  ).supportedValuesOf;

  function mockTimeZoneSupportedValuesOf(key: string): string[] {
    if (key === 'timeZone') {
      return ['America/Halifax', 'America/New_York', 'UTC'];
    }
    throw new Error(`Unsupported Intl.supportedValuesOf key: ${key}`);
  }

  function installSupportedValuesOfMock(): void {
    const mock = mockTimeZoneSupportedValuesOf as typeof Intl.supportedValuesOf;
    if (typeof originalSupportedValuesOf === 'function') {
      vi.spyOn(Intl, 'supportedValuesOf').mockImplementation(mock);
      return;
    }

    (
      Intl as typeof Intl & { supportedValuesOf?: typeof Intl.supportedValuesOf }
    ).supportedValuesOf = mock;
  }

  beforeEach(() => {
    installSupportedValuesOfMock();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/platforms/youtube/playlists/recent')) {
          return {
            ok: true,
            json: async () => ({
              data: [
                { id: 'PL1', title: 'Sunday Sermons' },
                { id: 'PL2', title: 'Bible Study' },
              ],
            }),
          } as Response;
        }
        if (url.includes('/api/platforms/youtube/languages')) {
          return {
            ok: true,
            json: async () => ({
              data: [
                { id: 'en', name: 'English' },
                { id: 'de', name: 'German' },
              ],
            }),
          } as Response;
        }
        if (url.includes('/api/platforms/youtube/categories')) {
          return {
            ok: true,
            json: async () => ({
              data: [{ id: '22', title: 'People & Blogs' }],
            }),
          } as Response;
        }
        if (url.includes('/api/platforms/youtube/account-defaults')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                defaultAudioLanguage: 'en',
                madeForKids: true,
                categoryId: '22',
                license: 'creativeCommon',
                embeddable: false,
              },
            }),
          } as Response;
        }
        return { ok: true, json: async () => ({ data: [] }) } as Response;
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalSupportedValuesOf === undefined) {
      delete (Intl as typeof Intl & { supportedValuesOf?: typeof Intl.supportedValuesOf })
        .supportedValuesOf;
    }
  });

  it('renders the playlist combobox when YouTube is an active target', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={youtubeDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={vi.fn()}
      />
    );

    await screen.findByRole('dialog');
    expect(screen.getByLabelText(/^Playlist$/i)).toBeInTheDocument();
    expect(document.getElementById('draft-youtube-playlist')).toBeInTheDocument();
  });

  it('seeds unset YouTube fields from account defaults when the modal loads', async () => {
    const onChange = vi.fn();
    render(
      <DraftMetadataModal
        mode="edit"
        value={youtubeDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={onChange}
      />
    );

    await screen.findByRole('dialog');

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const seededCall = onChange.mock.calls.find((call) => {
      const next = call[0] as DraftEditorValues;
      return next.platforms.youtube?.license === 'creativeCommon';
    });

    expect(seededCall?.[0]).toMatchObject({
      platforms: {
        youtube: {
          defaultAudioLanguage: 'en',
          madeForKids: true,
          categoryId: '22',
          license: 'creativeCommon',
          embeddable: false,
        },
      },
    });
  });

  it('updates platforms.youtube.playlistIds when selecting an existing playlist', async () => {
    const onChange = vi.fn();
    render(
      <DraftMetadataModal
        mode="edit"
        value={youtubeDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={onChange}
      />
    );

    await screen.findByRole('dialog');
    await userEvent.click(screen.getByLabelText(/^Playlist$/i));
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Sunday Sermons' })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('option', { name: 'Sunday Sermons' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        platforms: expect.objectContaining({
          youtube: expect.objectContaining({
            playlistIds: ['PL1'],
            playlistTitles: [],
          }),
        }),
      })
    );
  });

  it('updates platforms.youtube.playlistTitles when creating a custom playlist name', async () => {
    const onChange = vi.fn();
    render(
      <DraftMetadataModal
        mode="edit"
        value={youtubeDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={onChange}
      />
    );

    await screen.findByRole('dialog');
    await userEvent.click(screen.getByLabelText(/^Playlist$/i));
    await waitFor(() => {
      expect(screen.getByLabelText('Search playlists')).toBeInTheDocument();
    });
    await userEvent.type(screen.getByLabelText('Search playlists'), 'Youth Group');
    await userEvent.click(screen.getByRole('option', { name: /Create .Youth Group./ }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        platforms: expect.objectContaining({
          youtube: expect.objectContaining({
            playlistIds: [],
            playlistTitles: ['Youth Group'],
          }),
        }),
      })
    );
  });

  it('keeps the age restriction section collapsed until the chevron is clicked', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={youtubeDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={vi.fn()}
      />
    );

    await screen.findByRole('dialog');
    expect(screen.queryByText("Yes, it's made for kids.")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Age restrictions/i }));
    expect(screen.getByText("Yes, it's made for kids.")).toBeInTheDocument();
  });

  it('initialises the made for kids radio group from the YouTube account default', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={youtubeDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={vi.fn()}
      />
    );

    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /Age restrictions/i }));

    expect(screen.getByRole('radio', { name: /Yes, it's made for kids/i })).toBeChecked();
  });

  async function expandShowMore() {
    await userEvent.click(screen.getByRole('button', { name: /^Show more$/i }));
  }

  async function expandSchedule() {
    await userEvent.click(screen.getByRole('button', { name: /^Schedule$/i }));
  }

  it('renders the Schedule card after Category inside Show more', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={youtubeDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={vi.fn()}
      />
    );

    await screen.findByRole('dialog');
    await expandShowMore();

    const categoryLabel = screen.getByText(/^Category$/i);
    const scheduleToggle = screen.getByRole('button', { name: /^Schedule$/i });
    expect(categoryLabel.compareDocumentPosition(scheduleToggle)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('defaults the schedule date to today and time to the next whole hour', async () => {
    const frozenNow = new Date('2025-06-08T15:30:00.000Z');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(frozenNow);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync });

    render(
      <DraftMetadataModal
        mode="edit"
        value={youtubeDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={vi.fn()}
      />
    );

    try {
      await screen.findByRole('dialog');
      await user.click(screen.getByRole('button', { name: /^Show more$/i }));
      await user.click(screen.getByRole('button', { name: /^Schedule$/i }));

      const tz = getLocalTimeZone();
      expect(screen.getByLabelText('Date')).toHaveValue(getDefaultScheduleDate(tz, frozenNow));
      expect(document.getElementById('draft-youtube-schedule-time')).toHaveTextContent(
        getDefaultScheduleTime(tz, frozenNow)
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults the timezone button to the local timezone and updates on selection', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={youtubeDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={vi.fn()}
      />
    );

    await screen.findByRole('dialog');
    await expandShowMore();
    await expandSchedule();

    const timezoneButton = document.getElementById('draft-youtube-schedule-timezone');
    expect(timezoneButton).toHaveTextContent(getLocalTimeZone());

    await userEvent.click(timezoneButton!);
    await userEvent.type(screen.getByLabelText('Search timezones'), 'Halifax');
    await userEvent.click(await screen.findByRole('option', { name: 'America/Halifax' }));

    expect(timezoneButton).toHaveTextContent('America/Halifax');
  });

  it('updates platforms.youtube.publishAt when schedule date, time, or timezone changes', async () => {
    const onChange = vi.fn();
    render(
      <DraftMetadataModal
        mode="edit"
        value={youtubeDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={onChange}
      />
    );

    await screen.findByRole('dialog');
    await expandShowMore();
    await expandSchedule();

    const tz = getLocalTimeZone();
    const dateStr = getDefaultScheduleDate(tz);
    const timeStr = getDefaultScheduleTime(tz);
    const expectedIso = zonedDateTimeToUtcIso(dateStr, timeStr, tz);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          platforms: expect.objectContaining({
            youtube: expect.objectContaining({ publishAt: expectedIso }),
          }),
        })
      );
    });

    onChange.mockClear();
    await userEvent.clear(screen.getByLabelText('Date'));
    await userEvent.type(screen.getByLabelText('Date'), '2026-06-09');

    const nextIso = zonedDateTimeToUtcIso('2026-06-09', timeStr, tz);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          platforms: expect.objectContaining({
            youtube: expect.objectContaining({ publishAt: nextIso }),
          }),
        })
      );
    });
  });

  it('clears publishAt when the schedule card is collapsed or cleared', async () => {
    const onChange = vi.fn();
    render(
      <DraftMetadataModal
        mode="edit"
        value={youtubeDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={onChange}
      />
    );

    await screen.findByRole('dialog');
    await expandShowMore();
    await expandSchedule();

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)?.[0] as DraftEditorValues | undefined;
      expect(lastCall?.platforms.youtube?.publishAt).toEqual(
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
      );
    });

    onChange.mockClear();
    await userEvent.click(screen.getByRole('button', { name: /^Schedule$/i }));

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)?.[0] as DraftEditorValues | undefined;
      expect(lastCall?.platforms.youtube?.publishAt).toBeUndefined();
    });

    onChange.mockClear();
    await expandSchedule();
    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)?.[0] as DraftEditorValues | undefined;
      expect(lastCall?.platforms.youtube?.publishAt).toEqual(
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
      );
    });

    onChange.mockClear();
    await userEvent.click(screen.getByRole('button', { name: /Clear schedule/i }));

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)?.[0] as DraftEditorValues | undefined;
      expect(lastCall?.platforms.youtube?.publishAt).toBeUndefined();
    });
  });

  it('initialises video language from the YouTube account default', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={youtubeDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={vi.fn()}
      />
    );

    await screen.findByRole('dialog');
    await expandShowMore();

    await waitFor(() => {
      expect(document.getElementById('draft-youtube-video-language')).toHaveTextContent('English');
    });
  });

  it('keeps the Show more section collapsed until toggled', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={youtubeDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={vi.fn()}
      />
    );

    await screen.findByRole('dialog');
    expect(screen.queryByText(/^Video language$/)).not.toBeInTheDocument();
    await expandShowMore();
    expect(screen.getByText(/^Video language$/)).toBeInTheDocument();
  });

  it('collapses Show more when the modal closes and reopens for a new draft', async () => {
    const { rerender } = render(
      <DraftMetadataModal
        mode="create"
        value={youtubeDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={vi.fn()}
      />
    );

    await screen.findByRole('dialog');
    await expandShowMore();
    expect(screen.getByText(/^Video language$/)).toBeInTheDocument();

    rerender(
      <DraftMetadataModal
        mode="create"
        value={null}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={vi.fn()}
      />
    );

    rerender(
      <DraftMetadataModal
        mode="create"
        value={{
          ...youtubeDraftValue,
          id: 'draft-youtube-2',
          title: 'Another draft',
        }}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: 'draft-youtube-2' })}
        onChange={vi.fn()}
      />
    );

    await screen.findByRole('dialog');
    expect(screen.queryByText(/^Video language$/)).not.toBeInTheDocument();
  });

  it('initialises Show more fields from YouTube account defaults when draft values are unset', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={youtubeDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={vi.fn()}
      />
    );

    await screen.findByRole('dialog');
    await expandShowMore();

    await waitFor(() => {
      expect(document.getElementById('draft-youtube-video-language')).toHaveTextContent('English');
    });
    expect(document.getElementById('draft-youtube-category')).toHaveTextContent('People & Blogs');
    expect(screen.getByLabelText(/Allow embedding/i)).not.toBeChecked();
  });

  it('leaves recording date empty when recordingDate is unset', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={youtubeDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={vi.fn()}
      />
    );

    await screen.findByRole('dialog');
    await expandShowMore();

    expect(screen.getByLabelText('Recording date')).toHaveValue('');
  });

  it('defaults the notify subscribers checkbox to checked', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={youtubeDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={vi.fn()}
      />
    );

    await screen.findByRole('dialog');
    await expandShowMore();

    expect(
      screen.getByRole('checkbox', {
        name: /Publish to subscriptions feed and notify subscribers/i,
      })
    ).toBeChecked();
  });

  it('populates language and category dropdowns from YouTube API responses', async () => {
    render(
      <DraftMetadataModal
        mode="edit"
        value={youtubeDraftValue}
        initialConnectedPlatforms={['youtube']}
        initialConnectionsResolved
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ saved: true, draftId: youtubeDraftValue.id })}
        onChange={vi.fn()}
      />
    );

    await screen.findByRole('dialog');
    await expandShowMore();
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/platforms/youtube/languages'),
        expect.any(Object)
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/platforms/youtube/categories'),
        expect.any(Object)
      );
    });

    await userEvent.click(document.getElementById('draft-youtube-video-language')!);
    expect(await screen.findByRole('option', { name: 'English' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByLabelText(/^Category$/i));
    expect(await screen.findByRole('option', { name: 'People & Blogs' })).toBeInTheDocument();
  });
});
