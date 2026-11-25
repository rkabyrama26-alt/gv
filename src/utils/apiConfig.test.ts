import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStaticSearchApiUrl,
  buildStaticTrendingApiUrl,
  isStaticHostEnvironment,
  normalizeApiBaseUrl,
  resolveApiUrl,
} from './apiConfig.ts';

test('normalizeApiBaseUrl validates HTTP(S) URLs and strips trailing slashes', () => {
  assert.equal(normalizeApiBaseUrl('https://api.example.com///'), 'https://api.example.com');
  assert.equal(normalizeApiBaseUrl('http://localhost:3000/app/'), 'http://localhost:3000/app');
  assert.equal(normalizeApiBaseUrl('javascript:alert(1)'), '');
  assert.equal(normalizeApiBaseUrl('not-a-url'), '');
  assert.equal(normalizeApiBaseUrl(''), '');
});

test('resolveApiUrl keeps relative /api paths when unconfigured and prefixes configured base cleanly', () => {
  assert.equal(resolveApiUrl('/api/videos/trending', ''), '/api/videos/trending');
  assert.equal(
    resolveApiUrl('/api/videos/trending', 'https://my-server.example.com/'),
    'https://my-server.example.com/api/videos/trending',
  );
  assert.equal(
    resolveApiUrl('https://other.example.com/x', 'https://my-server.example.com'),
    'https://other.example.com/x',
  );
});

test('isStaticHostEnvironment recognizes GitHub Pages and static hostnames', () => {
  assert.equal(isStaticHostEnvironment('drama26-alt.github.io'), true);
  assert.equal(isStaticHostEnvironment('localhost'), false);
  assert.equal(isStaticHostEnvironment('127.0.0.1'), false);
});

test('buildStaticTrendingApiUrl and buildStaticSearchApiUrl build valid Dailymotion CORS URLs', () => {
  const trendingUrl = new URL(buildStaticTrendingApiUrl('tech', 'ar', 2));
  assert.equal(trendingUrl.hostname, 'api.dailymotion.com');
  assert.equal(trendingUrl.searchParams.get('page'), '2');
  assert.ok(trendingUrl.searchParams.get('search'));

  const searchUrl = new URL(
    buildStaticSearchApiUrl({
      query: 'مسلسل',
      sort: 'views',
      type: 'video',
      duration: 'long',
      page: 1,
    }),
  );
  assert.equal(searchUrl.searchParams.get('search'), 'مسلسل');
  assert.equal(searchUrl.searchParams.get('sort'), 'visited');
  assert.equal(searchUrl.searchParams.get('longer_than'), '20');
});
