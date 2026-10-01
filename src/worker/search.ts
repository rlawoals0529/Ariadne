import type { EvidenceBasis, ResultStatus, SearchResponse, SourceResult } from '../shared/types.js';
import { exactSources } from './exactSources.js';
import { buildPopularCredentialSources, type PopularSourceCredentials } from './credentialSources.js';
import { sources, type SourceDefinition } from './sources.js';

const EXACT_TIMEOUT_MS = 4500;
const BROAD_TIMEOUT_MS = 3200;
const CONCURRENCY = 5;
export const SEARCH_BATCH_SIZE = 30;

// These inherited catalog entries currently rely on weaker availability/existence helpers,
// third-party mirrors, or have been replaced by stronger exact-username adapters.
const DISABLED_WIDE_SOURCE_IDS = new Set([
  'catalog-bluesky',
  'catalog-boardgamegeek',
  'catalog-chess-com',
  'catalog-codeforces',
  'catalog-codewars',
  'catalog-dev-community',
  'catalog-duolingo',
  'catalog-hugging-face',
  'catalog-gitee',
  'catalog-instagram',
  'catalog-keybase',
  'catalog-lemmyworld',
  'catalog-scratch',
  'catalog-sourceforge',
  'catalog-roblox',
  'catalog-mastodon-social',
  'catalog-lichess',
  'catalog-pypi',
  'catalog-rubygems',
  'catalog-tetr-io',
  'catalog-tryhackme',
  'catalog-x-twitter',
]);

const CREDENTIAL_REPLACEMENTS: Record<string, string> = {
  twitch: 'catalog-twitch',
  youtube: 'catalog-youtube',
  'steam-community': 'catalog-steam-community',
};

function allRegisteredSources(credentials: PopularSourceCredentials = {}): SourceDefinition[] {
  return [...sources, ...exactSources, ...buildPopularCredentialSources(credentials)];
}

function eligibleSources(credentials: PopularSourceCredentials = {}): SourceDefinition[] {
  const credentialSources = buildPopularCredentialSources(credentials);
  const disabled = new Set(DISABLED_WIDE_SOURCE_IDS);
  for (const source of credentialSources) {
    const duplicate = CREDENTIAL_REPLACEMENTS[source.id];
    if (duplicate) disabled.add(duplicate);
  }

  const directCore = sources.filter((source) => !source.id.startsWith('catalog-'));
  const broadCatalog = sources.filter((source) => source.id.startsWith('catalog-'));

  return [...directCore, ...exactSources, ...credentialSources, ...broadCatalog]
    .filter((source) => !disabled.has(source.id));
}

function evidenceBasis(source: SourceDefinition): EvidenceBasis {
  return source.id.startsWith('catalog-') ? 'catalog-rule' : 'direct-api';
}

function makeCatalogNegativeConservative(result: SourceResult): SourceResult {
  if (result.evidenceBasis !== 'catalog-rule' || result.status !== 'NOT_FOUND') return result;

  return {
    ...result,
    status: 'UNKNOWN',
    confidence: 'none',
    reason: 'This site gave a signal that can mean a profile is missing, but Ariadne cannot safely rule the account out from that signal alone.',
    signals: [
      ...result.signals,
      {
        kind: 'provenance',
        detail: 'Ariadne downgraded this broad website rule from Not found to Couldn’t tell to avoid false negatives.',
      },
    ],
  };
}

async function checkSource(source: SourceDefinition, username: string): Promise<SourceResult> {
  const checkedAt = new Date().toISOString();
  const started = Date.now();
  const profileUrl = source.profileUrl(username);
  const basis = evidenceBasis(source);

  if (source.validate && !source.validate(username)) {
    return {
      sourceId: source.id,
      sourceName: source.name,
      profileUrl,
      category: source.category,
      nsfw: source.nsfw,
      evidenceBasis: basis,
      status: 'SKIPPED',
      confidence: 'none',
      reason: 'This username does not fit the format this site allows.',
      httpStatus: null,
      checkedAt,
      durationMs: Date.now() - started,
      signals: [{ kind: 'negative', detail: 'Source-specific username validation failed before any network request.' }],
    };
  }

  const controller = new AbortController();
  const timeoutMs = basis === 'catalog-rule' ? BROAD_TIMEOUT_MS : EXACT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort('source timeout'), timeoutMs);
  try {
    const { httpStatus, verdict } = await source.probe(username, controller.signal);
    return makeCatalogNegativeConservative({
      sourceId: source.id,
      sourceName: source.name,
      profileUrl,
      category: source.category,
      nsfw: source.nsfw,
      evidenceBasis: basis,
      httpStatus,
      checkedAt,
      durationMs: Date.now() - started,
      ...verdict,
    });
  } catch (error) {
    const timedOut = controller.signal.aborted;
    return {
      sourceId: source.id,
      sourceName: source.name,
      profileUrl,
      category: source.category,
      nsfw: source.nsfw,
      evidenceBasis: basis,
      status: 'UNKNOWN',
      confidence: 'none',
      reason: timedOut ? 'This site took too long to answer, so Ariadne could not check it.' : 'Ariadne could not get a reliable answer from this site.',
      httpStatus: null,
      checkedAt,
      durationMs: Date.now() - started,
      signals: [{ kind: 'error', detail: timedOut ? `Timed out after ${timeoutMs} ms.` : error instanceof Error ? error.message : 'Unknown network error.' }],
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkBatch(batch: SourceDefinition[], username: string): Promise<SourceResult[]> {
  const output = new Array<SourceResult>(batch.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= batch.length) return;
      output[index] = await checkSource(batch[index], username);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, () => worker()));
  return output;
}

export function validateUsername(input: unknown): string {
  if (typeof input !== 'string') throw new Error('query must be a string');
  const value = input.trim();
  if (!value) throw new Error('query is required');
  if (value.length > 64) throw new Error('query must be 64 characters or fewer');
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error('query contains unsupported characters');
  return value;
}

export function validateCursor(input: unknown): number {
  if (input === undefined) return 0;
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 0) throw new Error('cursor must be a non-negative integer');
  return input;
}

export function selectSources(includeNsfw: boolean, credentials: PopularSourceCredentials = {}): SourceDefinition[] {
  const eligible = eligibleSources(credentials);
  return includeNsfw ? eligible : eligible.filter((source) => !source.nsfw);
}

export type SourceAvailabilityState = 'exact' | 'fallback' | 'unavailable';

export type SourceAvailability = {
  id: string;
  name: string;
  state: SourceAvailabilityState;
  label: string;
  detail: string;
};

export function sourceAvailability(credentials: PopularSourceCredentials = {}): SourceAvailability[] {
  const has = (name: keyof PopularSourceCredentials) => Boolean(credentials[name]);
  const hasTwitch = has('TWITCH_CLIENT_ID') && has('TWITCH_CLIENT_SECRET');

  return [
    {
      id: 'twitch',
      name: 'Twitch',
      state: hasTwitch ? 'exact' : 'fallback',
      label: hasTwitch ? 'Exact check ready' : 'Public check available',
      detail: hasTwitch
        ? 'Ariadne can use Twitch’s official user lookup.'
        : 'The public-page check remains available, but Ariadne cannot verify the username through Twitch’s API.',
    },
    {
      id: 'youtube',
      name: 'YouTube',
      state: has('YOUTUBE_API_KEY') ? 'exact' : 'fallback',
      label: has('YOUTUBE_API_KEY') ? 'Exact check ready' : 'Public check available',
      detail: has('YOUTUBE_API_KEY')
        ? 'Ariadne can use YouTube’s official channel handle lookup.'
        : 'The public-page check remains available, but the official API lookup is not configured.',
    },
    {
      id: 'steam-community',
      name: 'Steam Community',
      state: has('STEAM_WEB_API_KEY') ? 'exact' : 'fallback',
      label: has('STEAM_WEB_API_KEY') ? 'Exact check ready' : 'Public check available',
      detail: has('STEAM_WEB_API_KEY')
        ? 'Ariadne can use Steam’s vanity URL resolver.'
        : 'The public-page check remains available, but the stronger Steam lookup is not configured.',
    },
    {
      id: 'lastfm',
      name: 'Last.fm',
      state: has('LASTFM_API_KEY') && credentials.LASTFM_PUBLIC_APPROVED === 'true' ? 'exact' : 'unavailable',
      label: has('LASTFM_API_KEY')
        ? credentials.LASTFM_PUBLIC_APPROVED === 'true' ? 'Exact check ready' : 'Approval required'
        : 'Not configured',
      detail: has('LASTFM_API_KEY')
        ? credentials.LASTFM_PUBLIC_APPROVED === 'true'
          ? 'Ariadne can use Last.fm’s official user lookup.'
          : 'The API key is configured, but Ariadne will not use Last.fm publicly until its required written approval is recorded.'
        : 'Last.fm is not checked until its API key is configured.',
    },
  ];
}

export function searchableSourceStats(credentials: PopularSourceCredentials = {}) {
  const all = selectSources(true, credentials);
  const nsfw = all.filter((source) => source.nsfw).length;
  const direct = all.filter((source) => evidenceBasis(source) === 'direct-api').length;
  return {
    total: all.length,
    standard: all.length - nsfw,
    nsfw,
    direct,
    heuristic: all.length - direct,
    disabled: allRegisteredSources(credentials).length - all.length,
    credentialExact: buildPopularCredentialSources(credentials).map((source) => source.name),
  };
}

function emptySummary(): Record<ResultStatus, number> {
  return { FOUND: 0, POSSIBLE: 0, NOT_FOUND: 0, UNKNOWN: 0, BLOCKED: 0, SKIPPED: 0 };
}

export async function searchUsername(
  username: string,
  options: { includeNsfw: boolean; cursor: number },
  credentials: PopularSourceCredentials = {},
): Promise<SearchResponse> {
  const selected = selectSources(options.includeNsfw, credentials);
  const cursor = Math.min(options.cursor, selected.length);
  const batch = selected.slice(cursor, cursor + SEARCH_BATCH_SIZE);
  const results = await checkBatch(batch, username);
  const summary = emptySummary();
  for (const result of results) summary[result.status] += 1;
  const next = cursor + batch.length;

  return {
    query: username,
    kind: 'username',
    checkedAt: new Date().toISOString(),
    sourceCount: selected.length,
    batchCount: batch.length,
    includeNsfw: options.includeNsfw,
    nextCursor: next < selected.length ? next : null,
    results,
    summary,
  };
}
