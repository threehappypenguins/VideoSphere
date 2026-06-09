import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { YouTubeLocationCombobox } from '@/components/drafts/YouTubeLocationCombobox';

describe('YouTubeLocationCombobox', () => {
  it('searches and commits only a validated place selection', async () => {
    const onLocationChange = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ placeId: 'place-1', description: 'Halifax, NS, Canada' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            placeId: 'place-1',
            description: 'Halifax, NS, Canada',
            latitude: 44.6488,
            longitude: -63.5752,
          },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<YouTubeLocationCombobox id="location-picker" onLocationChange={onLocationChange} />);

    await userEvent.click(screen.getByRole('button', { name: /none/i }));
    const searchInput = screen.getByRole('combobox', { name: /search locations/i });
    await userEvent.type(searchInput, 'Halifax');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/platforms/youtube/locations/search?q=Halifax'),
        expect.any(Object)
      );
    });

    await userEvent.click(await screen.findByRole('option', { name: 'Halifax, NS, Canada' }));

    await waitFor(() => {
      expect(onLocationChange).toHaveBeenCalledWith({
        recordingLocationDescription: 'Halifax, NS, Canada',
        recordingLocationLatitude: 44.6488,
        recordingLocationLongitude: -63.5752,
      });
    });

    vi.unstubAllGlobals();
  });

  it('clears the selected location', async () => {
    const onLocationChange = vi.fn();

    render(
      <YouTubeLocationCombobox
        id="location-picker"
        recordingLocationDescription="Halifax, NS, Canada"
        onLocationChange={onLocationChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onLocationChange).toHaveBeenCalledWith({
      recordingLocationDescription: undefined,
      recordingLocationLatitude: undefined,
      recordingLocationLongitude: undefined,
    });
  });
});
