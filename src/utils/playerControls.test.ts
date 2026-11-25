import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWatchInlineMeta,
  computeControlsTapOutcome,
  fitsPlayerControlsRow,
  getHiddenYouTubeHostClass,
} from './playerControls.ts';

test('computeControlsTapOutcome hides visible controls immediately during playback', () => {
  const result = computeControlsTapOutcome({ isPlaying: true, controlsVisible: true });
  assert.deepEqual(result, { nextVisible: false, armAutoHideTimer: false });
});

test('computeControlsTapOutcome reveals hidden controls and arms auto-hide timer during playback', () => {
  const result = computeControlsTapOutcome({ isPlaying: true, controlsVisible: false });
  assert.deepEqual(result, { nextVisible: true, armAutoHideTimer: true });
});

test('computeControlsTapOutcome keeps controls visible when paused', () => {
  const result = computeControlsTapOutcome({ isPlaying: false, controlsVisible: true });
  assert.deepEqual(result, { nextVisible: true, armAutoHideTimer: false });
});

test('getHiddenYouTubeHostClass applies vertical overscan and blocks pointer events', () => {
  const normal = getHiddenYouTubeHostClass(false);
  assert.ok(normal.includes('pointer-events-none'));
  assert.ok(normal.includes('-top-[72px]'));
  assert.ok(normal.includes('h-[calc(100%+144px)]'));
  assert.ok(normal.includes('scale-100'));

  const stretched = getHiddenYouTubeHostClass(true);
  assert.ok(stretched.includes('scale-[1.28]'));
});

test('buildWatchInlineMeta filters empty parts cleanly', () => {
  assert.deepEqual(
    buildWatchInlineMeta({
      channelName: 'Drama Square',
      viewsText: '25 views',
      publishedText: '',
    }),
    ['Drama Square', '25 views'],
  );
});

test('fitsPlayerControlsRow fits inside narrow mobile viewports (320px, 360px, 390px) and desktop (1280px)', () => {
  assert.equal(fitsPlayerControlsRow(320, { hasHours: false, showTheater: false }), true);
  assert.equal(fitsPlayerControlsRow(360, { hasHours: true, showTheater: false }), true);
  assert.equal(fitsPlayerControlsRow(390, { hasHours: true, showTheater: false }), true);
  assert.equal(fitsPlayerControlsRow(1280, { hasHours: true, showTheater: true }), true);
});

test('resolveFastPlaybackMode picks parallel YouTube race for YouTube videos and direct mode for Xtream', async () => {
  const { resolveFastPlaybackMode } = await import('./playerControls.ts');

  const ytStrat = resolveFastPlaybackMode({
    videoId: 'dQw4w9WgXcQ',
    streamUrl: '/api/videos/item/dQw4w9WgXcQ/stream.m3u8',
    isYouTubeId: true,
  });
  assert.equal(ytStrat.mode, 'youtube_fast_race');
  assert.equal(ytStrat.parallelRace, true);
  assert.equal(ytStrat.warmYouTubeApi, true);

  const xtreamStrat = resolveFastPlaybackMode({
    videoId: 'xtream_ep_123',
    streamUrl: '/api/xtream/stream/series/123',
    isYouTubeId: false,
  });
  assert.equal(xtreamStrat.mode, 'direct');
  assert.equal(xtreamStrat.resolveTimeoutMs, 0);

  const liveStrat = resolveFastPlaybackMode({
    videoId: 'live_alsharqiya',
    streamUrl: '/api/videos/item/live_alsharqiya/stream.m3u8',
    isYouTubeId: false,
  });
  assert.equal(liveStrat.mode, 'resolve_then_direct');
});

test('getXtreamAdaptiveFallbackUrl computes low-bandwidth remux URL and preserves server=2', async () => {
  const {
    buildXtreamStreamSeekUrl,
    getXtreamAdaptiveFallbackUrl,
    getXtreamMetaUrlFromStream,
  } = await import('./playerControls.ts');

  assert.equal(
    getXtreamAdaptiveFallbackUrl('/api/xtream/stream/series/236047', 0),
    '/api/xtream/stream/series/236047?remux=1&low=1',
  );
  assert.equal(
    getXtreamAdaptiveFallbackUrl('/api/xtream/stream/series/236047?server=2', 0),
    '/api/xtream/stream/series/236047?server=2&remux=1&low=1',
  );
  assert.equal(
    getXtreamAdaptiveFallbackUrl('/api/xtream/stream/movie/991?remux=1&start=42', 125.8),
    '/api/xtream/stream/movie/991?remux=1&low=1&start=125',
  );
  assert.equal(
    getXtreamAdaptiveFallbackUrl('/api/xtream/stream/series/236047?remux=1&low=1&start=10', 25),
    null,
  );
  assert.equal(
    getXtreamAdaptiveFallbackUrl('/api/videos/item/abc123/media.mp4', 10),
    null,
  );
  assert.equal(
    buildXtreamStreamSeekUrl(
      '/api/xtream/stream/movie/305460?server=2',
      '/api/xtream/stream/movie/305460?server=2&remux=1&low=1',
      1800,
    ),
    '/api/xtream/stream/movie/305460?server=2&remux=1&low=1&start=1800',
  );
  assert.equal(
    getXtreamMetaUrlFromStream('/api/xtream/stream/movie/305460?server=2&remux=1'),
    '/api/xtream/meta/movie/305460?server=2',
  );
  assert.equal(
    getXtreamMetaUrlFromStream('/api/xtream/stream/series/296421'),
    '/api/xtream/meta/series/296421',
  );
});

test('resolveXtreamPlaybackErrorRecovery steps cleanly through direct -> remux -> low -> cooldown retry and stops after cap', async () => {
  const { resolveXtreamPlaybackErrorRecovery } = await import('./playerControls.ts');

  const step0Direct = resolveXtreamPlaybackErrorRecovery({
    currentUrl: '/api/xtream/stream/series/296886',
    recoveryStep: 0,
    resumeAtSeconds: 0,
  });
  assert.deepEqual(step0Direct, {
    nextUrl: '/api/xtream/stream/series/296886?remux=1',
    delayMs: 220,
    preservedStartSeconds: 0,
  });

  const step0SeekRemux = resolveXtreamPlaybackErrorRecovery({
    currentUrl: '/api/xtream/stream/series/296886?server=2&remux=1&start=2735',
    recoveryStep: 0,
    resumeAtSeconds: 2735,
  });
  assert.deepEqual(step0SeekRemux, {
    nextUrl: '/api/xtream/stream/series/296886?server=2&remux=1&start=2735',
    delayMs: 420,
    preservedStartSeconds: 2735,
  });

  const step1SeekLow = resolveXtreamPlaybackErrorRecovery({
    currentUrl: '/api/xtream/stream/series/296886?server=2&remux=1&start=2735',
    recoveryStep: 1,
    resumeAtSeconds: 2735,
  });
  assert.deepEqual(step1SeekLow, {
    nextUrl: '/api/xtream/stream/series/296886?server=2&remux=1&low=1&start=2735',
    delayMs: 320,
    preservedStartSeconds: 2735,
  });

  const exhausted = resolveXtreamPlaybackErrorRecovery({
    currentUrl: '/api/xtream/stream/series/296886?remux=1&low=1',
    recoveryStep: 3,
    resumeAtSeconds: 100,
  });
  assert.equal(exhausted, null);
});

test('parseXtreamStreamRoute, buildXtreamHlsPlaylistUrl, and isTimeInBufferedRanges work cleanly for Server 1 & 2', async () => {
  const {
    buildXtreamHlsPlaylistUrl,
    isTimeInBufferedRanges,
    parseXtreamStreamRoute,
  } = await import('./playerControls.ts');

  assert.deepEqual(parseXtreamStreamRoute('/api/xtream/stream/series/296886'), {
    serverId: '1',
    kind: 'series',
    id: '296886',
  });
  assert.deepEqual(parseXtreamStreamRoute('/api/xtream/stream/movie/865090?server=2'), {
    serverId: '2',
    kind: 'movie',
    id: '865090',
  });
  assert.equal(
    buildXtreamHlsPlaylistUrl('/api/xtream/stream/movie/865090?server=2', {
      startSeconds: 1840.7,
      low: true,
      sessionId: 'abc12',
    }),
    '/api/xtream/hls/2/movie/865090/playlist.m3u8?start=1840&low=1&sid=abc12',
  );
  assert.equal(
    buildXtreamHlsPlaylistUrl('/api/xtream/stream/series/296886', { sessionId: 's1' }),
    '/api/xtream/hls/1/series/296886/playlist.m3u8?sid=s1',
  );
  assert.equal(buildXtreamHlsPlaylistUrl('/api/videos/item/abc/media.mp4'), null);

  const ranges = [{ start: 0, end: 42 }, { start: 60, end: 95 }];
  assert.equal(isTimeInBufferedRanges(15, ranges), true);
  assert.equal(isTimeInBufferedRanges(41.8, ranges), false);
  assert.equal(isTimeInBufferedRanges(70, ranges), true);
  assert.equal(isTimeInBufferedRanges(50, ranges), false);
});

test('loadXtreamServer and saveXtreamServer persist Server 2 across reloads', async () => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
    },
    configurable: true,
  });

  const { loadXtreamServer, saveXtreamServer } = await import('./storage.ts');
  assert.equal(loadXtreamServer(), '1');
  saveXtreamServer('2');
  assert.equal(loadXtreamServer(), '2');
  saveXtreamServer('1');
  assert.equal(loadXtreamServer(), '1');
});


