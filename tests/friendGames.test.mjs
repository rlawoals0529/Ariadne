import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFriendMetrics } from '../.test-dist/friendGames.js';

function result(sourceId, sourceName, status, category = 'social') {
  return {
    sourceId,
    sourceName,
    profileUrl: `https://example.com/${sourceId}`,
    category,
    nsfw: false,
    evidenceBasis: status === 'FOUND' ? 'direct-api' : 'catalog-rule',
    status,
    confidence: status === 'FOUND' ? 'high' : status === 'POSSIBLE' ? 'medium' : 'none',
    reason: 'test',
    httpStatus: 200,
    checkedAt: '2026-09-30T00:00:00.000Z',
    durationMs: 1,
    signals: [],
  };
}

function report(query, results) {
  const summary = { FOUND: 0, POSSIBLE: 0, NOT_FOUND: 0, UNKNOWN: 0, BLOCKED: 0, SKIPPED: 0 };
  for (const item of results) summary[item.status] += 1;
  return {
    query,
    kind: 'username',
    checkedAt: '2026-09-30T00:00:00.000Z',
    sourceCount: results.length,
    batchCount: results.length,
    includeNsfw: false,
    nextCursor: null,
    results,
    summary,
  };
}

test('friend metrics keep found and maybe separate', () => {
  const metrics = buildFriendMetrics([
    report('alice', [result('github', 'GitHub', 'FOUND', 'developer'), result('twitch', 'Twitch', 'POSSIBLE', 'media')]),
    report('bob', [result('github', 'GitHub', 'FOUND', 'developer'), result('twitch', 'Twitch', 'POSSIBLE', 'media')]),
  ]);

  assert.equal(metrics.participants[0].confirmed, 1);
  assert.equal(metrics.participants[0].possible, 1);
  assert.deepEqual(metrics.verifiedShared, ['GitHub']);
  assert.deepEqual(metrics.everyoneSites, ['GitHub', 'Twitch']);
  assert.deepEqual(metrics.verifiedEveryoneSites, ['GitHub']);
});

test('internet twins use overlap percentage instead of only raw count', () => {
  const metrics = buildFriendMetrics([
    report('alice', [result('a', 'A', 'FOUND'), result('b', 'B', 'POSSIBLE')]),
    report('bob', [result('a', 'A', 'FOUND'), result('b', 'B', 'POSSIBLE')]),
    report('charlie', [result('a', 'A', 'FOUND'), result('c', 'C', 'POSSIBLE'), result('d', 'D', 'POSSIBLE')]),
  ]);

  assert.deepEqual(metrics.internetTwins?.names, ['alice', 'bob']);
  assert.equal(metrics.internetTwins?.similarity, 100);
  assert.deepEqual(metrics.mostDifferentPair?.names, ['alice', 'charlie']);
});

test('unique paths and shared category games are factual scan counts', () => {
  const metrics = buildFriendMetrics([
    report('alice', [result('github', 'GitHub', 'FOUND', 'developer'), result('codepen', 'CodePen', 'POSSIBLE', 'developer')]),
    report('bob', [result('github', 'GitHub', 'FOUND', 'developer')]),
    report('charlie', [result('bandcamp', 'Bandcamp', 'POSSIBLE', 'media')]),
  ]);

  assert.ok(metrics.mostUnique.includes('alice'));
  assert.ok(metrics.mostUnique.includes('charlie'));
  assert.deepEqual(metrics.categoryPair?.names, ['alice', 'bob']);
  assert.equal(metrics.categoryPair?.topCategory, 'developer');
  assert.equal(metrics.categoryPair?.topCategoryCount, 1);
});


test('shared source details preserve each person\'s Found and Maybe status', () => {
  const metrics = buildFriendMetrics([
    report('alice', [
      result('github', 'GitHub', 'FOUND', 'developer'),
      result('reddit', 'Reddit', 'POSSIBLE', 'community'),
    ]),
    report('bob', [
      result('github', 'GitHub', 'POSSIBLE', 'developer'),
      result('reddit', 'Reddit', 'FOUND', 'community'),
    ]),
    report('charlie', [
      result('github', 'GitHub', 'FOUND', 'developer'),
      result('twitch', 'Twitch', 'FOUND', 'media'),
    ]),
  ]);

  assert.equal(metrics.sharedDetails.length, 2);
  assert.equal(metrics.sharedDetails[0].sourceName, 'GitHub');
  assert.equal(metrics.sharedDetails[0].participantCount, 3);
  assert.equal(metrics.sharedDetails[0].foundCount, 2);
  assert.equal(metrics.sharedDetails[0].possibleCount, 1);
  assert.deepEqual(metrics.sharedDetails[0].statuses, [
    { query: 'alice', status: 'FOUND' },
    { query: 'bob', status: 'POSSIBLE' },
    { query: 'charlie', status: 'FOUND' },
  ]);
  assert.equal(metrics.sharedDetails[1].sourceName, 'Reddit');
  assert.equal(metrics.sharedDetails[1].participantCount, 2);
});
