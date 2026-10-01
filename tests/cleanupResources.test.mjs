import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupResourceCoverage, getCleanupResources } from '../.test-dist/cleanupResources.js';

test('cleanup resources resolve by exact and catalog source identifiers', () => {
  assert.equal(getCleanupResources('twitch', 'Twitch')?.service, 'Twitch');
  assert.equal(getCleanupResources('steam-community', 'Steam Community')?.service, 'Steam');
  assert.equal(getCleanupResources('catalog-spotify', 'Spotify')?.service, 'Spotify');
  assert.equal(getCleanupResources('catalog-x-twitter', 'X / Twitter')?.service, 'X');
});

test('cleanup resources also resolve by source name', () => {
  assert.equal(getCleanupResources('some-exact-source', 'GitHub')?.service, 'GitHub');
  assert.equal(getCleanupResources('catalog-tumblr', 'tumblr')?.service, 'Tumblr');
});

test('unknown services do not get guessed cleanup links', () => {
  assert.equal(getCleanupResources('catalog-example', 'Example Social Site'), null);
});

test('curated cleanup links are first-party https resources', () => {
  const allowedHosts = new Set([
    'docs.github.com',
    'docs.gitlab.com',
    'support.reddithelp.com',
    'help.tumblr.com',
    'help.twitch.tv',
    'help.steampowered.com',
    'support.google.com',
    'support.spotify.com',
    'help.x.com',
  ]);

  for (const entry of cleanupResourceCoverage()) {
    assert.ok(entry.resourceCount >= 1);
    assert.equal(entry.checkedAt, '2026-09-30');
  }

  for (const pair of [
    ['github', 'GitHub'],
    ['gitlab', 'GitLab'],
    ['reddit', 'Reddit'],
    ['tumblr', 'tumblr'],
    ['twitch', 'Twitch'],
    ['steam-community', 'Steam Community'],
    ['youtube', 'YouTube'],
    ['catalog-spotify', 'Spotify'],
    ['catalog-x-twitter', 'X / Twitter'],
  ]) {
    const resourceSet = getCleanupResources(pair[0], pair[1]);
    assert.ok(resourceSet);
    for (const resource of resourceSet.resources) {
      const url = new URL(resource.url);
      assert.equal(url.protocol, 'https:');
      assert.ok(allowedHosts.has(url.hostname), resource.url);
    }
  }
});
