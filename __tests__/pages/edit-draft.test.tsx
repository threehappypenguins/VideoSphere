import { describe, it, expect, vi } from 'vitest';

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

import EditDraftPage from '@/app/(dashboard)/dashboard/uploads/[id]/page';

describe('EditDraftPage', () => {
  it('redirects to the drafts page with editDraft query', async () => {
    await EditDraftPage({
      params: Promise.resolve({ id: 'draft-123' }),
    });

    expect(redirectMock).toHaveBeenCalledWith('/dashboard/uploads?editDraft=draft-123');
  });
});
