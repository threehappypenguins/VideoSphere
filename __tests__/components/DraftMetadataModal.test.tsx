import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
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

const draftValue: DraftEditorValues = {
  id: 'draft-behavior-1',
  title: 'Existing metadata title',
  description: 'Existing metadata description',
  tags: ['demo'],
  visibility: 'public',
  targets: ['youtube'],
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
