import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHiddenYouTubePlayerVars } from './youtubeIframeLoader.ts';

test('buildHiddenYouTubePlayerVars hides all native YouTube controls and chrome', () => {
  const vars = buildHiddenYouTubePlayerVars('https://example.com');
  assert.equal(vars.controls, 0);
  assert.equal(vars.disablekb, 1);
  assert.equal(vars.fs, 0);
  assert.equal(vars.iv_load_policy, 3);
  assert.equal(vars.modestbranding, 1);
  assert.equal(vars.playsinline, 1);
  assert.equal(vars.rel, 0);
  assert.equal(vars.cc_load_policy, 0);
  assert.equal(vars.enablejsapi, 1);
  assert.equal(vars.origin, 'https://example.com');
});

test('buildHiddenYouTubePlayerVars ignores invalid non-http origins', () => {
  const vars = buildHiddenYouTubePlayerVars('not-a-url');
  assert.equal(vars.origin, undefined);
});
