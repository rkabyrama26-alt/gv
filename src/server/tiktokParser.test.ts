import test from 'node:test';
import assert from 'node:assert/strict';
import type { TikTokReel } from '../shared/types.ts';
import {
  detectQueryCategories,
  formatCompactCount,
  formatReelDuration,
  parseTikTokFeedList,
  parseTikTokItem,
  searchTikTokPool,
} from './tiktokParser.ts';

test('formatReelDuration formats seconds cleanly', () => {
  assert.equal(formatReelDuration(29), '0:29');
  assert.equal(formatReelDuration(75), '1:15');
  assert.equal(formatReelDuration(-5), '0:00');
});

test('formatCompactCount formats thousands and millions for Arabic and English', () => {
  assert.equal(formatCompactCount(450, 'ar'), '450');
  assert.equal(formatCompactCount(12400, 'en'), '12K');
  assert.equal(formatCompactCount(12500, 'en'), '13K');
  assert.equal(formatCompactCount(1400000, 'ar'), '1.4 مليون');
  assert.equal(formatCompactCount(28000000, 'en'), '28M');
});

test('parseTikTokItem normalizes valid item with proxied stream and cover URLs', () => {
  const parsed = parseTikTokItem(
    {
      id: '7706881841487187218',
      desc: 'مقطع رائع #تيك_توك',
      author: {
        uniqueId: 'creator_one',
        nickname: 'Creator One',
        verified: true,
        avatarThumb: 'https://cdn.example.com/avatar.jpg',
      },
      video: {
        duration: 29,
        playAddr: 'https://v16.tiktokcdn.com/video.mp4',
        cover: 'https://p16.tiktokcdn.com/cover.jpg',
      },
      stats: {
        diggCount: 1500,
        commentCount: 42,
        shareCount: 18,
        playCount: 95000,
      },
      music: {
        title: 'Original Sound',
        authorName: 'Artist',
      },
    },
    'music',
  );

  assert.ok(parsed);
  assert.equal(parsed.reel.id, '7706881841487187218');
  assert.equal(parsed.reel.authorHandle, '@creator_one');
  assert.equal(parsed.reel.authorVerified, true);
  assert.equal(parsed.reel.streamUrl, '/api/tiktok/stream/7706881841487187218');
  assert.equal(parsed.reel.coverUrl, '/api/tiktok/cover/7706881841487187218');
  assert.equal(parsed.reel.authorAvatar, '/api/tiktok/avatar/7706881841487187218');
  assert.equal(parsed.reel.duration, '0:29');
  assert.equal(parsed.reel.category, 'music');
  assert.equal(parsed.upstreamPlayUrl, 'https://v16.tiktokcdn.com/video.mp4');
});

test('parseTikTokFeedList deduplicates and skips items without valid stream URL', () => {
  const list = parseTikTokFeedList([
    {
      id: '111',
      video: { playAddr: 'https://v16.tiktokcdn.com/111.mp4', duration: 15 },
    },
    {
      id: '111',
      video: { playAddr: 'https://v16.tiktokcdn.com/111-dup.mp4', duration: 15 },
    },
    {
      id: '222',
      video: { duration: 10 },
    },
  ]);

  assert.equal(list.length, 1);
  assert.equal(list[0].reel.id, '111');
});

test('searchTikTokPool ranks direct caption/author matches first and supports Arabic topic queries', () => {
  const samplePool: TikTokReel[] = [
    {
      id: '1',
      caption: 'Epic goal in football match',
      authorName: 'Sports Pro',
      authorHandle: '@sportspro',
      authorVerified: false,
      coverUrl: '/api/tiktok/cover/1',
      streamUrl: '/api/tiktok/stream/1',
      durationSeconds: 15,
      duration: '0:15',
      likesCount: 100,
      commentsCount: 5,
      sharesCount: 2,
      viewsCount: 5000,
      category: 'sports',
    },
    {
      id: '2',
      caption: 'Funny cat video',
      authorName: 'Comedy Club',
      authorHandle: '@funnycat',
      authorVerified: false,
      coverUrl: '/api/tiktok/cover/2',
      streamUrl: '/api/tiktok/stream/2',
      durationSeconds: 12,
      duration: '0:12',
      likesCount: 900,
      commentsCount: 20,
      sharesCount: 10,
      viewsCount: 40000,
      category: 'comedy',
    },
  ];

  assert.deepEqual(detectQueryCategories('رياضة'), ['sports']);
  const arSports = searchTikTokPool(samplePool, 'رياضة');
  assert.ok(arSports.length >= 1);
  assert.equal(arSports[0].id, '1');

  const exactMatch = searchTikTokPool(samplePool, 'funnycat');
  assert.ok(exactMatch.length >= 1);
  assert.equal(exactMatch[0].id, '2');

  const anyGlobal = searchTikTokPool(samplePool, 'zxq_uncommon_query');
  assert.ok(anyGlobal.length >= 1);
});
