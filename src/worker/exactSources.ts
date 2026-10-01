import type { SourceDefinition } from './sources.js';
import { apiIdentityVerdict, classifyHttpFailure, type Verdict } from './evidence.js';

const HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Ariadne/1.0 (+https://github.com/rlawoals0529/Ariadne)',
};

async function fetchJson(url: string, signal: AbortSignal): Promise<Response> {
  return fetch(url, { headers: HEADERS, redirect: 'follow', signal });
}

function public401(status: number, site: string): Verdict | null {
  if (status !== 401) return null;
  return {
    status: 'BLOCKED',
    confidence: 'none',
    reason: `${site} did not allow this public check without authentication.`,
    signals: [{ kind: 'block', detail: 'HTTP 401' }],
  };
}

function webFingerSource(
  id: string,
  name: string,
  host: string,
  profileUrl: (username: string) => string = (username) => `https://${host}/@${encodeURIComponent(username)}`,
): SourceDefinition {
  return {
    id,
    name,
    category: 'social',
    nsfw: false,
    profileUrl,
    validate: (username) => /^[A-Za-z0-9_]{1,64}$/.test(username),
    probe: async (username, signal) => {
      const expected = `acct:${username}@${host}`;
      const response = await fetchJson(
        `https://${host}/.well-known/webfinger?resource=${encodeURIComponent(expected)}`,
        signal,
      );
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const auth = public401(response.status, name);
      if (auth) return { httpStatus: response.status, verdict: auth };
      if (response.status === 404) {
        return {
          httpStatus: response.status,
          verdict: apiIdentityVerdict({ httpStatus: response.status, expected, missing: true }),
        };
      }
      const data = response.ok ? (await response.json().catch(() => null) as { subject?: string } | null) : null;
      return {
        httpStatus: response.status,
        verdict: apiIdentityVerdict({ httpStatus: response.status, expected, actual: data?.subject }),
      };
    },
  };
}

function blockedVerdict(site: string, detail: string): Verdict {
  return {
    status: 'BLOCKED',
    confidence: 'none',
    reason: `${site} temporarily limited this public check.`,
    signals: [{ kind: 'block', detail }],
  };
}

export const exactSources: SourceDefinition[] = [
  {
    id: 'codewars',
    name: 'Codewars',
    category: 'developer',
    nsfw: false,
    profileUrl: (u) => `https://www.codewars.com/users/${encodeURIComponent(u)}`,
    probe: async (u, signal) => {
      const response = await fetchJson(`https://www.codewars.com/api/v1/users/${encodeURIComponent(u)}`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const auth = public401(response.status, 'Codewars');
      if (auth) return { httpStatus: response.status, verdict: auth };
      if (response.status === 404) {
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, missing: true }) };
      }
      const data = response.ok ? (await response.json() as { username?: string }) : null;
      return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual: data?.username }) };
    },
  },
  {
    id: 'dev-community',
    name: 'DEV Community',
    category: 'developer',
    nsfw: false,
    profileUrl: (u) => `https://dev.to/${encodeURIComponent(u)}`,
    validate: (u) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(u),
    probe: async (u, signal) => {
      const response = await fetchJson(`https://dev.to/api/users/${encodeURIComponent(u)}`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const auth = public401(response.status, 'DEV Community');
      if (auth) return { httpStatus: response.status, verdict: auth };
      if (response.status === 404) {
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, missing: true }) };
      }
      const data = response.ok ? (await response.json() as { username?: string }) : null;
      return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual: data?.username }) };
    },
  },
  {
    id: 'hugging-face',
    name: 'Hugging Face',
    category: 'developer',
    nsfw: false,
    profileUrl: (u) => `https://huggingface.co/${encodeURIComponent(u)}`,
    probe: async (u, signal) => {
      const response = await fetchJson(`https://huggingface.co/api/users/${encodeURIComponent(u)}/overview`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const auth = public401(response.status, 'Hugging Face');
      if (auth) return { httpStatus: response.status, verdict: auth };
      if (response.status === 404) {
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, missing: true }) };
      }
      const data = response.ok ? (await response.json() as { username?: string }) : null;
      return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual: data?.username }) };
    },
  },
  {
    id: 'keybase',
    name: 'Keybase',
    category: 'social',
    nsfw: false,
    profileUrl: (u) => `https://keybase.io/${encodeURIComponent(u)}`,
    validate: (u) => /^[a-zA-Z0-9_]{2,16}$/.test(u),
    probe: async (u, signal) => {
      const response = await fetchJson(`https://keybase.io/_/api/1.0/user/lookup.json?usernames=${encodeURIComponent(u)}&fields=basics`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const auth = public401(response.status, 'Keybase');
      if (auth) return { httpStatus: response.status, verdict: auth };
      if (!response.ok) {
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u }) };
      }
      const data = await response.json() as { them?: Array<{ basics?: { username?: string } } | null> };
      const user = data.them?.[0] ?? null;
      return {
        httpStatus: response.status,
        verdict: apiIdentityVerdict({
          httpStatus: response.status,
          expected: u,
          actual: user?.basics?.username,
          missing: user === null,
        }),
      };
    },
  },
  {
    id: 'lichess',
    name: 'Lichess',
    category: 'gaming',
    nsfw: false,
    profileUrl: (u) => `https://lichess.org/@/${encodeURIComponent(u)}`,
    probe: async (u, signal) => {
      const response = await fetchJson(`https://lichess.org/api/user/${encodeURIComponent(u)}`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const auth = public401(response.status, 'Lichess');
      if (auth) return { httpStatus: response.status, verdict: auth };
      if (response.status === 404) {
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, missing: true }) };
      }
      const data = response.ok ? (await response.json() as { username?: string }) : null;
      return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual: data?.username }) };
    },
  },
  {
    id: 'scratch',
    name: 'Scratch',
    category: 'gaming',
    nsfw: false,
    profileUrl: (u) => `https://scratch.mit.edu/users/${encodeURIComponent(u)}/`,
    probe: async (u, signal) => {
      const response = await fetchJson(`https://api.scratch.mit.edu/users/${encodeURIComponent(u)}`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const auth = public401(response.status, 'Scratch');
      if (auth) return { httpStatus: response.status, verdict: auth };
      if (response.status === 404) {
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, missing: true }) };
      }
      const data = response.ok ? (await response.json() as { username?: string }) : null;
      return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual: data?.username }) };
    },
  },
  {
    id: 'roblox',
    name: 'Roblox',
    category: 'gaming',
    nsfw: false,
    profileUrl: (u) => `https://www.roblox.com/user.aspx?username=${encodeURIComponent(u)}`,
    probe: async (u, signal) => {
      const response = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [u], excludeBannedUsers: false }),
        signal,
      });
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const auth = public401(response.status, 'Roblox');
      if (auth) return { httpStatus: response.status, verdict: auth };
      if (!response.ok) {
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u }) };
      }
      const data = await response.json() as { data?: Array<{ name?: string }> };
      const match = data.data?.find((item) => item.name?.toLocaleLowerCase() === u.toLocaleLowerCase());
      return {
        httpStatus: response.status,
        verdict: apiIdentityVerdict({
          httpStatus: response.status,
          expected: u,
          actual: match?.name,
          missing: (data.data?.length ?? 0) === 0,
        }),
      };
    },
  },
  webFingerSource('mastodon-cloud', 'Mastodon.cloud', 'mastodon.cloud'),
  webFingerSource('mastodon-xyz', 'Mastodon.xyz', 'mastodon.xyz'),
  webFingerSource('mstdn-social', 'mstdn.social', 'mstdn.social'),
  webFingerSource('mstdn-io', 'mstdn.io', 'mstdn.io'),
  webFingerSource('social-tchncs-de', 'social.tchncs.de', 'social.tchncs.de'),
  webFingerSource('chaos-social', 'chaos.social', 'chaos.social'),
  webFingerSource('fosstodon', 'Fosstodon', 'fosstodon.org'),
  webFingerSource('framapiaf', 'Framapiaf', 'framapiaf.org'),
  webFingerSource('pixelfed-social', 'Pixelfed.social', 'pixelfed.social', (u) => `https://pixelfed.social/${encodeURIComponent(u)}`),
  {
    id: 'mixcloud',
    name: 'Mixcloud',
    category: 'media',
    nsfw: false,
    profileUrl: (u) => `https://www.mixcloud.com/${encodeURIComponent(u)}/`,
    probe: async (u, signal) => {
      const response = await fetchJson(`https://api.mixcloud.com/${encodeURIComponent(u)}/`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const auth = public401(response.status, 'Mixcloud');
      if (auth) return { httpStatus: response.status, verdict: auth };
      if (response.status === 403) {
        return { httpStatus: response.status, verdict: blockedVerdict('Mixcloud', 'HTTP 403 from the public API; this can indicate rate limiting.') };
      }
      if (response.status === 404) {
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, missing: true }) };
      }
      const data = response.ok
        ? (await response.json().catch(() => null) as { username?: string; key?: string } | null)
        : null;
      const keyUsername = data?.key?.match(/^\/([^/]+)\/$/)?.[1];
      return {
        httpStatus: response.status,
        verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual: data?.username ?? keyUsername }),
      };
    },
  },
  {
    id: 'launchpad',
    name: 'Launchpad',
    category: 'developer',
    nsfw: false,
    profileUrl: (u) => `https://launchpad.net/~${encodeURIComponent(u)}`,
    probe: async (u, signal) => {
      const response = await fetchJson(`https://api.launchpad.net/1.0/~${encodeURIComponent(u)}`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const auth = public401(response.status, 'Launchpad');
      if (auth) return { httpStatus: response.status, verdict: auth };
      if (response.status === 404) {
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, missing: true }) };
      }
      const data = response.ok ? (await response.json().catch(() => null) as { name?: string } | null) : null;
      return {
        httpStatus: response.status,
        verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual: data?.name }),
      };
    },
  },
  {
    id: 'tetr-io',
    name: 'TETR.IO',
    category: 'gaming',
    nsfw: false,
    profileUrl: (u) => `https://ch.tetr.io/u/${encodeURIComponent(u)}`,
    probe: async (u, signal) => {
      const response = await fetchJson(`https://ch.tetr.io/api/users/${encodeURIComponent(u.toLocaleLowerCase())}`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const auth = public401(response.status, 'TETR.IO');
      if (auth) return { httpStatus: response.status, verdict: auth };
      if (response.status === 404) {
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, missing: true }) };
      }
      const data = response.ok
        ? (await response.json().catch(() => null) as { success?: boolean; data?: { username?: string } } | null)
        : null;
      return {
        httpStatus: response.status,
        verdict: apiIdentityVerdict({
          httpStatus: response.status,
          expected: u,
          actual: data?.success ? data.data?.username : undefined,
        }),
      };
    },
  },
  {
    id: 'rubygems',
    name: 'RubyGems',
    category: 'developer',
    nsfw: false,
    profileUrl: (u) => `https://rubygems.org/profiles/${encodeURIComponent(u)}`,
    probe: async (u, signal) => {
      const response = await fetchJson(`https://rubygems.org/api/v1/profiles/${encodeURIComponent(u)}.json`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const auth = public401(response.status, 'RubyGems');
      if (auth) return { httpStatus: response.status, verdict: auth };
      if (response.status === 404) {
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, missing: true }) };
      }
      const data = response.ok ? (await response.json().catch(() => null) as { handle?: string } | null) : null;
      return {
        httpStatus: response.status,
        verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual: data?.handle }),
      };
    },
  },
  {
    id: 'gravatar',
    name: 'Gravatar',
    category: 'social',
    nsfw: false,
    profileUrl: (u) => `https://gravatar.com/${encodeURIComponent(u)}`,
    probe: async (u, signal) => {
      const response = await fetchJson(`https://api.gravatar.com/v3/profiles/${encodeURIComponent(u)}`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const auth = public401(response.status, 'Gravatar');
      if (auth) return { httpStatus: response.status, verdict: auth };
      if (response.status === 404) {
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, missing: true }) };
      }
      const data = response.ok
        ? (await response.json().catch(() => null) as { profile_url?: string } | null)
        : null;
      let actual: string | undefined;
      if (data?.profile_url) {
        try {
          const url = new URL(data.profile_url);
          actual = url.pathname.split('/').filter(Boolean).at(-1);
        } catch {
          actual = undefined;
        }
      }
      return {
        httpStatus: response.status,
        verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual }),
      };
    },
  },
  {
    id: 'lemmy-world',
    name: 'LemmyWorld',
    category: 'community',
    nsfw: false,
    profileUrl: (u) => `https://lemmy.world/u/${encodeURIComponent(u)}`,
    probe: async (u, signal) => {
      const response = await fetchJson(`https://lemmy.world/api/v4/person?username=${encodeURIComponent(u)}`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const auth = public401(response.status, 'LemmyWorld');
      if (auth) return { httpStatus: response.status, verdict: auth };
      if (response.status === 404) {
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, missing: true }) };
      }
      const data = response.ok
        ? (await response.json().catch(() => null) as {
            person_view?: { person?: { name?: string } };
            person?: { name?: string };
          } | null)
        : null;
      const actual = data?.person_view?.person?.name ?? data?.person?.name;
      return {
        httpStatus: response.status,
        verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual }),
      };
    },
  },
  {
    id: 'gitee',
    name: 'Gitee',
    category: 'developer',
    nsfw: false,
    profileUrl: (u) => `https://gitee.com/${encodeURIComponent(u)}`,
    probe: async (u, signal) => {
      const response = await fetchJson(`https://gitee.com/api/v5/users/${encodeURIComponent(u)}`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const auth = public401(response.status, 'Gitee');
      if (auth) return { httpStatus: response.status, verdict: auth };
      if (response.status === 404) {
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, missing: true }) };
      }
      const data = response.ok
        ? (await response.json().catch(() => null) as { login?: string } | null)
        : null;
      return {
        httpStatus: response.status,
        verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual: data?.login }),
      };
    },
  },
  {
    id: 'sourceforge',
    name: 'SourceForge',
    category: 'developer',
    nsfw: false,
    profileUrl: (u) => `https://sourceforge.net/u/${encodeURIComponent(u)}/profile/`,
    probe: async (u, signal) => {
      const response = await fetchJson(`https://sourceforge.net/rest/u/${encodeURIComponent(u)}/profile`, signal);
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const auth = public401(response.status, 'SourceForge');
      if (auth) return { httpStatus: response.status, verdict: auth };
      if (response.status === 404) {
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, missing: true }) };
      }
      const data = response.ok
        ? (await response.json().catch(() => null) as { username?: string } | null)
        : null;
      return {
        httpStatus: response.status,
        verdict: apiIdentityVerdict({ httpStatus: response.status, expected: u, actual: data?.username }),
      };
    },
  },
  {
    id: 'mastodon-social',
    name: 'Mastodon.social',
    category: 'social',
    nsfw: false,
    profileUrl: (u) => `https://mastodon.social/@${encodeURIComponent(u)}`,
    probe: async (u, signal) => {
      const expected = `acct:${u}@mastodon.social`;
      const response = await fetchJson(
        `https://mastodon.social/.well-known/webfinger?resource=${encodeURIComponent(expected)}`,
        signal,
      );
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      const auth = public401(response.status, 'Mastodon.social');
      if (auth) return { httpStatus: response.status, verdict: auth };
      if (response.status === 404) {
        return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected, missing: true }) };
      }
      const data = response.ok ? (await response.json() as { subject?: string }) : null;
      return { httpStatus: response.status, verdict: apiIdentityVerdict({ httpStatus: response.status, expected, actual: data?.subject }) };
    },
  },
];
