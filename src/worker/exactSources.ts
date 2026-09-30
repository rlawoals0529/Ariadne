import type { SourceDefinition } from './sources.js';
import { apiIdentityVerdict, classifyHttpFailure, type Verdict } from './evidence.js';

const HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Ariadne/0.8 (+https://github.com/rlawoals0529/Ariadne)',
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
