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
  assert.ok(stats.standard >= 329, `expected at least 329 standard sources, got ${stats.standard}`);
  assert.ok(stats.direct >= 65, `expected at least 65 direct/exact sources, got ${stats.direct}`);
  assert.ok(exactSources.length >= 56, `expected at least 56 exact source definitions, got ${exactSources.length}`);
  assert.ok(extendedCatalogSources.length >= 224, `expected at least 224 extended public-profile rules, got ${extendedCatalogSources.length}`);
});

test('wide scans prioritize direct evidence before broad catalog checks', () => {
  const selected = selectSources(false, {});
  const firstThirty = selected.slice(0, 30);
  const directFirst = firstThirty.filter((source) => !source.id.startsWith('catalog-')).length;
  assert.equal(directFirst, 30, `expected the first result batch to be entirely direct checks, got ${directFirst} direct sources`);
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


test('new exact adapters require canonical username evidence', async () => {
  const cases = [
    {
      name: 'TETR.IO',
      response: () => new Response(JSON.stringify({ success: true, data: { username: 'ariadne_audit' } }), { status: 200 }),
    },
    {
      name: 'RubyGems',
      response: () => new Response(JSON.stringify({ handle: 'ariadne_audit' }), { status: 200 }),
    },
    {
      name: 'Gravatar',
      response: () => new Response(JSON.stringify({ profile_url: 'https://gravatar.com/ariadne_audit' }), { status: 200 }),
    },
    {
      name: 'LemmyWorld',
      response: () => new Response(JSON.stringify({ person_view: { person: { name: 'ariadne_audit' } } }), { status: 200 }),
    },
  ];

  const originalFetch = globalThis.fetch;
  try {
    for (const item of cases) {
      const source = exactSources.find((candidate) => candidate.name === item.name);
      assert.ok(source, `${item.name} exact source missing`);
      globalThis.fetch = async () => item.response();
      const checked = await source.probe('ariadne_audit', new AbortController().signal);
      assert.equal(checked.verdict.status, 'FOUND', `${item.name} should accept a matching canonical identifier`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('new exact adapters keep identifier mismatches uncertain', async () => {
  const cases = [
    ['TETR.IO', { success: true, data: { username: 'someone_else' } }],
    ['RubyGems', { handle: 'someone_else' }],
    ['Gravatar', { profile_url: 'https://gravatar.com/someone_else' }],
    ['LemmyWorld', { person_view: { person: { name: 'someone_else' } } }],
  ];

  const originalFetch = globalThis.fetch;
  try {
    for (const [name, payload] of cases) {
      const source = exactSources.find((candidate) => candidate.name === name);
      assert.ok(source, `${name} exact source missing`);
      globalThis.fetch = async () => new Response(JSON.stringify(payload), { status: 200 });
      const checked = await source.probe('ariadne_audit', new AbortController().signal);
      assert.equal(checked.verdict.status, 'UNKNOWN', `${name} must not confirm a mismatched identifier`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('SourceForge exact adapter requires the returned username', async () => {
  const source = exactSources.find((candidate) => candidate.name === 'SourceForge');
  assert.ok(source, 'SourceForge exact source missing');

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ username: 'ariadne_audit' }), { status: 200 });
    const found = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(found.verdict.status, 'FOUND');

    globalThis.fetch = async () => new Response(JSON.stringify({ username: 'someone_else' }), { status: 200 });
    const mismatch = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(mismatch.verdict.status, 'UNKNOWN');

    globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 404 });
    const missing = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(missing.verdict.status, 'NOT_FOUND');
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('Gitee exact adapter requires the canonical login', async () => {
  const source = exactSources.find((candidate) => candidate.name === 'Gitee');
  assert.ok(source, 'Gitee exact source missing');

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ login: 'ariadne_audit' }), { status: 200 });
    const found = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(found.verdict.status, 'FOUND');

    globalThis.fetch = async () => new Response(JSON.stringify({ login: 'someone_else' }), { status: 200 });
    const mismatch = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(mismatch.verdict.status, 'UNKNOWN');

    globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 404 });
    const missing = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(missing.verdict.status, 'NOT_FOUND');
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('weak status-only positives need username evidence in the response body', async () => {
  const source = extendedCatalogSources.find((item) => item.name === 'Coderwall');
  assert.ok(source, 'Coderwall source missing');

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      const response = new Response('<html><body>generic profile shell</body></html>', { status: 200 });
      Object.defineProperty(response, 'url', { value: 'https://coderwall.com/ariadne_audit', configurable: true });
      return response;
    };
    const weak = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(weak.verdict.status, 'UNKNOWN');

    globalThis.fetch = async () => {
      const response = new Response('<html><body>Profile for ariadne_audit</body></html>', { status: 200 });
      Object.defineProperty(response, 'url', { value: 'https://coderwall.com/ariadne_audit', configurable: true });
      return response;
    };
    const supported = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(supported.verdict.status, 'POSSIBLE');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Gitea exact adapter requires canonical login evidence', async () => {
  const source = exactSources.find((candidate) => candidate.name === 'Gitea');
  assert.ok(source, 'Gitea exact source missing');

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ login: 'ariadne_audit' }), { status: 200 });
    const found = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(found.verdict.status, 'FOUND');

    globalThis.fetch = async () => new Response(JSON.stringify({ login: 'someone_else' }), { status: 200 });
    const mismatch = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(mismatch.verdict.status, 'UNKNOWN');
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('Discourse exact adapters require canonical usernames', async () => {
  const source = exactSources.find((candidate) => candidate.name === 'Leasehackr');
  assert.ok(source, 'Leasehackr Discourse exact source missing');

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ user: { username: 'ariadne_audit' } }), { status: 200 });
    const found = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(found.verdict.status, 'FOUND');

    globalThis.fetch = async () => new Response(JSON.stringify({ user: { username: 'someone_else' } }), { status: 200 });
    const mismatch = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(mismatch.verdict.status, 'UNKNOWN');

    globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 404 });
    const missing = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(missing.verdict.status, 'NOT_FOUND');

    globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 403 });
    const blocked = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(blocked.verdict.status, 'BLOCKED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('programming.dev exact adapter requires canonical Lemmy person name', async () => {
  const source = exactSources.find((candidate) => candidate.name === 'programming.dev');
  assert.ok(source, 'programming.dev exact source missing');

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ person_view: { person: { name: 'ariadne_audit' } } }), { status: 200 });
    const found = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(found.verdict.status, 'FOUND');

    globalThis.fetch = async () => new Response(JSON.stringify({ person_view: { person: { name: 'someone_else' } } }), { status: 200 });
    const mismatch = await source.probe('ariadne_audit', new AbortController().signal);
    assert.equal(mismatch.verdict.status, 'UNKNOWN');
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('third-pass exact adapters require canonical username evidence', async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    {
      name: 'GNOME VCS',
      found: [{ username: 'ariadne_audit' }],
      mismatch: [{ username: 'someone_else' }],
      missing: [],
    },
    {
      name: 'NotABug.org',
      found: { login: 'ariadne_audit' },
      mismatch: { login: 'someone_else' },
      missingStatus: 404,
    },
    {
      name: 'Freelancer',
      found: { result: { users: { '1': { username: 'ariadne_audit' } } } },
      mismatch: { result: { users: { '1': { username: 'someone_else' } } } },
      missing: { result: { users: {} } },
    },
  ];

  try {
    for (const item of cases) {
      const source = exactSources.find((candidate) => candidate.name === item.name);
      assert.ok(source, `${item.name} exact source missing`);

      globalThis.fetch = async () => new Response(JSON.stringify(item.found), { status: 200 });
      const found = await source.probe('ariadne_audit', new AbortController().signal);
      assert.equal(found.verdict.status, 'FOUND', `${item.name} should accept its canonical username`);

      globalThis.fetch = async () => new Response(JSON.stringify(item.mismatch), { status: 200 });
      const mismatch = await source.probe('ariadne_audit', new AbortController().signal);
      assert.equal(mismatch.verdict.status, 'UNKNOWN', `${item.name} must reject a mismatched identifier`);

      if ('missingStatus' in item) {
        globalThis.fetch = async () => new Response(JSON.stringify({}), { status: item.missingStatus });
      } else {
        globalThis.fetch = async () => new Response(JSON.stringify(item.missing), { status: 200 });
      }
      const missing = await source.probe('ariadne_audit', new AbortController().signal);
      assert.equal(missing.verdict.status, 'NOT_FOUND', `${item.name} should recognize an explicit empty/missing response`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('third-pass Discourse promotions require canonical usernames', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const name of ['Car Talk Community', 'Spells8']) {
      const source = exactSources.find((candidate) => candidate.name === name);
      assert.ok(source, `${name} exact source missing`);

      globalThis.fetch = async () => new Response(JSON.stringify({ user: { username: 'ariadne_audit' } }), { status: 200 });
      const found = await source.probe('ariadne_audit', new AbortController().signal);
      assert.equal(found.verdict.status, 'FOUND');

      globalThis.fetch = async () => new Response(JSON.stringify({ user: { username: 'someone_else' } }), { status: 200 });
      const mismatch = await source.probe('ariadne_audit', new AbortController().signal);
      assert.equal(mismatch.verdict.status, 'UNKNOWN');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('fourth-pass exact adapters require canonical username evidence', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const wikipedia = exactSources.find((candidate) => candidate.name === 'Wikipedia');
    assert.ok(wikipedia, 'Wikipedia exact source missing');
    globalThis.fetch = async () => new Response(JSON.stringify({
      query: { globalusers: [{ name: 'Ariadne_audit' }] },
    }), { status: 200 });
    const wikiFound = await wikipedia.probe('ariadne_audit', new AbortController().signal);
    assert.equal(wikiFound.verdict.status, 'FOUND');

    globalThis.fetch = async () => new Response(JSON.stringify({
      query: { globalusers: [{ name: 'someone_else' }] },
    }), { status: 200 });
    const wikiMismatch = await wikipedia.probe('ariadne_audit', new AbortController().signal);
    assert.equal(wikiMismatch.verdict.status, 'UNKNOWN');

    globalThis.fetch = async () => new Response(JSON.stringify({
      query: { globalusers: [{ name: 'Ariadne_audit', missing: '' }] },
    }), { status: 200 });
    const wikiMissing = await wikipedia.probe('ariadne_audit', new AbortController().signal);
    assert.equal(wikiMissing.verdict.status, 'NOT_FOUND');

    const freeCodeCamp = exactSources.find((candidate) => candidate.name === 'freeCodeCamp');
    assert.ok(freeCodeCamp, 'freeCodeCamp exact source missing');
    globalThis.fetch = async () => new Response(JSON.stringify({ result: 'ariadne_audit' }), { status: 200 });
    const fccFound = await freeCodeCamp.probe('ariadne_audit', new AbortController().signal);
    assert.equal(fccFound.verdict.status, 'FOUND');

    globalThis.fetch = async () => new Response(JSON.stringify({ result: 'someone_else' }), { status: 200 });
    const fccMismatch = await freeCodeCamp.probe('ariadne_audit', new AbortController().signal);
    assert.equal(fccMismatch.verdict.status, 'UNKNOWN');

    globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 404 });
    const fccMissing = await freeCodeCamp.probe('ariadne_audit', new AbortController().signal);
    assert.equal(fccMissing.verdict.status, 'NOT_FOUND');

    const signalCommunity = exactSources.find((candidate) => candidate.name === 'Signal Community');
    assert.ok(signalCommunity, 'Signal Community exact source missing');
    globalThis.fetch = async () => new Response(JSON.stringify({ user: { username: 'ariadne_audit' } }), { status: 200 });
    const signalFound = await signalCommunity.probe('ariadne_audit', new AbortController().signal);
    assert.equal(signalFound.verdict.status, 'FOUND');

    globalThis.fetch = async () => new Response(JSON.stringify({ user: { username: 'someone_else' } }), { status: 200 });
    const signalMismatch = await signalCommunity.probe('ariadne_audit', new AbortController().signal);
    assert.equal(signalMismatch.verdict.status, 'UNKNOWN');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
