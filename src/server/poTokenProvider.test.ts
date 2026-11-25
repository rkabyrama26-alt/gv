import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendPoTokenToStreamUrl,
  detectYouTubeClientFromUrl,
  getClientHeadersForStreamUrl,
  getPoTokenSession,
  YOUTUBE_CLIENT_SIGNATURES,
} from './poTokenProvider.ts';

test('detectYouTubeClientFromUrl and getClientHeadersForStreamUrl match googlevideo client parameters', () => {
  const androidUrl = 'https://rr3---sn-4g5ednsl.googlevideo.com/videoplayback?itag=18&c=ANDROID&ip=1.2.3.4';
  assert.equal(detectYouTubeClientFromUrl(androidUrl), 'ANDROID');
  const androidHeaders = getClientHeadersForStreamUrl(androidUrl);
  assert.equal(androidHeaders['User-Agent'], YOUTUBE_CLIENT_SIGNATURES.ANDROID.userAgent);
  assert.equal(androidHeaders.Referer, undefined);

  const iosUrl = 'https://rr1---sn.googlevideo.com/videoplayback?itag=18&c=IOS';
  assert.equal(detectYouTubeClientFromUrl(iosUrl), 'IOS');
  assert.equal(getClientHeadersForStreamUrl(iosUrl)['User-Agent'], YOUTUBE_CLIENT_SIGNATURES.IOS.userAgent);

  const webUrl = 'https://rr2---sn.googlevideo.com/videoplayback?itag=18&c=WEB';
  assert.equal(detectYouTubeClientFromUrl(webUrl), 'WEB');
  const webHeaders = getClientHeadersForStreamUrl(webUrl);
  assert.equal(webHeaders.Referer, 'https://www.youtube.com/');
  assert.equal(webHeaders.Origin, 'https://www.youtube.com');
});

test('appendPoTokenToStreamUrl appends pot parameter only once to googlevideo URLs', () => {
  const base = 'https://rr3---sn.googlevideo.com/videoplayback?itag=18&c=WEB';
  const withPot = appendPoTokenToStreamUrl(base, 'TEST_POT_123');
  assert.equal(new URL(withPot).searchParams.get('pot'), 'TEST_POT_123');

  const alreadyHas = 'https://rr3---sn.googlevideo.com/videoplayback?itag=18&pot=EXISTING';
  assert.equal(new URL(appendPoTokenToStreamUrl(alreadyHas, 'NEW_POT')).searchParams.get('pot'), 'EXISTING');

  const nonGoogle = 'https://live-stream.skynewsarabia.com/index.m3u8';
  assert.equal(appendPoTokenToStreamUrl(nonGoogle, 'TEST_POT'), nonGoogle);
});

test('getPoTokenSession mints non-empty visitorData, sessionPoToken, and contentPoToken', async () => {
  const session = await getPoTokenSession('dQw4w9WgXcQ');
  assert.ok(session.visitorData.length > 5);
  assert.ok(session.sessionPoToken.length > 10);
  assert.ok(session.contentPoToken.length > 10);
});
