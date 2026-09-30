import assert from 'node:assert/strict';
import test from 'node:test';
import { apiIdentityVerdict, classifyHttpFailure } from '../.test-dist/worker/evidence.js';
import { sources, sourceStats } from '../.test-dist/worker/sources.js';
import { searchableSourceStats, searchUsername, selectSources, sourceAvailability } from '../.test-dist/worker/search.js';

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

test('wide catalog is substantial, direct checks expanded, and NSFW stays opt-in', () => {
  const searchable = searchableSourceStats();
  const selected = selectSources(true);
  assert.ok(searchable.total >= 120, `expected at least 120 searchable sources, got ${searchable.total}`);
  assert.ok(searchable.standard >= 100, `expected at least 100 standard sources, got ${searchable.standard}`);
  assert.ok(sourceStats.nsfw >= 15, `expected at least 15 NSFW sources, got ${sourceStats.nsfw}`);
  assert.ok(searchable.direct >= 17, `expected at least 17 direct adapters, got ${searchable.direct}`);
  assert.equal(selectSources(false).some((source) => source.nsfw), false);
  assert.equal(selected.filter((source) => source.nsfw).length, searchable.nsfw);

  for (const sourceId of ['anilist', 'bluesky', 'chess-com', 'codeforces', 'codewars', 'dev-community', 'hugging-face', 'keybase', 'lichess', 'mastodon-social', 'roblox', 'scratch']) {
    assert.ok(selected.some((source) => source.id === sourceId), `${sourceId} exact adapter should be searchable`);
  }

  for (const duplicateId of [
    'catalog-bluesky',
    'catalog-chess-com',
    'catalog-codeforces',
    'catalog-codewars',
    'catalog-dev-community',
    'catalog-hugging-face',
    'catalog-keybase',
    'catalog-lichess',
    'catalog-mastodon-social',
    'catalog-roblox',
    'catalog-scratch',
  ]) {
    assert.equal(selected.some((source) => source.id === duplicateId), false, `${duplicateId} should not be searched when an exact adapter exists`);
  }
});


test('source availability explains credential fallbacks without exposing secrets', () => {
  const missing = sourceAvailability({});
  assert.deepEqual(
    missing.map((item) => [item.id, item.state]),
    [
      ['twitch', 'fallback'],
      ['youtube', 'fallback'],
      ['steam-community', 'fallback'],
      ['lastfm', 'unavailable'],
    ],
  );

  const ready = sourceAvailability({
    TWITCH_CLIENT_ID: 'client-id',
    TWITCH_CLIENT_SECRET: 'client-secret',
    YOUTUBE_API_KEY: 'youtube-key',
    STEAM_WEB_API_KEY: 'steam-key',
    LASTFM_API_KEY: 'lastfm-key',
  });

  assert.deepEqual(ready.map((item) => item.state), ['exact', 'exact', 'exact', 'exact']);
  assert.equal(JSON.stringify(ready).includes('client-secret'), false);
  assert.equal(JSON.stringify(ready).includes('youtube-key'), false);
  assert.equal(JSON.stringify(ready).includes('steam-key'), false);
  assert.equal(JSON.stringify(ready).includes('lastfm-key'), false);
});

test('popular credential-backed adapters replace weaker catalog checks when configured', () => {
  const credentials = {
    TWITCH_CLIENT_ID: 'client-id',
    TWITCH_CLIENT_SECRET: 'client-secret',
    YOUTUBE_API_KEY: 'youtube-key',
    STEAM_WEB_API_KEY: 'steam-key',
    LASTFM_API_KEY: 'lastfm-key',
  };
  const selected = selectSources(true, credentials);
  const stats = searchableSourceStats(credentials);

  for (const sourceId of ['twitch', 'youtube', 'steam-community', 'lastfm']) {
    assert.ok(selected.some((source) => source.id === sourceId), `${sourceId} exact adapter should be enabled`);
  }
  for (const sourceId of ['catalog-twitch', 'catalog-youtube', 'catalog-steam-community']) {
    assert.equal(selected.some((source) => source.id === sourceId), false, `${sourceId} fallback should be disabled`);
  }

  assert.equal(stats.total, searchableSourceStats().total + 1, 'Last.fm adds one new source while Twitch, YouTube, and Steam replace fallbacks');
  assert.ok(stats.direct >= 21, `expected at least 21 exact checks with popular credentials, got ${stats.direct}`);
  assert.deepEqual(new Set(stats.credentialExact), new Set(['Twitch', 'YouTube', 'Steam Community', 'Last.fm']));
});

test('popular credential-backed exact checks stay conservative', async (t) => {
  const credentials = {
    TWITCH_CLIENT_ID: 'client-id',
    TWITCH_CLIENT_SECRET: 'client-secret',
    YOUTUBE_API_KEY: 'youtube-key',
    STEAM_WEB_API_KEY: 'steam-key',
    LASTFM_API_KEY: 'lastfm-key',
  };
  const selected = selectSources(true, credentials);
  const originalFetch = globalThis.fetch;

  try {
    await t.test('Twitch confirms the returned login', async () => {
      const source = selected.find((item) => item.id === 'twitch');
      assert.ok(source);
      globalThis.fetch = async (url) => {
        const value = String(url);
        if (value.startsWith('https://id.twitch.tv/oauth2/token')) {
          return Response.json({ access_token: 'token', expires_in: 3600 });
        }
        return Response.json({ data: [{ login: 'alice' }] });
      };
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'FOUND');
    });

    await t.test('Twitch empty user list is an explicit miss', async () => {
      const source = selected.find((item) => item.id === 'twitch');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ data: [] });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'NOT_FOUND');
    });

    await t.test('YouTube confirms an exact handle lookup without putting the API key in the URL', async () => {
      const source = selected.find((item) => item.id === 'youtube');
      assert.ok(source);
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        assert.equal(url.includes('youtube-key'), false);
        assert.equal(url.includes('key='), false);
        assert.equal(new Headers(init?.headers).get('X-Goog-Api-Key'), 'youtube-key');
        return Response.json({ items: [{ id: 'channel-1', snippet: { customUrl: '@Alice' } }] });
      };
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'FOUND');
    });

    await t.test('YouTube zero results is an explicit miss', async () => {
      const source = selected.find((item) => item.id === 'youtube');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ items: [] });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'NOT_FOUND');
    });

    await t.test('YouTube conflicting custom URL stays unknown', async () => {
      const source = selected.find((item) => item.id === 'youtube');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ items: [{ id: 'channel-1', snippet: { customUrl: '@bob' } }] });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'UNKNOWN');
    });

    await t.test('Steam vanity resolver confirms a mapped SteamID', async () => {
      const source = selected.find((item) => item.id === 'steam-community');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ response: { success: 1, steamid: '76561198000000000' } });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'FOUND');
    });

    await t.test('Steam unresolved vanity stays unknown rather than claiming no match', async () => {
      const source = selected.find((item) => item.id === 'steam-community');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ response: { success: 42, message: 'No match' } });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'UNKNOWN');
    });

    await t.test('Last.fm confirms the canonical username', async () => {
      const source = selected.find((item) => item.id === 'lastfm');
      assert.ok(source);
      globalThis.fetch = async (input) => {
        const url = String(input);
        assert.match(url, /method=user\.getInfo/);
        assert.match(url, /api_key=lastfm-key/);
        return Response.json({ user: { name: 'Alice' } });
      };
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'FOUND');
    });

    await t.test('Last.fm explicit user-not-found response is a miss', async () => {
      const source = selected.find((item) => item.id === 'lastfm');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ error: 6, message: 'User not found' });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'NOT_FOUND');
    });

    await t.test('Last.fm ambiguous API errors stay unknown', async () => {
      const source = selected.find((item) => item.id === 'lastfm');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ error: 8, message: 'Operation failed' });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'UNKNOWN');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('exact adapters only confirm matching usernames', async (t) => {
  const originalFetch = globalThis.fetch;
  const selected = selectSources(true);
  try {
    await t.test('Bluesky confirms the returned handle', async () => {
      const source = selected.find((item) => item.id === 'bluesky');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ handle: 'alice.bsky.social' });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'FOUND');
    });

    await t.test('Chess.com confirms the returned username', async () => {
      const source = selected.find((item) => item.id === 'chess-com');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ username: 'Alice' });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'FOUND');
    });

    await t.test('Chess.com 404 is an explicit miss', async () => {
      const source = selected.find((item) => item.id === 'chess-com');
      assert.ok(source);
      globalThis.fetch = async () => new Response('missing', { status: 404 });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'NOT_FOUND');
    });

    await t.test('Codeforces confirms the returned handle', async () => {
      const source = selected.find((item) => item.id === 'codeforces');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ status: 'OK', result: [{ handle: 'Alice' }] });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'FOUND');
    });

    await t.test('Codeforces missing user stays a miss, not a match', async () => {
      const source = selected.find((item) => item.id === 'codeforces');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ status: 'FAILED', comment: 'handles: User with handle alice not found' });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'NOT_FOUND');
    });

    await t.test('Codewars confirms API username', async () => {
      const source = selected.find((item) => item.id === 'codewars');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ username: 'Alice' });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'FOUND');
    });

    await t.test('DEV Community confirms API username', async () => {
      const source = selected.find((item) => item.id === 'dev-community');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ username: 'alice' });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'FOUND');
    });

    await t.test('Hugging Face confirms overview username', async () => {
      const source = selected.find((item) => item.id === 'hugging-face');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ username: 'Alice' });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'FOUND');
    });

    await t.test('Keybase confirms basics username', async () => {
      const source = selected.find((item) => item.id === 'keybase');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ them: [{ basics: { username: 'alice' } }] });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'FOUND');
    });

    await t.test('Keybase null lookup is an explicit miss', async () => {
      const source = selected.find((item) => item.id === 'keybase');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ them: [null] });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'NOT_FOUND');
    });

    await t.test('Lichess confirms API username', async () => {
      const source = selected.find((item) => item.id === 'lichess');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ username: 'Alice' });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'FOUND');
    });

    await t.test('Lichess 404 is an explicit miss', async () => {
      const source = selected.find((item) => item.id === 'lichess');
      assert.ok(source);
      globalThis.fetch = async () => new Response('missing', { status: 404 });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'NOT_FOUND');
    });

    await t.test('Scratch confirms API username', async () => {
      const source = selected.find((item) => item.id === 'scratch');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ username: 'Alice' });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'FOUND');
    });

    await t.test('Roblox confirms canonical username', async () => {
      const source = selected.find((item) => item.id === 'roblox');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ data: [{ name: 'Alice' }] });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'FOUND');
    });

    await t.test('Roblox empty data is an explicit miss', async () => {
      const source = selected.find((item) => item.id === 'roblox');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ data: [] });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'NOT_FOUND');
    });

    await t.test('Mastodon.social confirms WebFinger subject', async () => {
      const source = selected.find((item) => item.id === 'mastodon-social');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ subject: 'acct:Alice@mastodon.social' });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'FOUND');
    });

    await t.test('Mastodon.social WebFinger mismatch stays unknown', async () => {
      const source = selected.find((item) => item.id === 'mastodon-social');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ subject: 'acct:bob@mastodon.social' });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'UNKNOWN');
    });

    await t.test('exact adapter mismatch never becomes found', async () => {
      const source = selected.find((item) => item.id === 'codewars');
      assert.ok(source);
      globalThis.fetch = async () => Response.json({ username: 'bob' });
      const result = await source.probe('alice', new AbortController().signal);
      assert.equal(result.verdict.status, 'UNKNOWN');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('broad website rules cannot create definitive Not found results', async () => {
  const selected = selectSources(false);
  const twitchIndex = selected.findIndex((source) => source.id === 'catalog-twitch');
  assert.ok(twitchIndex >= 0, 'Twitch catalog rule should be searchable');

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("<meta content='Twitch is the world&#39;s leading video platform and community for gamers.'>", { status: 200 });
    const report = await searchUsername('exampleuser', { includeNsfw: false, cursor: twitchIndex });
    const twitch = report.results.find((result) => result.sourceId === 'catalog-twitch');
    assert.ok(twitch, 'Twitch result should be present in the batch');
    assert.equal(twitch.status, 'UNKNOWN');
    assert.match(twitch.reason, /cannot safely rule the account out/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

    await t.test('raw catalog 404 remains a weak missing signal before the search safety layer', async () => {
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
