import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCleanupChecklistMarkdown, cleanupChecklistFilename } from '../.test-dist/cleanupExport.js';

function result(sourceId, sourceName, status = 'FOUND', profileUrl = 'https://example.com/profile') {
  return {
    sourceId,
    sourceName,
    category: 'social',
    status,
    evidenceBasis: status === 'FOUND' ? 'direct-api' : 'catalog-rule',
    profileUrl,
    nsfw: false,
    confidence: status === 'FOUND' ? 'high' : 'medium',
    reason: 'fixture',
    checkedAt: '2026-09-30T20:00:00.000Z',
    durationMs: 50,
    signals: [],
  };
}

function report(results) {
  return {
    query: 'Alice_Test',
    kind: 'username',
    checkedAt: '2026-09-30T20:00:00.000Z',
    sourceCount: results.length,
    batchCount: results.length,
    includeNsfw: false,
    nextCursor: null,
    results,
    summary: { FOUND: 1, POSSIBLE: 1, NOT_FOUND: 0, UNKNOWN: 0, BLOCKED: 0, SKIPPED: 0 },
  };
}

test('cleanup export includes only Mine cleanup and done decisions', () => {
  const data = report([
    result('github', 'GitHub', 'FOUND', 'https://github.com/alice'),
    result('reddit', 'Reddit', 'POSSIBLE', 'https://reddit.com/u/alice'),
    result('twitch', 'Twitch', 'FOUND', 'https://twitch.tv/alice'),
    result('other', 'Other Site', 'POSSIBLE', 'https://example.com/alice'),
  ]);
  const reviews = {
    github: { ownership: 'mine', action: 'cleanup', updatedAt: 'x' },
    reddit: { ownership: 'mine', action: 'done', updatedAt: 'x' },
    twitch: { ownership: 'mine', action: 'keep', updatedAt: 'x' },
    other: { ownership: 'unsure', updatedAt: 'x' },
  };

  const markdown = buildCleanupChecklistMarkdown(data, reviews, '2026-09-30T22:00:00.000Z');

  assert.match(markdown, /\- \[ \] GitHub — Clean up/);
  assert.match(markdown, /\- \[x\] Reddit — Done/);
  assert.doesNotMatch(markdown, /Twitch/);
  assert.doesNotMatch(markdown, /Other Site/);
  assert.match(markdown, /docs\.github\.com/);
  assert.match(markdown, /support\.reddithelp\.com/);
  assert.match(markdown, /Evidence: Found/);
  assert.match(markdown, /Evidence: Maybe/);
});

test('unsupported cleanup selections get an honest no-curated-guide note', () => {
  const data = report([result('unknown', 'Unknown Social', 'POSSIBLE')]);
  const reviews = { unknown: { ownership: 'mine', action: 'cleanup', updatedAt: 'x' } };
  const markdown = buildCleanupChecklistMarkdown(data, reviews);

  assert.match(markdown, /No curated guide in Ariadne yet/);
});

test('empty actionable state is explicit', () => {
  const data = report([result('github', 'GitHub')]);
  const reviews = { github: { ownership: 'mine', action: 'keep', updatedAt: 'x' } };
  const markdown = buildCleanupChecklistMarkdown(data, reviews);

  assert.match(markdown, /No cleanup items are currently selected/);
});

test('cleanup checklist filename is local and filesystem-safe', () => {
  assert.equal(cleanupChecklistFilename(' Alice_Test '), 'ariadne-cleanup-alice_test.md');
  assert.equal(cleanupChecklistFilename('weird / name'), 'ariadne-cleanup-weird-name.md');
});
