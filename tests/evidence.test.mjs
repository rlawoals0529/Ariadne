import assert from 'node:assert/strict';
import test from 'node:test';
import { apiIdentityVerdict, classifyHttpFailure } from '../.test-dist/worker/evidence.js';
import { sources, sourceStats } from '../.test-dist/worker/sources.js';
import { searchableSourceStats, selectSources } from '../.test-dist/worker/search.js';

test('found requires an identifier match', () => {
  const verdict = apiIdentityVerdict({ httpStatus: 200, expected: 'alice', actual: 'Alice' });
  assert.equal(verdict.status, 'FOUND');
  assert.equal(verdict.confidence, 'high');
});

test('case-sensitive sources do not normalize identity mismatches', () => {
  const verdict = apiIdentityVerdict({ httpStatus: 200, expected: 'alice', actual: 'Alice', caseSensitive: true });
  assert.equal(verdict.status, 'UNKNOWN');
});

test('200 with a different identity is unknown, never found', () => {
  const verdict = apiIdentityVerdict({ httpStatus: 200, expected: 'alice', actual: 'bob' });
  assert.equal(verdict.status, 'UNKNOWN');
});

test('explicit missing API response is not found', () => {
  const verdict = apiIdentityVerdict({ httpStatus: 200, expected: 'alice', missing: true });
  assert.equal(verdict.status, 'NOT_FOUND');
});

test('rate limiting is blocked, never absence', () => {
  const verdict = classifyHttpFailure(429);
  assert.equal(verdict?.status, 'BLOCKED');
});

test('upstream server errors stay unknown', () => {
  const verdict = classifyHttpFailure(503);
  assert.equal(verdict?.status, 'UNKNOWN');
});

test('wide catalog is substantial and NSFW stays opt-in', () => {
  const searchable = searchableSourceStats();
  assert.ok(searchable.total >= 120, `expected at least 120 searchable sources, got ${searchable.total}`);
  assert.ok(searchable.standard >= 100, `expected at least 100 standard sources, got ${searchable.standard}`);
  assert.ok(sourceStats.nsfw >= 15, `expected at least 15 NSFW sources, got ${sourceStats.nsfw}`);
  assert.ok(searchable.direct >= 6, `expected at least 6 direct adapters, got ${searchable.direct}`);
  assert.equal(selectSources(false).some((source) => source.nsfw), false);
  assert.equal(selectSources(true).filter((source) => source.nsfw).length, searchable.nsfw);
  assert.ok(sources.some((source) => source.id === 'anilist'), 'AniList direct adapter should exist');
  assert.ok(sources.some((source) => source.id === 'catalog-pinterest'), 'Pinterest catalog source should exist');
});

test('Sherlock-derived rules never become confirmed solely from a 200', async (t) => {
  const source = sources.find((item) => item.id === 'catalog-about-me');
  assert.ok(source, 'About.me catalog source should exist');
  const originalFetch = globalThis.fetch;

  try {
    await t.test('200 becomes possible', async () => {
      globalThis.fetch = async () => new Response('<html><title>profile</title></html>', { status: 200 });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'POSSIBLE');
      assert.equal(result.verdict.confidence, 'medium');
    });

    await t.test('404 becomes not found', async () => {
      globalThis.fetch = async () => new Response('missing', { status: 404 });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'NOT_FOUND');
    });

    await t.test('challenge pages become blocked', async () => {
      globalThis.fetch = async () => new Response('<title>Just a moment...</title><div class="cf-chl-test"></div>', { status: 200 });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'BLOCKED');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('extended catalog positives remain possible', async () => {
  const source = sources.find((item) => item.id === 'catalog-9gag');
  assert.ok(source, '9GAG extended catalog source should exist');
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('<html><title>profile</title></html>', { status: 200 });
    const result = await source.probe('exampleuser', new AbortController().signal);
    assert.equal(result.verdict.status, 'POSSIBLE');
    assert.notEqual(result.verdict.status, 'FOUND');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
