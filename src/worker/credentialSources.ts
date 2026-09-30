import type { SourceDefinition } from './sources.js';
import { classifyHttpFailure, type Verdict } from './evidence.js';

export type PopularSourceCredentials = {
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
  YOUTUBE_API_KEY?: string;
  STEAM_WEB_API_KEY?: string;
};

const JSON_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Ariadne/0.9 (+https://github.com/rlawoals0529/Ariadne)',
};

let twitchTokenCache: { clientId: string; token: string; expiresAt: number } | null = null;

function blocked(site: string, detail: string): Verdict {
  return {
    status: 'BLOCKED',
    confidence: 'none',
    reason: `${site} could not run its exact check because the service rejected Ariadne's API access.`,
    signals: [{ kind: 'block', detail }],
  };
}

function unknown(site: string, status: number, detail: string): Verdict {
  return {
    status: 'UNKNOWN',
    confidence: 'none',
    reason: `${site} did not return enough reliable information to confirm or rule out this username.`,
    signals: [
      { kind: 'status', detail: `HTTP ${status}` },
      { kind: 'error', detail },
    ],
  };
}

function exactFound(site: string, status: number, detail: string): Verdict {
  return {
    status: 'FOUND',
    confidence: 'high',
    reason: `${site} matched this username using its official account lookup.`,
    signals: [
      { kind: 'status', detail: `HTTP ${status}` },
      { kind: 'identity', detail },
    ],
  };
}

function exactMissing(site: string, status: number, detail: string): Verdict {
  return {
    status: 'NOT_FOUND',
    confidence: 'high',
    reason: `${site}'s official account lookup did not return this username.`,
    signals: [
      { kind: 'status', detail: `HTTP ${status}` },
      { kind: 'negative', detail },
    ],
  };
}

async function getTwitchAppToken(credentials: PopularSourceCredentials, signal: AbortSignal): Promise<{ status: number; token?: string }> {
  const clientId = credentials.TWITCH_CLIENT_ID!;
  if (
    twitchTokenCache &&
    twitchTokenCache.clientId === clientId &&
    twitchTokenCache.expiresAt > Date.now() + 60_000
  ) {
    return { status: 200, token: twitchTokenCache.token };
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: credentials.TWITCH_CLIENT_SECRET!,
    grant_type: 'client_credentials',
  });
  const response = await fetch(`https://id.twitch.tv/oauth2/token?${params.toString()}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    signal,
  });
  const data = await response.json().catch(() => null) as { access_token?: string; expires_in?: number } | null;
  if (!response.ok || !data?.access_token) return { status: response.status };

  twitchTokenCache = {
    clientId,
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, data.expires_in ?? 3600) * 1000,
  };
  return { status: response.status, token: data.access_token };
}

function twitchSource(credentials: PopularSourceCredentials): SourceDefinition {
  return {
    id: 'twitch',
    name: 'Twitch',
    category: 'social',
    nsfw: false,
    profileUrl: (u) => `https://www.twitch.tv/${encodeURIComponent(u)}`,
    probe: async (u, signal) => {
      const tokenResult = await getTwitchAppToken(credentials, signal);
      if (!tokenResult.token) {
        const infrastructure = classifyHttpFailure(tokenResult.status);
        if (infrastructure) return { httpStatus: tokenResult.status, verdict: infrastructure };
        return { httpStatus: tokenResult.status, verdict: blocked('Twitch', `OAuth token request failed with HTTP ${tokenResult.status}.`) };
      }

      const response = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(u.toLocaleLowerCase())}`, {
        headers: {
          ...JSON_HEADERS,
          'Client-Id': credentials.TWITCH_CLIENT_ID!,
          Authorization: `Bearer ${tokenResult.token}`,
        },
        signal,
      });
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      if (response.status === 401) {
        twitchTokenCache = null;
        return { httpStatus: response.status, verdict: blocked('Twitch', 'The Twitch app token was rejected.') };
      }
      if (!response.ok) {
        return { httpStatus: response.status, verdict: unknown('Twitch', response.status, 'Unexpected Twitch API response.') };
      }

      const data = await response.json() as { data?: Array<{ login?: string }> };
      const user = data.data?.[0];
      if (!user) {
        return { httpStatus: response.status, verdict: exactMissing('Twitch', response.status, 'The Get Users response contained no user for this login.') };
      }
      if (user.login?.toLocaleLowerCase() !== u.toLocaleLowerCase()) {
        return { httpStatus: response.status, verdict: unknown('Twitch', response.status, `Twitch returned a different login: ${user.login ?? 'missing'}.`) };
      }
      return { httpStatus: response.status, verdict: exactFound('Twitch', response.status, `Twitch returned login "${user.login}".`) };
    },
  };
}

function youtubeSource(credentials: PopularSourceCredentials): SourceDefinition {
  return {
    id: 'youtube',
    name: 'YouTube',
    category: 'media',
    nsfw: false,
    profileUrl: (u) => `https://www.youtube.com/@${encodeURIComponent(u)}`,
    probe: async (u, signal) => {
      const params = new URLSearchParams({
        part: 'snippet',
        forHandle: u,
      });
      const response = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params.toString()}`, {
        headers: { ...JSON_HEADERS, 'X-Goog-Api-Key': credentials.YOUTUBE_API_KEY! },
        signal,
      });
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      if (!response.ok) {
        return { httpStatus: response.status, verdict: unknown('YouTube', response.status, 'Unexpected YouTube Data API response.') };
      }

      const data = await response.json() as { items?: Array<{ id?: string; snippet?: { customUrl?: string } }> };
      const channel = data.items?.[0];
      if (!channel) {
        return { httpStatus: response.status, verdict: exactMissing('YouTube', response.status, 'The channels.list forHandle lookup returned zero channels.') };
      }

      const customUrl = channel.snippet?.customUrl?.replace(/^@/, '');
      if (customUrl && customUrl.toLocaleLowerCase() !== u.toLocaleLowerCase()) {
        return { httpStatus: response.status, verdict: unknown('YouTube', response.status, `The channel custom URL did not match the requested handle: ${channel.snippet?.customUrl}.`) };
      }

      return {
        httpStatus: response.status,
        verdict: exactFound(
          'YouTube',
          response.status,
          customUrl
            ? `YouTube returned custom URL "@${customUrl}" for this handle lookup.`
            : `YouTube returned channel ID "${channel.id ?? 'present'}" for the exact forHandle lookup.`,
        ),
      };
    },
  };
}

function steamSource(credentials: PopularSourceCredentials): SourceDefinition {
  return {
    id: 'steam-community',
    name: 'Steam Community',
    category: 'gaming',
    nsfw: false,
    profileUrl: (u) => `https://steamcommunity.com/id/${encodeURIComponent(u)}/`,
    probe: async (u, signal) => {
      const params = new URLSearchParams({
        key: credentials.STEAM_WEB_API_KEY!,
        vanityurl: u,
        url_type: '1',
      });
      const response = await fetch(`https://partner.steam-api.com/ISteamUser/ResolveVanityURL/v1/?${params.toString()}`, {
        headers: JSON_HEADERS,
        signal,
      });
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };
      if (response.status === 401 || response.status === 403) {
        return { httpStatus: response.status, verdict: blocked('Steam', 'The Steam Web API key was rejected.') };
      }
      if (!response.ok) {
        return { httpStatus: response.status, verdict: unknown('Steam', response.status, 'Unexpected Steam Web API response.') };
      }

      const data = await response.json() as { response?: { success?: number; steamid?: string; message?: string } };
      if (data.response?.success === 1 && data.response.steamid) {
        return {
          httpStatus: response.status,
          verdict: exactFound('Steam', response.status, `Steam resolved this exact vanity URL to SteamID ${data.response.steamid}.`),
        };
      }

      // Steam documents the resolver but not a stable missing-response contract in enough detail
      // for Ariadne to safely turn every non-success response into a definitive absence claim.
      return {
        httpStatus: response.status,
        verdict: unknown('Steam', response.status, data.response?.message ?? 'The vanity URL resolver did not return a SteamID.'),
      };
    },
  };
}

export function buildPopularCredentialSources(credentials: PopularSourceCredentials): SourceDefinition[] {
  const sources: SourceDefinition[] = [];
  if (credentials.TWITCH_CLIENT_ID && credentials.TWITCH_CLIENT_SECRET) sources.push(twitchSource(credentials));
  if (credentials.YOUTUBE_API_KEY) sources.push(youtubeSource(credentials));
  if (credentials.STEAM_WEB_API_KEY) sources.push(steamSource(credentials));
  return sources;
}

export function popularCredentialSourceIds(credentials: PopularSourceCredentials): string[] {
  return buildPopularCredentialSources(credentials).map((source) => source.id);
}
