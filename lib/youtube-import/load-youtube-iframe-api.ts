/**
 * Minimal YouTube IFrame Player API surface used by the preview player.
 */
export interface YouTubeIframePlayerInstance {
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}

interface YouTubeIframePlayerConstructor {
  new (
    elementId: string,
    config: {
      videoId?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (event: { target: YouTubeIframePlayerInstance }) => void;
      };
    }
  ): YouTubeIframePlayerInstance;
}

interface YouTubeIframeApi {
  Player: YouTubeIframePlayerConstructor;
}

declare global {
  interface Window {
    YT?: YouTubeIframeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YOUTUBE_IFRAME_API_SCRIPT_SRC = 'https://www.youtube.com/iframe_api';

let youtubeIframeApiLoadPromise: Promise<YouTubeIframeApi> | null = null;

/**
 * Loads the YouTube IFrame Player API script once per page.
 * @returns Promise resolving to the global `YT` namespace.
 */
export function loadYouTubeIframeApi(): Promise<YouTubeIframeApi> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube IFrame API is only available in the browser'));
  }

  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (!youtubeIframeApiLoadPromise) {
    youtubeIframeApiLoadPromise = new Promise<YouTubeIframeApi>((resolve, reject) => {
      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previousReady?.();
        if (window.YT?.Player) {
          resolve(window.YT);
          return;
        }
        reject(new Error('YouTube IFrame API loaded without YT.Player'));
      };

      const existingScript = document.querySelector<HTMLScriptElement>(
        `script[src="${YOUTUBE_IFRAME_API_SCRIPT_SRC}"]`
      );
      if (!existingScript) {
        const script = document.createElement('script');
        script.src = YOUTUBE_IFRAME_API_SCRIPT_SRC;
        script.async = true;
        script.onerror = () => {
          youtubeIframeApiLoadPromise = null;
          reject(new Error('Failed to load YouTube IFrame API script'));
        };
        document.head.appendChild(script);
      }
    });
  }

  return youtubeIframeApiLoadPromise;
}

/**
 * Clears the module-level loader singleton (tests only).
 */
export function resetYouTubeIframeApiLoaderForTests(): void {
  youtubeIframeApiLoadPromise = null;
}
