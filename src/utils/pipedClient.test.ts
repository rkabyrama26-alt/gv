import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPipedChannelId,
  extractPipedVideoId,
  formatPipedCompactNumber,
  formatPipedRelativeDate,
  parsePipedVideoItem,
  unwrapPipedImageUrl,
} from './pipedClient.ts';

test('extractPipedVideoId and extractPipedChannelId parse Piped paths cleanly', () => {
  assert.equal(extractPipedVideoId('/watch?v=smMWx7yrVUw'), 'smMWx7yrVUw');
  assert.equal(extractPipedVideoId('/shorts/abcDEF12345'), 'abcDEF12345');
  assert.equal(extractPipedChannelId('/channel/UCDOT06o6rEy0KK93KLIynEQ'), 'UCDOT06o6rEy0KK93KLIynEQ');
});

test('unwrapPipedImageUrl rewrites Piped proxy URLs to direct YouTube CDN URLs', () => {
  assert.equal(
    unwrapPipedImageUrl(
      'https://proxy.piped.private.coffee/vi/smMWx7yrVUw/hq720.jpg?host=i.ytimg.com&rs=123&v=1',
      'smMWx7yrVUw',
    ),
    'https://i.ytimg.com/vi/smMWx7yrVUw/hqdefault.jpg',
  );
  assert.equal(
    unwrapPipedImageUrl(
      'https://proxy.piped.private.coffee/ytc/avatar123=s68?host=yt3.ggpht.com',
    ),
    'https://yt3.ggpht.com/ytc/avatar123=s68',
  );
});

test('parsePipedVideoItem maps Piped stream JSON into authentic MediaVideo with YouTube ID', () => {
  const parsed = parsePipedVideoItem(
    {
      url: '/watch?v=smMWx7yrVUw',
      type: 'stream',
      title: 'مسلسل الدراما السوري الحلقة 1',
      thumbnail: 'https://proxy.piped.private.coffee/vi/smMWx7yrVUw/hq720.jpg?host=i.ytimg.com',
      uploaderName: 'Frame House Media',
      uploaderUrl: '/channel/UCDOT06o6rEy0KK93KLIynEQ',
      uploaderAvatar: 'https://proxy.piped.private.coffee/abc?host=yt3.ggpht.com',
      uploadedDate: '2 days ago',
      duration: 2658,
      views: 788023,
    },
    'ar',
  );

  assert.ok(parsed);
  assert.equal(parsed.id, 'smMWx7yrVUw');
  assert.equal(parsed.channelId, 'UCDOT06o6rEy0KK93KLIynEQ');
  assert.equal(parsed.duration, '44:18');
  assert.equal(parsed.thumbnail, 'https://i.ytimg.com/vi/smMWx7yrVUw/hqdefault.jpg');
  assert.equal(parsed.channelAvatar, 'https://yt3.ggpht.com/abc');
  assert.equal(parsed.publishedText, 'قبل 2 أيام');
  assert.equal(formatPipedCompactNumber(788023, 'ar'), '788 ألف');
  assert.equal(formatPipedRelativeDate('1 month ago', 'ar'), 'قبل 1 شهر');
});
