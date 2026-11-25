import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFallbackSearchQueries,
  extractDirectVideoUrlId,
  extractMediaId,
  formatVideoDuration,
  formatViewsText,
  isAllowedStreamHost,
  normalizeGlobalQuery,
  parseMediaChannel,
  parseMediaVideo,
  pickDownloadVariantUrl,
  prioritizeFreshRawVideos,
  rankSearchChannels,
  rewriteM3u8Manifest,
  rotateFreshBatches,
  sanitizeDownloadFilename,
} from './mediaParser.ts';

test('extractMediaId handles raw IDs and direct video links', () => {
  assert.equal(extractMediaId('live_al_hadath'), 'live_al_hadath');
  assert.equal(extractMediaId('x8b8s9t'), 'x8b8s9t');
  assert.equal(extractMediaId('https://www.dailymotion.com/video/x99k0sc'), 'x99k0sc');
  assert.equal(extractMediaId('https://dai.ly/x73yvmn'), 'x73yvmn');
  assert.equal(extractMediaId('invalid search query'), null);
});

test('extractDirectVideoUrlId only matches explicit video URLs and never hijacks x-prefixed search queries', () => {
  assert.equal(extractDirectVideoUrlId('xyzqwerty123'), null);
  assert.equal(extractDirectVideoUrlId('xiaomi'), null);
  assert.equal(extractDirectVideoUrlId('xbox series x'), null);
  assert.equal(extractDirectVideoUrlId('x8b8s9t'), null);
  assert.equal(extractDirectVideoUrlId('https://www.dailymotion.com/video/x99k0sc'), 'x99k0sc');
  assert.equal(extractDirectVideoUrlId('https://dai.ly/x73yvmn'), 'x73yvmn');
});

test('formatVideoDuration and formatViewsText format Arabic and English cleanly', () => {
  assert.equal(formatVideoDuration(53), '0:53');
  assert.equal(formatVideoDuration(3725), '1:02:05');
  assert.equal(formatViewsText(506692, 'ar'), '507 ألف مشاهدة');
  assert.equal(formatViewsText(2500000, 'en'), '2.5M views');
});

test('parseMediaVideo and parseMediaChannel produce independent streamUrl with zero YouTube refs', () => {
  const video = parseMediaVideo(
    {
      id: 'x99k0sc',
      title: 'مسلسل المدينة البعيدة الحلقة 1',
      duration: 2700,
      views_total: 506692,
      thumbnail_720_url: 'https://s2.dmcdn.net/v/sample/x720',
      'owner.id': 'x29a2cm',
      'owner.screenname': 'قناة الدراما',
      'owner.avatar_120_url': 'https://s1.dmcdn.net/u/sample/120x120',
    },
    'ar',
  );

  assert.ok(video);
  assert.equal(video.streamUrl, '/api/videos/item/x99k0sc/stream.m3u8');
  assert.equal(video.duration, '45:00');
  assert.equal(video.channelName, 'قناة الدراما');

  const ch = parseMediaChannel({ id: 'x29a2cm', screenname: 'قناة الدراما', followers_total: 12000 }, 'ar');
  assert.ok(ch);
  assert.equal(ch.subscribersText, '12 ألف مشترك');
});

test('isAllowedStreamHost permits only trusted CDN domains', () => {
  assert.equal(isAllowedStreamHost('https://vod3.cf.dmcdn.net/sec2/segment.ts'), true);
  assert.equal(isAllowedStreamHost('https://cdndirector.dailymotion.com/cdn/manifest/video/x1.m3u8'), true);
  assert.equal(isAllowedStreamHost('https://evil.example.com/payload.m3u8'), false);
});

test('rewriteM3u8Manifest resolves relative segments and tag URIs through /api/videos/hls', () => {
  const input = [
    '#EXTM3U',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXTINF:3.0,',
    '../../../frag(1)/video/429929375.ts',
    'https://vod3.cf.dmcdn.net/sub/playlist.m3u8',
  ].join('\n');

  const out = rewriteM3u8Manifest(
    input,
    'https://vod3.cf.dmcdn.net/sec2(abc)/hls/video/index.m3u8',
    '/api/videos/hls',
  );

  assert.match(out, /URI="\/api\/videos\/hls\?u=https%3A%2F%2Fvod3\.cf\.dmcdn\.net/);
  assert.match(out, /\/api\/videos\/hls\?u=https%3A%2F%2Fvod3\.cf\.dmcdn\.net%2Ffrag\(1\)%2Fvideo%2F429929375\.ts/);
  assert.match(out, /\/api\/videos\/hls\?u=https%3A%2F%2Fvod3\.cf\.dmcdn\.net%2Fsub%2Fplaylist\.m3u8/);
});

test('normalizeGlobalQuery and buildFallbackSearchQueries handle Arabic diacritics and non-empty fallback', () => {
  assert.equal(normalizeGlobalQuery('أَحْمَدُ المِصْرِيّ!'), 'احمد المصري');
  const fallbacks = buildFallbackSearchQueries('مسلسل عربي تاريخي جديد', 'ar');
  assert.ok(fallbacks.length >= 2);
  assert.ok(fallbacks.includes('مسلسل'));
  const rare = buildFallbackSearchQueries('zxq9988', 'en');
  assert.ok(rare.includes('zxq'));
  assert.ok(rare[rare.length - 1].length > 0);
});

test('pickDownloadVariantUrl prefers <=480p variant and sanitizeDownloadFilename cleans unsafe chars', () => {
  const manifest = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720',
    'https://vod3.cf.dmcdn.net/720.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=854x480',
    'variants/480.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=450000,RESOLUTION=640x380',
    'variants/380.m3u8',
  ].join('\n');

  assert.equal(
    pickDownloadVariantUrl(manifest, 'https://vod3.cf.dmcdn.net/sec2/master.m3u8', 480),
    'https://vod3.cf.dmcdn.net/sec2/variants/480.m3u8',
  );
  assert.equal(
    sanitizeDownloadFilename('حلقة 1: دراما / خاص*؟', 'x99k0sc'),
    'حلقة 1 دراما خاص ؟.mp4',
  );
});

test('prioritizeFreshRawVideos interleaves diverse fresh videos and excludes old archive when strictFresh is enabled', () => {
  const now = 1_800_000_000;
  const freshA = Array.from({ length: 4 }, (_, i) => ({ id: `fa${i}`, created_time: now - 86400 * (i + 1) }));
  const freshB = Array.from({ length: 4 }, (_, i) => ({ id: `fb${i}`, created_time: now - 86400 * (i + 2) }));
  const oldArchive = [{ id: 'old1', created_time: now - 86400 * 900 }];

  const strictOut = prioritizeFreshRawVideos([[...oldArchive, ...freshA], freshB], {
    maxAgeDays: 180,
    strictFresh: true,
    nowSeconds: now,
  });

  assert.equal(strictOut.some((v) => v.id === 'old1'), false);
  assert.equal(strictOut[0].id, 'fa0');
  assert.equal(strictOut[1].id, 'fb0');

  // Non-strict search preserves fresh first, then older if fresh count is small
  const searchOut = prioritizeFreshRawVideos([[...oldArchive, freshA[0]]], {
    maxAgeDays: 180,
    strictFresh: false,
    nowSeconds: now,
  });
  assert.deepEqual(
    searchOut.map((v) => v.id),
    ['fa0', 'old1'],
  );
});

test('rotateFreshBatches changes feed ordering across refresh seeds without dropping items', () => {
  const b1 = ['a1', 'a2', 'a3'];
  const b2 = ['b1', 'b2', 'b3'];
  const seed0 = rotateFreshBatches([b1, b2], 0);
  const seed1 = rotateFreshBatches([b1, b2], 1);
  assert.notEqual(seed0[0][0], seed1[0][0]);
  assert.equal(seed1.flat().length, 6);
});

test('rankSearchChannels puts exact matching channels first ahead of partial secondary noise', () => {
  const ranked = rankSearchChannels(
    'بهاء سلطان',
    [
      { id: 'UC_exact', name: 'بهاء سلطان', verified: true },
      { id: 'UC_other', name: 'قناة موسيقى' },
    ],
    [
      { id: 'dm1', name: 'سلطان الطعام' },
      { id: 'dm2', name: 'علي سلطان' },
    ],
  );
  assert.equal(ranked[0].id, 'UC_exact');
  assert.equal(ranked.some((c) => c.id === 'dm1'), true);
});
