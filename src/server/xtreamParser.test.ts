import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterAndRankXtreamItems,
  formatXtreamPosterUrl,
  isSafeXtreamImageUrl,
  isValidXtreamNumericId,
  parseXtreamCategories,
  parseXtreamMoviesList,
  parseXtreamSeriesInfo,
  parseXtreamSeriesList,
} from './xtreamParser.ts';

test('isValidXtreamNumericId accepts numeric IDs and rejects path/query tampering', () => {
  assert.equal(isValidXtreamNumericId('305461'), true);
  assert.equal(isValidXtreamNumericId('6471'), true);
  assert.equal(isValidXtreamNumericId('../etc'), false);
  assert.equal(isValidXtreamNumericId('123?foo=bar'), false);
  assert.equal(isValidXtreamNumericId(''), false);
});

test('isSafeXtreamImageUrl allows TMDB and configured host while blocking loopback/private IPs', () => {
  assert.equal(isSafeXtreamImageUrl('https://image.tmdb.org/t/p/w220/abc.jpg'), true);
  assert.equal(isSafeXtreamImageUrl('http://cl4512.life/images/poster.jpg', 'cl4512.life'), true);
  assert.equal(isSafeXtreamImageUrl('http://127.0.0.1/secret.jpg', 'cl4512.life'), false);
  assert.equal(isSafeXtreamImageUrl('http://169.254.169.254/latest/meta-data', 'cl4512.life'), false);
  assert.equal(isSafeXtreamImageUrl('http://192.168.1.1/admin.png', 'cl4512.life'), false);
  assert.equal(isSafeXtreamImageUrl('javascript:alert(1)', 'cl4512.life'), false);
});

test('formatXtreamPosterUrl keeps HTTPS URLs direct and proxies safe HTTP URLs', () => {
  assert.equal(
    formatXtreamPosterUrl('https://image.tmdb.org/t/p/w220/poster.jpg', 'cl4512.life'),
    'https://image.tmdb.org/t/p/w220/poster.jpg',
  );
  assert.equal(
    formatXtreamPosterUrl('http://cl4512.life/images/p.jpg', 'cl4512.life'),
    '/api/xtream/image?u=http%3A%2F%2Fcl4512.life%2Fimages%2Fp.jpg',
  );
  assert.equal(formatXtreamPosterUrl('http://localhost/evil.jpg', 'cl4512.life'), '');
});

test('parseXtreamCategories, Series, Movies, and SeriesInfo normalize items with server stream routes', () => {
  const cats = parseXtreamCategories([
    { category_id: '49', category_name: 'AR\u2725\uFFFD DAILY   مسلسلات   عربية' },
    { category_id: '', category_name: 'Invalid' },
  ]);
  assert.equal(cats.length, 1);
  assert.equal(cats[0].name, 'AR DAILY مسلسلات عربية');

  const series = parseXtreamSeriesList([
    { series_id: 6471, name: 'حب أسود', category_id: '49', rating: '8.4', cover: 'https://image.tmdb.org/t/p/w220/a.jpg' },
    { series_id: 'bad', name: 'Ignored' },
  ]);
  assert.equal(series.length, 1);
  assert.equal(series[0].id, '6471');
  assert.equal(series[0].rating, '8.4');

  const movies = parseXtreamMoviesList([
    { stream_id: 306598, name: 'فيلم جديد', category_id: '441', container_extension: 'mp4' },
  ]);
  assert.equal(movies.length, 1);
  assert.equal(movies[0].streamUrl, '/api/xtream/stream/movie/306598');

  const details = parseXtreamSeriesInfo('6471', {
    info: { name: 'حب أسود', category_id: '49', backdrop_path: ['https://image.tmdb.org/t/p/w780/bg.jpg'] },
    episodes: {
      '1': [
        { id: 298035, episode_num: 2, title: 'الحلقة 2', container_extension: 'mp4' },
        { id: 298034, episode_num: 1, title: 'الحلقة 1', container_extension: 'mp4' },
      ],
    },
  });
  assert.ok(details);
  assert.equal(details.seasons.length, 1);
  assert.equal(details.seasons[0].episodes[0].episodeNum, 1);
  assert.equal(details.seasons[0].episodes[0].streamUrl, '/api/xtream/stream/series/298034');
});

test('filterAndRankXtreamItems handles Arabic normalization and exact prefix priority', () => {
  const list = [
    { name: 'مسلسل البيت الكبير', categoryId: '49' },
    { name: 'الكبير اوي 8', categoryId: '49' },
    { name: 'أكشن سريع', categoryId: '51' },
  ];
  const arMatches = filterAndRankXtreamItems(list, 'all', 'الكبير');
  assert.equal(arMatches.length, 2);
  assert.equal(arMatches[0].name, 'الكبير اوي 8');

  const catMatches = filterAndRankXtreamItems(list, '51', '');
  assert.equal(catMatches.length, 1);
  assert.equal(catMatches[0].name, 'أكشن سريع');
});

test('parseClockDurationToSeconds parses HH:MM:SS, MM:SS, and numeric seconds', async () => {
  const { parseClockDurationToSeconds } = await import('./xtreamParser.ts');
  assert.equal(parseClockDurationToSeconds('01:29:03'), 5343);
  assert.equal(parseClockDurationToSeconds('46:14'), 2774);
  assert.equal(parseClockDurationToSeconds('5343'), 5343);
  assert.equal(parseClockDurationToSeconds('00:00:00'), undefined);
  assert.equal(parseClockDurationToSeconds('invalid'), undefined);
});
