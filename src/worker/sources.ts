import type { SourceCategory } from '../shared/types.js';
import { apiIdentityVerdict, classifyHttpFailure, type Verdict } from './evidence.js';
import { catalogSources, catalogStats } from './catalog.js';
import { extendedCatalogSources } from './extendedCatalog.js';

export interface SourceDefinition {
  id: string;
  name: string;
  category: SourceCategory;
  nsfw: boolean;
  profileUrl: (username: string) => string;
  validate?: (username: string) => boolean;
  probe: (username: string, signal: AbortSignal) => Promise<{ httpStatus: number; verdict: Verdict }>;
}

const jsonHeaders = {
  Accept: 'application/json',
  'User-Agent': 'Ariadne/0.5 (+https://github.com/rlawoals0529/Ariadne)',
};

async function fetchJson(url: string, signal: AbortSignal): Promise<Response> {
  return fetch(url, { headers: jsonHeaders, redirect: 'follow', signal });
}

function blueskyHandle(username: string): string {
  return username.includes('.') ? username.toLocaleLowerCase() : `${username.toLocaleLowerCase()}.bsky.social`;
}

const coreSources: SourceDefinition[] = [
  {
    id: 'github', name: 'GitHub', category: 'developer', nsfw: false,
    profileUrl: (u) => `https://github.com/${encodeURIComponent(u)}`,
    validate: (u) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(u),
    probe: async (u, signal) => {
      const response = await fetchJson(`https://api.github.com/users/${encodeURIComponent(u)}`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const data = response.ok ? (await response.json() as { login?: string }) : null;
      return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual: data?.login }) };
    },
  },
  {
    id: 'gitlab', name: 'GitLab', category: 'developer', nsfw: false,
    profileUrl: (u) => `https://gitlab.com/${encodeURIComponent(u)}`,
    probe: async (u, signal) => {
      const response = await fetchJson(`https://gitlab.com/api/v4/users?username=${encodeURIComponent(u)}`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      if (!response.ok) return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u }) };
      const data = await response.json() as Array<{ username?: string }>;
      const match = data.find((item) => item.username?.toLocaleLowerCase() === u.toLocaleLowerCase());
      return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual: match?.username, missing: !match }) };
    },
  },
  {
    id: 'hackernews', name: 'Hacker News', category: 'developer', nsfw: false,
    profileUrl: (u) => `https://news.ycombinator.com/user?id=${encodeURIComponent(u)}`,
    probe: async (u, signal) => {
      const response = await fetchJson(`https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(u)}.json`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const data = response.ok ? (await response.json() as { id?: string } | null) : null;
      if (response.ok && data === null) {
        return {
          httpStatus: response.status,
          verdict: {
            status: 'UNKNOWN', confidence: 'none',
            reason: 'The Hacker News public API only lists users with public activity, so an empty response cannot prove the username is unused.',
            signals: [
              { kind: 'status', detail: `HTTP ${response.status}` },
              { kind: 'negative', detail: 'Public activity API returned null; account existence remains unresolved.' },
            ],
          },
        };
      }
      return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual: data?.id, caseSensitive: true }) };
    },
  },
  {
    id: 'codeberg', name: 'Codeberg', category: 'developer', nsfw: false,
    profileUrl: (u) => `https://codeberg.org/${encodeURIComponent(u)}`,
    probe: async (u, signal) => {
      const response = await fetchJson(`https://codeberg.org/api/v1/users/${encodeURIComponent(u)}`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const data = response.ok ? (await response.json() as { login?: string }) : null;
      return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual: data?.login }) };
    },
  },
  {
    id: 'reddit', name: 'Reddit', category: 'social', nsfw: false,
    profileUrl: (u) => `https://www.reddit.com/user/${encodeURIComponent(u)}`,
    validate: (u) => /^[A-Za-z0-9_-]{3,20}$/.test(u),
    probe: async (u, signal) => {
      const response = await fetchJson(`https://www.reddit.com/user/${encodeURIComponent(u)}/about.json`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const data = response.ok ? (await response.json() as { data?: { name?: string } }) : null;
      return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual: data?.data?.name }) };
    },
  },
  {
    id: 'anilist', name: 'AniList', category: 'media', nsfw: false,
    profileUrl: (u) => `https://anilist.co/user/${encodeURIComponent(u)}/`,
    validate: (u) => /^[A-Za-z0-9]{2,20}$/.test(u),
    probe: async (u, signal) => {
      const response = await fetch('https://graphql.anilist.co/', {
        method: 'POST',
        headers: { ...jsonHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'query($name:String){User(name:$name){name}}', variables: { name: u } }),
        signal,
      });
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      if (response.status === 404) return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, missing: true }) };
      if (!response.ok) return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u }) };
      const data = await response.json() as { data?: { User?: { name?: string } | null } };
      return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual: data.data?.User?.name, missing: data.data?.User === null }) };
    },
  },
  {
    id: 'bluesky', name: 'Bluesky', category: 'social', nsfw: false,
    profileUrl: (u) => `https://bsky.app/profile/${encodeURIComponent(blueskyHandle(u))}`,
    validate: (u) => /^[A-Za-z0-9.-]{3,253}$/.test(u),
    probe: async (u, signal) => {
      const expected = blueskyHandle(u);
      const response = await fetchJson(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(expected)}`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const data = await response.json().catch(() => null) as { handle?: string; error?: string; message?: string } | null;
      if (response.status === 400 && /not found/i.test(`${data?.error ?? ''} ${data?.message ?? ''}`)) {
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected, missing: true }) };
      }
      return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected, actual: data?.handle }) };
    },
  },
  {
    id: 'chess-com', name: 'Chess.com', category: 'gaming', nsfw: false,
    profileUrl: (u) => `https://www.chess.com/member/${encodeURIComponent(u)}`,
    validate: (u) => /^(?!\d+$)[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])$/.test(u) && u.length >= 3 && u.length <= 25,
    probe: async (u, signal) => {
      const response = await fetchJson(`https://api.chess.com/pub/player/${encodeURIComponent(u.toLocaleLowerCase())}`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      if (response.status === 404 || response.status === 410) {
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, missing: true }) };
      }
      const data = response.ok ? (await response.json() as { username?: string }) : null;
      return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual: data?.username }) };
    },
  },
  {
    id: 'codeforces', name: 'Codeforces', category: 'developer', nsfw: false,
    profileUrl: (u) => `https://codeforces.com/profile/${encodeURIComponent(u)}`,
    probe: async (u, signal) => {
      const response = await fetchJson(`https://codeforces.com/api/user.info?handles=${encodeURIComponent(u)}&checkHistoricHandles=false`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const data = await response.json().catch(() => null) as { status?: string; comment?: string; result?: Array<{ handle?: string }> } | null;
      if (data?.status === 'FAILED') {
        if (/not found/i.test(data.comment ?? '')) {
          return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, missing: true }) };
        }
        if (/limit exceeded/i.test(data.comment ?? '')) {
          return {
            httpStatus: response.status,
            verdict: {
              status: 'BLOCKED', confidence: 'none',
              reason: 'Codeforces temporarily rate-limited this check.',
              signals: [{ kind: 'block', detail: data.comment ?? 'Codeforces API call limit exceeded.' }],
            },
          };
        }
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u }) };
      }
      const actual = data?.status === 'OK' ? data.result?.[0]?.handle : undefined;
      return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual, missing: data?.status === 'OK' && !actual }) };
    },
  },
];

export const sources: SourceDefinition[] = [...coreSources, ...catalogSources, ...extendedCatalogSources];
export const sourceStats = {
  total: sources.length,
  nsfw: sources.filter((source) => source.nsfw).length,
  standard: sources.filter((source) => !source.nsfw).length,
  provenance: catalogStats.provenance,
} as const;
