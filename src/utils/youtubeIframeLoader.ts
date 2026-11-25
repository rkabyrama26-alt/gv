export interface YtPlayerOptions {
  videoId: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number | undefined>;
  events?: {
    onReady?: (event: { target: YtPlayerInstance }) => void;
    onStateChange?: (event: { data: number; target: YtPlayerInstance }) => void;
    onError?: (event: { data: number; target: YtPlayerInstance }) => void;
  };
}

export interface YtPlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  setVolume: (volume: number) => void;
  getVolume: () => number;
  setPlaybackRate: (rate: number) => void;
  getPlaybackRate: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
  getVideoLoadedFraction: () => number;
  getPlayerState: () => number;
  destroy: () => void;
}

export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

interface YtNamespace {
  Player: new (element: HTMLElement | string, options: YtPlayerOptions) => YtPlayerInstance;
}

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoadPromise: Promise<YtNamespace> | null = null;

export function loadYouTubeIframeApi(): Promise<YtNamespace> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube IFrame API requires a browser window'));
  }

  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (apiLoadPromise) {
    return apiLoadPromise;
  }

  apiLoadPromise = new Promise<YtNamespace>((resolve, reject) => {
    const existingCallback = window.onYouTubeIframeAPIReady;
    const timeoutId = window.setTimeout(() => {
      if (!window.YT?.Player) {
        apiLoadPromise = null;
        reject(new Error('Timed out loading YouTube IFrame API'));
      }
    }, 15000);

    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeoutId);
      if (typeof existingCallback === 'function') {
        try {
          existingCallback();
        } catch {
          // ignore previous listener errors
        }
      }
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        apiLoadPromise = null;
        reject(new Error('YouTube IFrame API loaded without YT.Player'));
      }
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src*="youtube.com/iframe_api"]',
    );
    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeoutId);
        apiLoadPromise = null;
        reject(new Error('Failed to load YouTube IFrame API script'));
      };
      document.head.appendChild(script);
    }
  });

  return apiLoadPromise;
}

export function buildHiddenYouTubePlayerVars(origin?: string): Record<string, string | number> {
  const vars: Record<string, string | number> = {
    autoplay: 1,
    controls: 0,
    disablekb: 1,
    enablejsapi: 1,
    fs: 0,
    iv_load_policy: 3,
    modestbranding: 1,
    playsinline: 1,
    rel: 0,
    cc_load_policy: 0,
  };
  if (origin && /^https?:\/\//i.test(origin)) {
    vars.origin = origin;
  }
  return vars;
}
