import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDirectDownloadUrl,
  buildVideoSharePayload,
  formatBytesLabel,
  getRawMediaId,
} from './shareVideo.ts';

test('getRawMediaId and buildDirectDownloadUrl generate direct MP4 URLs for main videos and TikTok reels', () => {
  assert.equal(getRawMediaId({ id: 'x8b8s9t', sourceType: 'video' }), 'x8b8s9t');
  assert.equal(getRawMediaId({ id: 'tt_74991234', sourceType: 'tiktok' }), '74991234');

  assert.equal(
    buildDirectDownloadUrl({ id: 'x8b8s9t', sourceType: 'video' }, 'https://example.com/'),
    'https://example.com/api/videos/item/x8b8s9t/download.mp4',
  );
  assert.equal(
    buildDirectDownloadUrl({ id: 'tt_74991234', sourceType: 'tiktok' }, 'https://example.com'),
    'https://example.com/api/tiktok/stream/74991234?download=1',
  );
});

test('buildVideoSharePayload prepares native share payload pointing to direct download endpoint', () => {
  const payload = buildVideoSharePayload(
    { id: 'x99k0sc', title: 'مسلسل عربي: الحلقة 1', sourceType: 'video' },
    'https://dramasquare.app',
    'ar',
  );
  assert.equal(payload.title, 'مسلسل عربي: الحلقة 1');
  assert.equal(payload.url, 'https://dramasquare.app/api/videos/item/x99k0sc/download.mp4');
  assert.match(payload.filename, /\.mp4$/);
  assert.match(payload.text, /MP4/);
});

test('formatBytesLabel formats bytes into KB, MB, GB cleanly', () => {
  assert.equal(formatBytesLabel(0, 'ar'), '');
  assert.equal(formatBytesLabel(512 * 1024, 'en'), '512 KB');
  assert.equal(formatBytesLabel(14.5 * 1024 * 1024, 'ar'), '14.5 ميجابايت');
  assert.equal(formatBytesLabel(1.5 * 1024 * 1024 * 1024, 'en'), '1.50 GB');
});

test('buildDirectDownloadUrl and needsServerDownloadProbe handle Xtream series & movies cleanly', async () => {
  const { isXtreamMedia, needsServerDownloadProbe } = await import('./shareVideo.ts');

  const ep = {
    id: 'xtream_ep_9912',
    title: 'مسلسل تجريبي · الحلقة 1',
    sourceType: 'video' as const,
    streamUrl: '/api/xtream/stream/series/9912',
  };
  assert.equal(isXtreamMedia(ep), true);
  assert.equal(needsServerDownloadProbe(ep), false);

  const dlUrl = buildDirectDownloadUrl(ep, 'https://dramasquare.app/');
  assert.ok(dlUrl.startsWith('https://dramasquare.app/api/xtream/stream/series/9912?download=1&name='));

  const yt = {
    id: 'dQw4w9WgXcQ',
    title: 'YouTube Video',
    sourceType: 'video' as const,
    streamUrl: '/api/videos/item/dQw4w9WgXcQ/stream.m3u8',
  };
  assert.equal(isXtreamMedia(yt), false);
  assert.equal(needsServerDownloadProbe(yt), true);
});

