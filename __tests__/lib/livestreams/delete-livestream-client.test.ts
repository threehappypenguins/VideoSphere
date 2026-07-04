import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { deleteLivestreamViaApi } from '@/lib/livestreams/delete-livestream-client';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('deleteLivestreamViaApi', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response)
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns true and shows success toast when the API delete succeeds', async () => {
    await expect(deleteLivestreamViaApi('livestream-1')).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('/api/livestreams/livestream-1', {
      method: 'DELETE',
    });
    expect(toast.success).toHaveBeenCalledWith('Livestream deleted');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('returns false and shows an error toast when the API delete fails', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: 'Cannot delete scheduled livestream' }),
    } as Response);

    await expect(deleteLivestreamViaApi('livestream-2')).resolves.toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Cannot delete scheduled livestream');
    expect(toast.success).not.toHaveBeenCalled();
  });
});
