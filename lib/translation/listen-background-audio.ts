/**
 * Helpers so the public listen page can keep spoken audio alive with the phone
 * screen off. Chrome on Android does not grant audio focus to Web Audio alone;
 * a looping HTMLMediaElement (≥5s) plus Media Session is required.
 */

/** Public asset: ~30s near-silent loop used as a media-focus keepalive (≥5s required on Android). */
export const LISTEN_KEEP_ALIVE_SRC = '/translation-keepalive-silence.mp3';

/**
 * Configures Media Session metadata and playback state for live listen audio.
 * @param playing - Whether spoken audio is currently enabled.
 * @param onPause - Invoked when the user pauses from system media controls.
 * @param onPlay - Invoked when the user resumes from system media controls.
 */
export function syncListenMediaSession(
  playing: boolean,
  onPause: () => void,
  onPlay?: () => void
): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    if (!playing) {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('stop', null);
      navigator.mediaSession.setActionHandler('play', null);
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Live translation',
      artist: 'VideoSphere',
    });
    navigator.mediaSession.playbackState = 'playing';
    navigator.mediaSession.setActionHandler('pause', () => {
      onPause();
    });
    navigator.mediaSession.setActionHandler('stop', () => {
      onPause();
    });
    navigator.mediaSession.setActionHandler('play', () => {
      onPlay?.();
    });
  } catch {
    // Media Session is best-effort across browsers.
  }
}

/**
 * Starts looping silent HTML audio so Android treats the tab as active media.
 * @param keepAlive - Hidden audio element dedicated to keepalive playback.
 * @returns Whether play() was started (may still reject asynchronously).
 */
export function startListenKeepAliveAudio(keepAlive: HTMLAudioElement): boolean {
  keepAlive.loop = true;
  keepAlive.volume = 0.01;
  // playsInline is a video attribute in the DOM typings; set the attribute for mobile Safari.
  keepAlive.setAttribute('playsinline', '');
  if (!keepAlive.getAttribute('src')) {
    keepAlive.src = LISTEN_KEEP_ALIVE_SRC;
  }
  void keepAlive.play().catch(() => undefined);
  return true;
}

/**
 * Stops keepalive HTML audio without throwing.
 * @param keepAlive - Hidden audio element dedicated to keepalive playback.
 */
export function stopListenKeepAliveAudio(keepAlive: HTMLAudioElement | null): void {
  if (!keepAlive) return;
  try {
    keepAlive.pause();
    keepAlive.removeAttribute('src');
    keepAlive.load();
  } catch {
    // ignore
  }
}

/**
 * Hooks a keepalive media element into a Web Audio graph (near-silent gain).
 * createMediaElementSource may only be called once per element; callers should
 * retain the returned node for the page lifetime.
 * @param ctx - Active AudioContext.
 * @param keepAlive - Keepalive audio element.
 * @param existing - Previously created source node, if any.
 * @returns Media element source node when available.
 */
export function ensureKeepAliveMediaElementSource(
  ctx: AudioContext,
  keepAlive: HTMLAudioElement,
  existing: MediaElementAudioSourceNode | null
): MediaElementAudioSourceNode | null {
  if (existing) return existing;
  try {
    const mediaSource = ctx.createMediaElementSource(keepAlive);
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    mediaSource.connect(gain);
    gain.connect(ctx.destination);
    return mediaSource;
  } catch {
    return null;
  }
}
