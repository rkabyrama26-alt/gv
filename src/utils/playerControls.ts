export interface ControlsTapState {
  isPlaying: boolean;
  controlsVisible: boolean;
}

/**
 * Computes immediate next controls visibility when user taps/clicks the player surface.
 * Returning hide=true clears the timer and hides immediately; show=true reveals and arms auto-hide.
 */
export function computeControlsTapOutcome(state: ControlsTapState): {
  nextVisible: boolean;
  armAutoHideTimer: boolean;
} {
  if (!state.isPlaying) {
    return { nextVisible: true, armAutoHideTimer: false };
  }
  if (state.controlsVisible) {
    return { nextVisible: false, armAutoHideTimer: false };
  }
  return { nextVisible: true, armAutoHideTimer: true };
}

/**
 * Tailwind positioning classes for the concealed YouTube iframe host.
 * Vertically overscans by 72px top & bottom inside an overflow-hidden container
 * so YouTube's top title bar and bottom-right corner watermark remain clipped off-screen
 * while keeping the 16:9 video centered at full width.
 */
export function getHiddenYouTubeHostClass(fillScreen: boolean): string {
  return `pointer-events-none absolute -top-[72px] inset-x-0 h-[calc(100%+144px)] overflow-hidden select-none transition-transform duration-150 [&_iframe]:h-full [&_iframe]:w-full [&_iframe]:border-0 [&_iframe]:pointer-events-none ${
    fillScreen ? 'scale-[1.28]' : 'scale-100'
  }`;
}

export function buildWatchInlineMeta(parts: {
  channelName?: string;
  viewsText?: string;
  publishedText?: string;
}): string[] {
  return [parts.channelName, parts.viewsText, parts.publishedText]
    .map((part) => (part || '').trim())
    .filter(Boolean);
}

/**
 * Estimates whether the bottom player control bar fits within a given container width
 * without horizontal clipping on narrow mobile screens.
 */
export function fitsPlayerControlsRow(
  containerWidthPx: number,
  opts: { hasHours?: boolean; showTheater?: boolean } = {},
): boolean {
  const iconWidth = containerWidthPx < 375 ? 28 : containerWidthPx < 640 ? 32 : 36;
  const horizontalPadding = containerWidthPx < 640 ? 16 : 32;
  const iconCount = opts.showTheater ? 7 : 6;
  const speedButtonWidth = containerWidthPx < 640 ? 30 : 38;
  const timeWidth = opts.hasHours ? 82 : 66;
  const gapsWidth = (iconCount + 1) * (containerWidthPx < 640 ? 2 : 6);
  const volumeSliderWidth = containerWidthPx >= 640 ? 68 : 0;

  const totalRequired =
    horizontalPadding +
    iconCount * iconWidth +
    speedButtonWidth +
    timeWidth +
    volumeSliderWidth +
    gapsWidth;

  return totalRequired <= containerWidthPx;
}

export type FastPlaybackStrategy =
  | { mode: 'direct'; warmYouTubeApi: false; parallelRace: false; resolveTimeoutMs: 0 }
  | { mode: 'youtube_fast_race'; warmYouTubeApi: true; parallelRace: true; resolveTimeoutMs: number }
  | { mode: 'resolve_then_direct'; warmYouTubeApi: false; parallelRace: false; resolveTimeoutMs: number };

export function resolveFastPlaybackMode(params: {
  videoId: string;
  streamUrl: string;
  isYouTubeId: boolean;
}): FastPlaybackStrategy {
  const { videoId, streamUrl, isYouTubeId } = params;
  if (streamUrl.startsWith('blob:') || streamUrl.startsWith('/api/xtream/stream/')) {
    return { mode: 'direct', warmYouTubeApi: false, parallelRace: false, resolveTimeoutMs: 0 };
  }
  if (streamUrl.startsWith('/api/videos/item/') && videoId && !videoId.startsWith('live_') && isYouTubeId) {
    return {
      mode: 'youtube_fast_race',
      warmYouTubeApi: true,
      parallelRace: true,
      resolveTimeoutMs: 1200,
    };
  }
  return {
    mode: 'resolve_then_direct',
    warmYouTubeApi: false,
    parallelRace: false,
    resolveTimeoutMs: 6500,
  };
}

function buildUpdatedXtreamUrl(
  rawUrl: string,
  updates: { remux?: boolean; low?: boolean; startSeconds?: number },
): string | null {
  if (!rawUrl.startsWith('/api/xtream/stream/')) {
    return null;
  }
  const [basePath, rawQs = ''] = rawUrl.split('?');
  const inQs = new URLSearchParams(rawQs);
  const outQs = new URLSearchParams();

  if (inQs.get('server') === '2') {
    outQs.set('server', '2');
  }
  if (updates.remux || updates.low || inQs.get('remux') === '1') {
    outQs.set('remux', '1');
  }
  if (updates.low || inQs.get('low') === '1') {
    outQs.set('low', '1');
  }
  if (typeof updates.startSeconds === 'number') {
    const clamped =
      Number.isFinite(updates.startSeconds) && updates.startSeconds > 0
        ? Math.floor(updates.startSeconds)
        : 0;
    if (clamped > 0) {
      outQs.set('start', String(clamped));
    }
  } else if (inQs.get('start')) {
    outQs.set('start', inQs.get('start') as string);
  }

  const serialized = outQs.toString();
  return serialized ? `${basePath}?${serialized}` : basePath;
}

export function buildXtreamStreamSeekUrl(
  baseStreamUrl: string,
  activeUrl: string,
  targetSeconds: number,
): string | null {
  const isLow = /(?:[?&])low=(?:1|true)\b/.test(activeUrl);
  return buildUpdatedXtreamUrl(baseStreamUrl, {
    remux: true,
    low: isLow,
    startSeconds: targetSeconds,
  });
}

export function getXtreamMetaUrlFromStream(streamUrl: string): string | null {
  if (!streamUrl.startsWith('/api/xtream/stream/')) return null;
  const [basePath, rawQs = ''] = streamUrl.split('?');
  const match = basePath.match(/^\/api\/xtream\/stream\/(movie|series)\/(\d+)$/);
  if (!match) return null;
  const qs = new URLSearchParams(rawQs);
  const server = qs.get('server') === '2' ? '?server=2' : '';
  return `/api/xtream/meta/${match[1]}/${match[2]}${server}`;
}

/**
 * Builds an adaptive low-bandwidth Xtream playback URL when slow/stalled buffering
 * is detected, preserving server selection and the current elapsed timestamp cleanly.
 */
export function getXtreamAdaptiveFallbackUrl(
  currentUrl: string,
  resumeAtSeconds: number,
): string | null {
  if (!currentUrl.startsWith('/api/xtream/stream/')) {
    return null;
  }
  if (/(?:[?&])low=(?:1|true)\b/.test(currentUrl)) {
    return null;
  }
  const clampedStart =
    Number.isFinite(resumeAtSeconds) && resumeAtSeconds > 1 ? Math.floor(resumeAtSeconds) : 0;
  return buildUpdatedXtreamUrl(currentUrl, {
    remux: true,
    low: true,
    startSeconds: clampedStart,
  });
}

export interface XtreamRecoveryAction {
  nextUrl: string;
  delayMs: number;
  preservedStartSeconds: number;
}

/**
 * Determines the next automatic recovery step when an Xtream <video> stream errors
 * during startup, playback, or seeking (supporting direct -> remux -> low -> transient retry).
 */
export function resolveXtreamPlaybackErrorRecovery(params: {
  currentUrl: string;
  recoveryStep: number;
  resumeAtSeconds: number;
}): XtreamRecoveryAction | null {
  const { currentUrl, recoveryStep, resumeAtSeconds } = params;
  if (!currentUrl.startsWith('/api/xtream/stream/')) {
    return null;
  }
  if (recoveryStep >= 3) {
    return null;
  }

  const startFromUrlMatch = currentUrl.match(/(?:[?&])start=(\d+)/);
  const urlStart = startFromUrlMatch ? Number.parseInt(startFromUrlMatch[1], 10) : 0;
  const clampedResume = Math.max(
    Number.isFinite(urlStart) && urlStart > 0 ? urlStart : 0,
    Number.isFinite(resumeAtSeconds) && resumeAtSeconds > 0 ? Math.floor(resumeAtSeconds) : 0,
  );

  const isRemux = /(?:[?&])remux=(?:1|true)\b/.test(currentUrl);
  const isLow = /(?:[?&])low=(?:1|true)\b/.test(currentUrl);

  // Step 1 on non-remux direct MP4: switch immediately to remux=1 (preserving seek offset)
  if (!isRemux && recoveryStep === 0) {
    const nextUrl = buildUpdatedXtreamUrl(currentUrl, {
      remux: true,
      low: false,
      startSeconds: clampedResume,
    });
    return nextUrl
      ? { nextUrl, delayMs: 220, preservedStartSeconds: clampedResume }
      : null;
  }

  // Remux failed once: try clean delayed retry (first on remux, then escalate to low=1)
  if (isRemux && !isLow) {
    if (recoveryStep === 0) {
      const nextUrl = buildUpdatedXtreamUrl(currentUrl, {
        remux: true,
        low: false,
        startSeconds: clampedResume,
      });
      return nextUrl
        ? { nextUrl, delayMs: 420, preservedStartSeconds: clampedResume }
        : null;
    }
    const lowUrl = buildUpdatedXtreamUrl(currentUrl, {
      remux: true,
      low: true,
      startSeconds: clampedResume,
    });
    return lowUrl
      ? { nextUrl: lowUrl, delayMs: 320, preservedStartSeconds: clampedResume }
      : null;
  }

  // Already on low=1: allow one transient CDN cooldown retry before giving up
  if (isLow && recoveryStep < 2) {
    const retryLowUrl = buildUpdatedXtreamUrl(currentUrl, {
      remux: true,
      low: true,
      startSeconds: clampedResume,
    });
    return retryLowUrl
      ? { nextUrl: retryLowUrl, delayMs: 650, preservedStartSeconds: clampedResume }
      : null;
  }

  return null;
}
