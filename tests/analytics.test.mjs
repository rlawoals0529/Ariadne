import assert from 'node:assert/strict';
import test from 'node:test';
import { buildScanAnalytics } from '../.test-dist/analytics.js';

function result(sourceId, status, evidenceBasis, category, durationMs = 100) {
  return {
    sourceId,
    sourceName: sourceId,
    profileUrl: `https://example.com/${sourceId}`,
    category,
    nsfw: false,
    evidenceBasis,
    status,
    confidence: status === 'FOUND' || status === 'NOT_FOUND' ? 'high' : status === 'POSSIBLE' ? 'medium' : 'none',
    reason: 'test',
    httpStatus: 200,
    checkedAt: '2026-09-30T00:00:00.000Z',
    durationMs,
    signals: [],
  };
}

function report(results, sourceCount = results.length) {
  const summary = { FOUND: 0, POSSIBLE: 0, NOT_FOUND: 0, UNKNOWN: 0, BLOCKED: 0, SKIPPED: 0 };
  for (const item of results) summary[item.status] += 1;
  return {
    query: 'alice',
    kind: 'username',
    checkedAt: '2026-09-30T00:00:00.000Z',
    sourceCount,
    batchCount: results.length,
    includeNsfw: false,
    nextCursor: null,
    results,
    summary,
  };
}

test('scan analytics separate exact decisions from broad possible signals', () => {
  const analytics = buildScanAnalytics(report([
    result('github', 'FOUND', 'direct-api', 'developer', 40),
    result('codeberg', 'NOT_FOUND', 'direct-api', 'developer', 60),
    result('youtube', 'UNKNOWN', 'direct-api', 'media', 100),
    result('about', 'POSSIBLE', 'catalog-rule', 'social', 200),
    result('twitch-page', 'BLOCKED', 'catalog-rule', 'media', 300),
    result('invalid', 'SKIPPED', 'catalog-rule', 'social', 0),
  ], 10));

  assert.equal(analytics.coveragePercent, 60);
  assert.equal(analytics.attempted, 5);
  assert.equal(analytics.exactAttempted, 3);
  assert.equal(analytics.exactDecisions, 2);
  assert.equal(analytics.exactResolutionPercent, 67);
  assert.equal(analytics.verifiedMatches, 1);
  assert.equal(analytics.possibleMatches, 1);
  assert.equal(analytics.verifiedSharePercent, 50);
  assert.equal(analytics.uncertaintyPercent, 40);
  assert.equal(analytics.blockedPercent, 20);
  assert.equal(analytics.medianLatencyMs, 100);
  assert.equal(analytics.p90LatencyMs, 300);
});

test('category analytics rank by profile signals and keep found/maybe separate', () => {
  const analytics = buildScanAnalytics(report([
    result('github', 'FOUND', 'direct-api', 'developer'),
    result('gitlab', 'FOUND', 'direct-api', 'developer'),
    result('codepen', 'POSSIBLE', 'catalog-rule', 'developer'),
    result('twitch', 'FOUND', 'direct-api', 'media'),
    result('youtube-page', 'UNKNOWN', 'catalog-rule', 'media'),
  ]));

  assert.equal(analytics.categories[0].category, 'developer');
  assert.equal(analytics.categories[0].found, 2);
  assert.equal(analytics.categories[0].possible, 1);
  assert.equal(analytics.categories[1].category, 'media');
  assert.equal(analytics.categories[1].uncertain, 1);
});

test('empty or fully skipped scans avoid fabricated percentages', () => {
  const analytics = buildScanAnalytics(report([
    result('invalid', 'SKIPPED', 'catalog-rule', 'social', 0),
  ], 5));

  assert.equal(analytics.attempted, 0);
  assert.equal(analytics.exactResolutionPercent, 0);
  assert.equal(analytics.uncertaintyPercent, 0);
  assert.equal(analytics.medianLatencyMs, 0);
  assert.equal(analytics.p90LatencyMs, 0);
});
