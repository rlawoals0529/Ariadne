import assert from 'node:assert/strict';
import test from 'node:test';

import { extendedCatalogSources } from '../.test-dist/worker/extendedCatalog.js';
import { exactSources } from '../.test-dist/worker/exactSources.js';
import { searchableSourceStats, selectSources } from '../.test-dist/worker/search.js';

function normalized(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

test('expanded source selection stays unique, public, and HTTPS', () => {
  const selected = selectSources(false, {});
  const ids = selected.map((source) => source.id);
  const names = selected.map((source) => normalized(source.name));

  assert.equal(new Set(ids).size, ids.length, 'source IDs must stay unique');
  assert.equal(new Set(names).size, names.length, 'selected source names must stay unique after broad/exact replacements');

  for (const source of selected) {
    const profile = source.profileUrl('ariadne_audit');
    assert.match(profile, /^https:\/\//, `${source.name} profile URL must use HTTPS`);
    assert.equal(source.nsfw, false, `${source.name} leaked into the standard source selection`);
  }
});

test('source expansion keeps prohibited side-channel targets out of search', () => {
  const selectedNames = new Set(selectSources(true, {}).map((source) => normalized(source.name)));
  const prohibited = [
    'BreachSta.rs Forum',
    'HudsonRock',
    'CashApp',
    'Venmo',
    'Discord',
    'Slack',
    'Signal',
  ];

  for (const name of prohibited) {
    assert.equal(selectedNames.has(normalized(name)), false, `${name} should not be a searchable Ariadne source`);
  }
});

test('coverage expansion materially increases standard and exact checks', () => {
  const stats = searchableSourceStats({});
  assert.ok(stats.standard >= 185, `expected at least 185 standard sources, got ${stats.standard}`);
  assert.ok(stats.direct >= 28, `expected at least 28 direct/exact sources, got ${stats.direct}`);
  assert.ok(exactSources.length >= 19, `expected at least 19 exact source definitions, got ${exactSources.length}`);
  assert.ok(extendedCatalogSources.length >= 89, `expected at least 89 extended public-profile rules, got ${extendedCatalogSources.length}`);
});

test('broad status-code sources do not treat generic redirects as a possible match', async () => {
  const source = extendedCatalogSources.find((item) => item.name === 'Coderwall');
  assert.ok(source, 'Coderwall source missing');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const response = new Response('<html><body>homepage</body></html>', { status: 200 });
    Object.defineProperty(response, 'url', { value: 'https://coderwall.com/', configurable: true });
    Object.defineProperty(response, 'redirected', { value: true, configurable: true });
    return response;
  };

  try {
    const checked = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(checked.verdict.status, 'UNKNOWN');
    assert.match(checked.verdict.reason, /profile-specific evidence/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('broad successful responses with empty bodies stay uncertain', async () => {
  const source = extendedCatalogSources.find((item) => item.name === 'Coderwall');
  assert.ok(source, 'Coderwall source missing');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const response = new Response('', { status: 200 });
    Object.defineProperty(response, 'url', { value: 'https://coderwall.com/ariadne_audit', configurable: true });
    return response;
  };

  try {
    const checked = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(checked.verdict.status, 'UNKNOWN');
    assert.match(checked.verdict.reason, /profile-specific evidence/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ordinary broad positives remain Maybe rather than Found', async () => {
  const source = extendedCatalogSources.find((item) => item.name === 'Coderwall');
  assert.ok(source, 'Coderwall source missing');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const response = new Response('<html><body>ariadne_audit profile</body></html>', { status: 200 });
    Object.defineProperty(response, 'url', { value: 'https://coderwall.com/ariadne_audit', configurable: true });
    return response;
  };

  try {
    const checked = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(checked.verdict.status, 'POSSIBLE');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
