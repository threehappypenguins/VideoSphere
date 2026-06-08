import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DraftMetadataModal, type DraftEditorValues } from '@/components/drafts/DraftMetadataModal';
import { expectNoAxeViolations } from '@/__tests__/utils/a11y';

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
  id: 'draft-a11y-1',
  title: 'Accessibility draft',
  description: 'Draft description',
  tags: ['demo'],
  visibility: 'public',
  targets: ['youtube'],
  platforms: {},
};

describe('Draft metadata modal accessibility', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders labelled draft controls and AI actions without axe violations', async () => {
    const { baseElement } = render(
      <DraftMetadataModal
        mode="create"
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
    expect(screen.getByLabelText(/ai prompt required for generation/i)).toBeInTheDocument();

    const aiButton = screen.getByRole('button', { name: /generate with ai/i });
    expect(aiButton).toHaveAttribute('aria-describedby', 'draft-ai-metadata-help');
    expect(screen.getByLabelText(/^title$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^description$/i)).toBeInTheDocument();

    await expectNoAxeViolations(baseElement);
  });
});
