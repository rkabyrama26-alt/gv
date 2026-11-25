import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
