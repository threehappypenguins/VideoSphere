import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

    const aiPromptInput = screen.getByLabelText(/optional ai prompt/i);
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

    const aiPromptInput = screen.getByLabelText(/optional ai prompt/i);
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

    const aiPromptInput = screen.getByLabelText(/optional ai prompt/i);
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
