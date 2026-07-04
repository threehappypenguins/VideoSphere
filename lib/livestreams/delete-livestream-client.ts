import { toast } from 'sonner';

/**
 * Deletes a livestream through the dashboard API and surfaces toast feedback.
 * @param livestreamId - Persisted livestream identifier.
 * @returns Whether deletion succeeded.
 */
export async function deleteLivestreamViaApi(livestreamId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/livestreams/${livestreamId}`, { method: 'DELETE' });
    if (!response.ok) {
      const err = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(err?.message ?? 'Failed to delete livestream');
    }
    toast.success('Livestream deleted');
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to delete livestream');
    return false;
  }
}
