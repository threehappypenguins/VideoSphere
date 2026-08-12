import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LISTEN_KEEP_ALIVE_SRC,
  startListenKeepAliveAudio,
  stopListenKeepAliveAudio,
  syncListenMediaSession,
} from '@/lib/translation/listen-background-audio';

describe('listen-background-audio', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes a public keepalive asset path', () => {
    expect(LISTEN_KEEP_ALIVE_SRC).toBe('/translation-keepalive-silence.mp3');
  });

  it('starts looping keepalive playback on the media element', () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const keepAlive = {
      loop: false,
      playsInline: false,
      src: '',
      getAttribute: vi.fn(() => null),
      setAttribute: vi.fn(),
      play,
    } as unknown as HTMLAudioElement;

    expect(startListenKeepAliveAudio(keepAlive)).toBe(true);
    expect(keepAlive.loop).toBe(true);
    expect(keepAlive.src).toBe(LISTEN_KEEP_ALIVE_SRC);
    expect(play).toHaveBeenCalled();
  });

  it('stops keepalive playback safely', () => {
    const keepAlive = {
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
    } as unknown as HTMLAudioElement;

    stopListenKeepAliveAudio(keepAlive);
    expect(keepAlive.pause).toHaveBeenCalled();
    expect(keepAlive.removeAttribute).toHaveBeenCalledWith('src');
    expect(keepAlive.load).toHaveBeenCalled();
  });

  it('configures Media Session when playing', () => {
    const setActionHandler = vi.fn();
    const mediaSession = {
      playbackState: 'none',
      metadata: null as MediaMetadata | null,
      setActionHandler,
    };
    vi.stubGlobal('navigator', { mediaSession });
    vi.stubGlobal(
      'MediaMetadata',
      class {
        title: string;
        artist: string;
        constructor(init: { title: string; artist: string }) {
          this.title = init.title;
          this.artist = init.artist;
        }
      }
    );

    const onPause = vi.fn();
    const onPlay = vi.fn();
    syncListenMediaSession(true, onPause, onPlay);

    expect(mediaSession.playbackState).toBe('playing');
    expect(mediaSession.metadata).toMatchObject({
      title: 'Live translation',
      artist: 'VideoSphere',
    });
    expect(setActionHandler).toHaveBeenCalledWith('pause', expect.any(Function));
    expect(setActionHandler).toHaveBeenCalledWith('stop', expect.any(Function));
    expect(setActionHandler).toHaveBeenCalledWith('play', expect.any(Function));

    const pauseHandler = setActionHandler.mock.calls.find(
      (c) => c[0] === 'pause'
    )?.[1] as () => void;
    pauseHandler();
    expect(onPause).toHaveBeenCalled();
  });

  it('clears Media Session when not playing', () => {
    const setActionHandler = vi.fn();
    const mediaSession = {
      playbackState: 'playing',
      metadata: {} as MediaMetadata,
      setActionHandler,
    };
    vi.stubGlobal('navigator', { mediaSession });

    syncListenMediaSession(false, () => undefined);

    expect(mediaSession.playbackState).toBe('none');
    expect(mediaSession.metadata).toBeNull();
    expect(setActionHandler).toHaveBeenCalledWith('pause', null);
    expect(setActionHandler).toHaveBeenCalledWith('stop', null);
    expect(setActionHandler).toHaveBeenCalledWith('play', null);
  });
});
