import test from 'node:test';
import assert from 'node:assert/strict';
import { matchLiveBroadcastStream, parseM3uLivePlaylist } from './liveMatcher.ts';

test('parseM3uLivePlaylist parses EXTINF entries and skips non-m3u8 lines', () => {
  const sample = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-logo="https://img.test/mbc.png" group-title="General",MBC Iraq (1080p)',
    'https://shd-gcp-live.edgenextcdn.net/live/bitmovin-mbc-iraq/index.m3u8',
    '#EXTINF:-1,Broken Channel',
    'rtmp://invalid.stream/live',
  ].join('\n');

  const parsed = parseM3uLivePlaylist(sample);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'MBC Iraq');
  assert.equal(parsed[0].logo, 'https://img.test/mbc.png');
  assert.match(parsed[0].url, /\.m3u8$/);
});

test('matchLiveBroadcastStream resolves verified live TV HLS only for live broadcasts', () => {
  const liveRes = matchLiveBroadcastStream(
    'البث المباشر لقناة الحدث AlHadath Live Stream',
    'AlHadath الحدث',
    true,
  );
  assert.ok(liveRes);
  assert.equal(liveRes.label, 'Al Hadath');
  assert.match(liveRes.url, /^https?:\/\/.+\.m3u8/);

  const mbcLive = matchLiveBroadcastStream('بث مباشر قناة MBC العراق', 'MBC IRAQ', false);
  assert.ok(mbcLive);
  assert.equal(mbcLive.label, 'MBC Iraq');

  const skyLive = matchLiveBroadcastStream(
    'البث المباشر لقناة سكاي نيوز عربية - Sky News Arabia Live',
    'سكاي نيوز عربية',
    true,
  );
  assert.ok(skyLive);
  assert.equal(skyLive.label, 'Sky News Arabia');

  // Non-live VOD episodes on the same channel must NOT be hijacked by live TV feed
  const vodEpisode = matchLiveBroadcastStream(
    'يوسف صعب يستسلم ومازن فتح له باب جديد',
    'MBC IRAQ',
    false,
  );
  assert.equal(vodEpisode, null);
});
