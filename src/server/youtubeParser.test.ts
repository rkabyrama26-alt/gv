import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDirectYouTubeUrlId,
  extractYouTubeVideoId,
  isAllowedYouTubeMediaHost,
  parseYouTubeChannelSummary,
  parseYouTubeDuration,
  parseYouTubeVideoNode,
  scoreStreamCandidateMatch,
} from './youtubeParser.ts';

test('extractDirectYouTubeUrlId matches URLs only and never hijacks 11-char plain search text', () => {
  assert.equal(extractDirectYouTubeUrlId('https://www.youtube.com/watch?v=hVs7SdAoVHo'), 'hVs7SdAoVHo');
  assert.equal(extractDirectYouTubeUrlId('https://youtu.be/dQw4w9WgXcQ?si=123'), 'dQw4w9WgXcQ');
  assert.equal(extractDirectYouTubeUrlId('https://www.youtube.com/shorts/abcDEF_1234'), 'abcDEF_1234');
  assert.equal(extractDirectYouTubeUrlId('xboxlive123'), null);
  assert.equal(extractDirectYouTubeUrlId('مسلسل عراقي'), null);
  assert.equal(extractYouTubeVideoId('hVs7SdAoVHo'), 'hVs7SdAoVHo');
});

test('parseYouTubeDuration parses mm:ss, hh:mm:ss, and live labels', () => {
  assert.deepEqual(parseYouTubeDuration('36:24'), {
    duration: '36:24',
    durationSeconds: 2184,
    isLive: false,
  });
  assert.deepEqual(parseYouTubeDuration('1:02:05'), {
    duration: '1:02:05',
    durationSeconds: 3725,
    isLive: false,
  });
  assert.deepEqual(parseYouTubeDuration('مباشر'), {
    duration: 'مباشر',
    durationSeconds: 0,
    isLive: true,
  });
});

test('parseYouTubeVideoNode normalizes both Video and LockupView nodes cleanly', () => {
  const lockup = parseYouTubeVideoNode(
    {
      type: 'LockupView',
      content_id: 'shzpTIkTn9w',
      content_type: 'LOCKUP_CONTENT_TYPE_VIDEO',
      content_image: {
        image: [{ url: 'https://i.ytimg.com/vi/shzpTIkTn9w/hq720.jpg', width: 1280 }],
        overlays: [{ type: 'ThumbnailBottomOverlayView', badges: [{ text: '1:34' }] }],
      },
      metadata: {
        title: { text: 'أخبار الشرقية اليوم' },
        metadata: {
          metadata_rows: [
            { metadata_parts: [{ text: 'Alsharqiya Tube' }] },
            { metadata_parts: [{ text: '975' }, { text: 'قبل 13 ساعة' }] },
          ],
        },
      },
    },
    'ar',
  );

  assert.ok(lockup);
  assert.equal(lockup.id, 'shzpTIkTn9w');
  assert.equal(lockup.title, 'أخبار الشرقية اليوم');
  assert.equal(lockup.channelName, 'Alsharqiya Tube');
  assert.equal(lockup.duration, '1:34');
  assert.equal(lockup.durationSeconds, 94);
  assert.equal(lockup.publishedText, 'قبل 13 ساعة');
  assert.equal(lockup.viewsText, '975 مشاهدة');

  const classic = parseYouTubeVideoNode(
    {
      id: 'n-MbOSonWIs',
      title: { text: 'تقرير ميداني من بغداد' },
      author: {
        id: 'UC4wI0bNpRBauwbKgRaQyTVQ',
        name: 'Alsharqiya Tube',
        is_verified: true,
        thumbnails: [{ url: '//yt3.ggpht.com/avatar=s176', width: 176 }],
      },
      duration: { text: '0:39', seconds: 39 },
      short_view_count: { text: '4.1 ألف مشاهدة' },
      published: { text: 'قبل ساعة واحدة' },
      thumbnails: [{ url: 'https://i.ytimg.com/vi/n-MbOSonWIs/hq720.jpg', width: 720 }],
    },
    'ar',
  );

  assert.ok(classic);
  assert.equal(classic.channelId, 'UC4wI0bNpRBauwbKgRaQyTVQ');
  assert.equal(classic.channelAvatar, 'https://yt3.ggpht.com/avatar=s176');
  assert.equal(classic.isShort, true);
});

test('parseYouTubeChannelSummary extracts handles and subscriber counts correctly', () => {
  const ch = parseYouTubeChannelSummary({
    id: 'UC4wI0bNpRBauwbKgRaQyTVQ',
    author: {
      name: 'Alsharqiya Tube',
      is_verified: true,
      thumbnails: [{ url: '//yt3.ggpht.com/ch=s176', width: 176 }],
    },
    subscriber_count: '@AlsharqiyaTube',
    video_count: '6.27 مليون مشترك',
  });

  assert.ok(ch);
  assert.equal(ch.id, 'UC4wI0bNpRBauwbKgRaQyTVQ');
  assert.equal(ch.name, 'Alsharqiya Tube');
  assert.equal(ch.handle, '@AlsharqiyaTube');
  assert.equal(ch.subscribersText, '6.27 مليون مشترك');
  assert.equal(ch.avatar, 'https://yt3.ggpht.com/ch=s176');
});

test('scoreStreamCandidateMatch accepts true mirrors and rejects duration or topic mismatches', () => {
  const exactScore = scoreStreamCandidateMatch(
    'Bahaa Sultan - Ana Mn Gherak | 2024 | بهاء سلطان - أنا من غيرك',
    222,
    'Bahaa Sultan - Ana Mn Gherak - بهاء سلطان',
    222,
  );
  assert.ok(exactScore >= 0.7);

  const wrongYearOrDuration = scoreStreamCandidateMatch(
    'الحصاد الاخباري | 17-11-2026',
    6805,
    'الحصاد الاخباري ليوم 17 اكتوبر 2015',
    701,
  );
  assert.equal(wrongYearOrDuration, 0);

  const wrongCountryAndYear = scoreStreamCandidateMatch(
    'أفضل 10 مسلسلات عراقية جديدة 2026 تستحق المشاهدة',
    540,
    'افضل 10 مسلسلات تركية رومانسية جديدة تستحق المشاهدة 2021',
    541,
  );
  assert.equal(wrongCountryAndYear, 0);

  const wrongEpisode = scoreStreamCandidateMatch(
    'مسلسل خان الذهب الحلقة 5 كاملة',
    2400,
    'مسلسل خان الذهب الحلقة 8 كاملة',
    2400,
  );
  assert.equal(wrongEpisode, 0);

  const exactEpisode = scoreStreamCandidateMatch(
    'مسلسل خان الذهب الحلقة 5',
    2400,
    'مسلسل خان الذهب الحلقة 5',
    2405,
  );
  assert.ok(exactEpisode >= 0.85);

  assert.equal(isAllowedYouTubeMediaHost('https://rr5---sn-q4fl6nss.googlevideo.com/videoplayback'), true);
  assert.equal(isAllowedYouTubeMediaHost('https://evil.example.com/video.mp4'), false);
});
