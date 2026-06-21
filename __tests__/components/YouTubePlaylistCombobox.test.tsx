import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { YouTubePlaylistCombobox } from '@/components/drafts/YouTubePlaylistCombobox';

describe('YouTubePlaylistCombobox', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('preloads playlists to resolve a saved playlist id to its title', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { id: 'PL99', title: 'Sunday Sermons' },
            { id: 'PL1', title: 'Youth Group' },
          ],
        }),
        { status: 200 }
      )
    );

    render(
      <YouTubePlaylistCombobox
        id="yt-playlist"
        playlistId="PL99"
        onPlaylistChange={vi.fn()}
        className="border"
      />
    );

    expect(global.fetch).toHaveBeenCalledWith('/api/platforms/youtube/playlists/recent', {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toHaveTextContent('Sunday Sermons');
    });
  });

  it('shows a stored playlist title without fetching when the title is already saved', () => {
    render(
      <YouTubePlaylistCombobox
        id="yt-playlist"
        playlistId="PL99"
        playlistTitle="Sunday Sermons"
        onPlaylistChange={vi.fn()}
        className="border"
      />
    );

    expect(screen.getByRole('combobox')).toHaveTextContent('Sunday Sermons');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('selects None and clears playlist values', async () => {
    const onPlaylistChange = vi.fn();
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'PL1', title: 'Sunday Sermons' }] }), {
        status: 200,
      })
    );

    render(
      <YouTubePlaylistCombobox
        id="yt-playlist"
        playlistId="PL1"
        playlistTitle="Sunday Sermons"
        onPlaylistChange={onPlaylistChange}
        className="border"
      />
    );

    await userEvent.click(screen.getByRole('combobox'));
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Sunday Sermons' })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('option', { name: 'None' }));

    expect(onPlaylistChange).toHaveBeenCalledWith({});
  });

  it('selects an existing playlist by id', async () => {
    const onPlaylistChange = vi.fn();
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'PL1', title: 'Sunday Sermons' }] }), {
        status: 200,
      })
    );

    render(
      <YouTubePlaylistCombobox
        id="yt-playlist"
        onPlaylistChange={onPlaylistChange}
        className="border"
      />
    );

    await userEvent.click(screen.getByRole('combobox'));
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Sunday Sermons' })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('option', { name: 'Sunday Sermons' }));

    expect(onPlaylistChange).toHaveBeenCalledWith({
      playlistId: 'PL1',
      playlistTitle: 'Sunday Sermons',
    });
  });

  it('selects Create for a custom playlist title', async () => {
    const onPlaylistChange = vi.fn();
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'PL1', title: 'Sunday Sermons' }] }), {
        status: 200,
      })
    );

    render(
      <YouTubePlaylistCombobox
        id="yt-playlist"
        onPlaylistChange={onPlaylistChange}
        className="border"
      />
    );

    await userEvent.click(screen.getByRole('combobox'));
    await waitFor(() => {
      expect(screen.getByLabelText('Search playlists')).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText('Search playlists'), 'New Series');
    await userEvent.click(screen.getByRole('option', { name: /Create .New Series./ }));

    expect(onPlaylistChange).toHaveBeenCalledWith({ playlistTitle: 'New Series' });
  });
});
