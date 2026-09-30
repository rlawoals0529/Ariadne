import type { SourceCategory } from '../shared/types.js';
import { classifyHttpFailure, type Verdict } from './evidence.js';
import type { SourceDefinition } from './sources.js';

type ErrorType = 'status_code' | 'message' | 'response_url';

type CatalogEntry = {
  name: string;
  category: SourceCategory;
  url: string;
  probe?: string;
  errorType: ErrorType;
  errorMsg?: string | string[];
  errorUrl?: string;
  errorCode?: number | number[];
  regex?: string;
  nsfw?: boolean;
};

const SHERLOCK_SNAPSHOT = 'sherlock-project/sherlock@e40a45ec2a074b90703b3b4b842c8a3adbd6ada3';
const BODY_LIMIT = 96_000;
const DEFAULT_HEADERS = {
  Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
  'User-Agent': 'Ariadne/0.2 public-profile-verifier',
};
const BLOCK_MARKERS = [
  '<title>just a moment...</title>',
  'cf-chl-',
  'challenge-platform',
  'cf-turnstile',
  'g-recaptcha',
  'hcaptcha',
  '<title>access denied</title>',
];

function fill(template: string, username: string): string {
  return template.replaceAll('{}', encodeURIComponent(username));
}

function idFor(name: string): string {
  return `catalog-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    return `${url.origin}${path}${url.search}`;
  } catch {
    return value.replace(/\/+$/, '');
  }
}

function notFound(reason: string, status: number, detail: string): Verdict {
  return {
    status: 'NOT_FOUND',
    confidence: 'medium',
    reason,
    signals: [
      { kind: 'status', detail: `HTTP ${status}` },
      { kind: 'negative', detail },
      { kind: 'provenance', detail: `Rule adapted from ${SHERLOCK_SNAPSHOT}.` },
    ],
  };
}

function possible(status: number, detail: string): Verdict {
  return {
    status: 'POSSIBLE',
    confidence: 'medium',
    reason: 'The source-specific public profile rule produced a possible match. Open the profile to confirm it belongs to the username you intended.',
    signals: [
      { kind: 'status', detail: `HTTP ${status}` },
      { kind: 'identity', detail },
      { kind: 'provenance', detail: `Rule adapted from ${SHERLOCK_SNAPSHOT}; heuristic matches are never promoted to confirmed automatically.` },
    ],
  };
}

async function readTextLimited(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    while (total < BODY_LIMIT) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (total >= BODY_LIMIT) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text;
}

function isChallenge(body: string): boolean {
  const lower = body.toLowerCase();
  return BLOCK_MARKERS.some((marker) => lower.includes(marker));
}

function createCatalogSource(entry: CatalogEntry): SourceDefinition {
  const errorMessages = entry.errorMsg ? (Array.isArray(entry.errorMsg) ? entry.errorMsg : [entry.errorMsg]) : [];
  const errorCodes = entry.errorCode ? (Array.isArray(entry.errorCode) ? entry.errorCode : [entry.errorCode]) : [];
  let validator: RegExp | null = null;
  if (entry.regex) {
    try { validator = new RegExp(entry.regex); } catch { validator = null; }
  }

  return {
    id: idFor(entry.name),
    name: entry.name,
    category: entry.category,
    nsfw: Boolean(entry.nsfw),
    profileUrl: (username) => fill(entry.url, username),
    validate: validator ? (username) => validator!.test(username) : undefined,
    probe: async (username, signal) => {
      const target = fill(entry.probe ?? entry.url, username);
      const response = await fetch(target, { method: 'GET', headers: DEFAULT_HEADERS, redirect: 'follow', signal });
      const infrastructure = classifyHttpFailure(response.status);
      if (infrastructure) return { httpStatus: response.status, verdict: infrastructure };

      if (response.status === 401) {
        return {
          httpStatus: response.status,
          verdict: {
            status: 'BLOCKED',
            confidence: 'none',
            reason: 'The source requires authentication before Ariadne can verify the public profile.',
            signals: [
              { kind: 'block', detail: 'HTTP 401' },
              { kind: 'provenance', detail: `Rule adapted from ${SHERLOCK_SNAPSHOT}.` },
            ],
          },
        };
      }

      if (response.status === 404 || response.status === 410 || errorCodes.includes(response.status)) {
        return { httpStatus: response.status, verdict: notFound('The source returned its configured missing-profile status.', response.status, `Missing-profile status matched HTTP ${response.status}.`) };
      }

      const body = await readTextLimited(response);
      if (isChallenge(body)) {
        return {
          httpStatus: response.status,
          verdict: {
            status: 'BLOCKED',
            confidence: 'none',
            reason: 'The source returned an anti-bot or CAPTCHA challenge, so Ariadne will not infer account existence.',
            signals: [
              { kind: 'block', detail: 'Challenge-page marker detected.' },
              { kind: 'provenance', detail: `Profile rule adapted from ${SHERLOCK_SNAPSHOT}.` },
            ],
          },
        };
      }

      if (entry.errorType === 'message') {
        const matched = errorMessages.find((message) => body.includes(message));
        if (matched) {
          return { httpStatus: response.status, verdict: notFound('The source returned its configured missing-profile marker.', response.status, `Matched negative marker: ${matched.slice(0, 120)}`) };
        }
      }

      if (entry.errorType === 'response_url' && entry.errorUrl) {
        const expectedErrorUrl = normalizeUrl(fill(entry.errorUrl, username));
        if (normalizeUrl(response.url) === expectedErrorUrl) {
          return { httpStatus: response.status, verdict: notFound('The source redirected to its configured missing-profile destination.', response.status, `Final URL matched ${expectedErrorUrl}.`) };
        }
      }

      if (response.ok) {
        return { httpStatus: response.status, verdict: possible(response.status, `The configured ${entry.errorType.replace('_', ' ')} rule did not produce a missing-profile signal.`) };
      }

      return {
        httpStatus: response.status,
        verdict: {
          status: 'UNKNOWN',
          confidence: 'none',
          reason: 'The source response was neither a configured match nor a reliable missing-profile signal.',
          signals: [
            { kind: 'status', detail: `HTTP ${response.status}` },
            { kind: 'provenance', detail: `Rule adapted from ${SHERLOCK_SNAPSHOT}.` },
          ],
        },
      };
    },
  };
}

const entries: CatalogEntry[] = [
  { name: 'About.me', category: 'social', errorType: 'status_code', url: 'https://about.me/{}' },
  { name: 'AllMyLinks', category: 'social', errorType: 'message', errorMsg: 'Page not found', regex: '^[a-z0-9][a-z0-9-]{2,32}$', url: 'https://allmylinks.com/{}' },
  { name: 'Archive.org', category: 'media', errorType: 'message', errorMsg: ['could not fetch an account with user item identifier', 'The resource could not be found', 'Internet Archive services are temporarily offline'], url: 'https://archive.org/details/@{}', probe: 'https://archive.org/details/@{}?noscript=true' },
  { name: 'ArtStation', category: 'creative', errorType: 'status_code', url: 'https://www.artstation.com/{}', probe: 'https://www.artstation.com/users/{}.json' },
  { name: 'AtCoder', category: 'developer', errorType: 'status_code', url: 'https://atcoder.jp/users/{}' },
  { name: 'Bandcamp', category: 'media', errorType: 'status_code', url: 'https://www.bandcamp.com/{}' },
  { name: 'Behance', category: 'creative', errorType: 'status_code', url: 'https://www.behance.net/{}' },
  { name: 'Bitbucket', category: 'developer', errorType: 'status_code', regex: '^[a-zA-Z0-9-_]{1,30}$', url: 'https://bitbucket.org/{}/' },
  { name: 'Bluesky', category: 'social', errorType: 'status_code', url: 'https://bsky.app/profile/{}.bsky.social', probe: 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor={}.bsky.social' },
  { name: 'BoardGameGeek', category: 'gaming', errorType: 'message', errorMsg: '"isValid":true', url: 'https://boardgamegeek.com/user/{}', probe: 'https://api.geekdo.com/api/accounts/validate/username?username={}' },
  { name: 'Bugcrowd', category: 'developer', errorType: 'status_code', url: 'https://bugcrowd.com/{}' },
  { name: 'Buy Me a Coffee', category: 'social', errorType: 'status_code', regex: '^[a-zA-Z0-9]{3,15}$', url: 'https://buymeacoff.ee/{}', probe: 'https://www.buymeacoffee.com/{}' },
  { name: 'Carrd', category: 'social', errorType: 'status_code', regex: '^[a-zA-Z0-9_-]{3,50}$', url: 'https://{}.carrd.co/' },
  { name: 'Chess.com', category: 'gaming', errorType: 'message', errorMsg: 'Username is valid', regex: '^[a-zA-Z0-9_]{3,25}$', url: 'https://www.chess.com/member/{}', probe: 'https://www.chess.com/callback/user/valid?username={}' },
  { name: 'Codecademy', category: 'developer', errorType: 'message', errorMsg: 'This profile could not be found', url: 'https://www.codecademy.com/profiles/{}' },
  { name: 'Codeforces', category: 'developer', errorType: 'status_code', url: 'https://codeforces.com/profile/{}', probe: 'https://codeforces.com/api/user.info?handles={}' },
  { name: 'CodePen', category: 'developer', errorType: 'status_code', url: 'https://codepen.io/{}' },
  { name: 'Codewars', category: 'developer', errorType: 'status_code', url: 'https://www.codewars.com/users/{}' },
  { name: 'DEV Community', category: 'developer', errorType: 'status_code', regex: '^[a-zA-Z][a-zA-Z0-9_-]*$', url: 'https://dev.to/{}' },
  { name: 'DeviantArt', category: 'creative', errorType: 'message', errorMsg: 'Llama Not Found', regex: '^[a-zA-Z][a-zA-Z0-9_-]*$', url: 'https://www.deviantart.com/{}' },
  { name: 'Discogs', category: 'media', errorType: 'status_code', url: 'https://www.discogs.com/user/{}' },
  { name: 'Docker Hub', category: 'developer', errorType: 'status_code', url: 'https://hub.docker.com/u/{}/', probe: 'https://hub.docker.com/v2/users/{}/' },
  { name: 'Dribbble', category: 'creative', errorType: 'message', errorMsg: 'Whoops, that page is gone.', regex: '^[a-zA-Z][a-zA-Z0-9_-]*$', url: 'https://dribbble.com/{}' },
  { name: 'Duolingo', category: 'social', errorType: 'message', errorMsg: '{"users":[]}', url: 'https://www.duolingo.com/profile/{}', probe: 'https://www.duolingo.com/2017-06-30/users?username={}' },
  { name: 'Fandom', category: 'community', errorType: 'status_code', url: 'https://www.fandom.com/u/{}' },
  { name: 'Flickr', category: 'creative', errorType: 'status_code', url: 'https://www.flickr.com/people/{}' },
  { name: 'Fortnite Tracker', category: 'gaming', errorType: 'status_code', url: 'https://fortnitetracker.com/profile/all/{}' },
  { name: 'Freesound', category: 'media', errorType: 'status_code', url: 'https://freesound.org/people/{}/' },
  { name: 'freeCodeCamp', category: 'developer', errorType: 'status_code', url: 'https://www.freecodecamp.org/{}', probe: 'https://api.freecodecamp.org/api/users/get-public-profile?username={}' },
  { name: 'Gitea', category: 'developer', errorType: 'status_code', url: 'https://gitea.com/{}' },
  { name: 'Goodreads', category: 'media', errorType: 'status_code', url: 'https://www.goodreads.com/{}' },
  { name: 'Hack The Box Forum', category: 'developer', errorType: 'status_code', url: 'https://forum.hackthebox.com/u/{}' },
  { name: 'Hackaday', category: 'developer', errorType: 'status_code', url: 'https://hackaday.io/{}' },
  { name: 'HackerOne', category: 'developer', errorType: 'message', errorMsg: 'Page not found', url: 'https://hackerone.com/{}' },
  { name: 'HackerRank', category: 'developer', errorType: 'message', errorMsg: 'Something went wrong', regex: '^[^.]*?$', url: 'https://hackerrank.com/{}' },
  { name: 'HackMD', category: 'developer', errorType: 'status_code', url: 'https://hackmd.io/@{}' },
  { name: 'Hashnode', category: 'developer', errorType: 'status_code', url: 'https://hashnode.com/@{}' },
  { name: 'Hugging Face', category: 'developer', errorType: 'status_code', url: 'https://huggingface.co/{}' },
  { name: 'Instagram', category: 'social', errorType: 'status_code', url: 'https://instagram.com/{}', probe: 'https://imginn.com/{}' },
  { name: 'Itch.io', category: 'gaming', errorType: 'status_code', regex: '^[\\w@-]+?$', url: 'https://{}.itch.io/' },
  { name: 'Kaggle', category: 'developer', errorType: 'status_code', url: 'https://www.kaggle.com/{}' },
  { name: 'Keybase', category: 'social', errorType: 'status_code', url: 'https://keybase.io/{}' },
  { name: 'Ko-fi', category: 'social', errorType: 'response_url', errorUrl: 'https://ko-fi.com/art?=redirect', url: 'https://ko-fi.com/{}' },
  { name: 'Last.fm', category: 'media', errorType: 'status_code', url: 'https://last.fm/user/{}' },
  { name: 'LeetCode', category: 'developer', errorType: 'status_code', url: 'https://leetcode.com/{}' },
  { name: 'Letterboxd', category: 'media', errorType: 'message', errorMsg: 'Sorry, we can’t find the page you’ve requested.', url: 'https://letterboxd.com/{}' },
  { name: 'Lichess', category: 'gaming', errorType: 'status_code', url: 'https://lichess.org/@/{}' },
  { name: 'Linktree', category: 'social', errorType: 'message', errorMsg: '"statusCode":404', regex: '^[\\w\\.]{2,30}$', url: 'https://linktr.ee/{}' },
  { name: 'Mastodon.social', category: 'social', errorType: 'status_code', url: 'https://mastodon.social/@{}' },
  { name: 'Medium', category: 'media', errorType: 'message', errorMsg: '<body', url: 'https://medium.com/@{}', probe: 'https://medium.com/feed/@{}' },
  { name: 'Monkeytype', category: 'gaming', errorType: 'status_code', url: 'https://monkeytype.com/profile/{}', probe: 'https://api.monkeytype.com/users/{}/profile' },
  { name: 'MyAnimeList', category: 'media', errorType: 'status_code', url: 'https://myanimelist.net/profile/{}' },
  { name: 'npm', category: 'developer', errorType: 'status_code', url: 'https://www.npmjs.com/~{}' },
  { name: 'OpenStreetMap', category: 'community', errorType: 'status_code', regex: '^[^.]*?$', url: 'https://www.openstreetmap.org/user/{}' },
  { name: 'Pastebin', category: 'community', errorType: 'message', errorMsg: 'Not Found (#404)', url: 'https://pastebin.com/u/{}' },
  { name: 'Patreon', category: 'social', errorType: 'status_code', url: 'https://www.patreon.com/{}' },
  { name: 'Product Hunt', category: 'social', errorType: 'status_code', url: 'https://www.producthunt.com/@{}' },
  { name: 'PyPI', category: 'developer', errorType: 'status_code', url: 'https://pypi.org/user/{}', probe: 'https://pypi.org/_includes/administer-user-include/{}' },
  { name: 'Replit', category: 'developer', errorType: 'status_code', url: 'https://replit.com/@{}' },
  { name: 'Roblox', category: 'gaming', errorType: 'status_code', url: 'https://www.roblox.com/user.aspx?username={}' },
  { name: 'Rumble', category: 'media', errorType: 'status_code', url: 'https://rumble.com/user/{}' },
  { name: 'Scratch', category: 'gaming', errorType: 'status_code', url: 'https://scratch.mit.edu/users/{}' },
  { name: 'Sketchfab', category: 'creative', errorType: 'status_code', url: 'https://sketchfab.com/{}' },
  { name: 'Snapchat', category: 'social', errorType: 'status_code', regex: '^[a-z][a-z-_.]{3,15}$', url: 'https://www.snapchat.com/add/{}' },
  { name: 'SoundCloud', category: 'media', errorType: 'status_code', url: 'https://soundcloud.com/{}' },
  { name: 'SourceForge', category: 'developer', errorType: 'status_code', url: 'https://sourceforge.net/u/{}' },
  { name: 'Speedrun.com', category: 'gaming', errorType: 'status_code', url: 'https://speedrun.com/users/{}' },
  { name: 'Spotify', category: 'media', errorType: 'status_code', url: 'https://open.spotify.com/user/{}' },
  { name: 'Steam Community', category: 'gaming', errorType: 'message', errorMsg: 'The specified profile could not be found', url: 'https://steamcommunity.com/id/{}/' },
  { name: 'Substack', category: 'media', errorType: 'status_code', regex: '^[a-zA-Z0-9][a-zA-Z0-9_-]{1,60}$', url: 'https://{}.substack.com/' },
  { name: 'Telegram', category: 'social', errorType: 'message', errorMsg: ['<title>Telegram Messenger</title>', 'If you have <strong>Telegram</strong>, you can contact <a class="tgme_username_link" href="tg://resolve?domain='], regex: '^[a-zA-Z0-9_]{3,32}[^_]$', url: 'https://t.me/{}' },
  { name: 'TikTok', category: 'social', errorType: 'message', errorMsg: ['"statusCode":10221', 'Govt. of India decided to block 59 apps'], url: 'https://www.tiktok.com/@{}' },
  { name: 'Topcoder', category: 'developer', errorType: 'status_code', regex: '^[a-zA-Z0-9_.]+$', url: 'https://profiles.topcoder.com/{}/', probe: 'https://api.topcoder.com/v5/members/{}' },
  { name: 'Trakt', category: 'media', errorType: 'status_code', regex: '^[^.]*$', url: 'https://www.trakt.tv/users/{}' },
  { name: 'Trello', category: 'community', errorType: 'message', errorMsg: 'model not found', url: 'https://trello.com/{}', probe: 'https://trello.com/1/Members/{}' },
  { name: 'TryHackMe', category: 'developer', errorType: 'message', errorMsg: '{"success":false}', regex: '^[a-zA-Z0-9.]{1,16}$', url: 'https://tryhackme.com/p/{}', probe: 'https://tryhackme.com/api/user/exist/{}' },
  { name: 'Twitch', category: 'social', errorType: 'message', errorMsg: "content='Twitch is the world&#39;s leading video platform and community for gamers.'", url: 'https://www.twitch.tv/{}' },
  { name: 'X / Twitter', category: 'social', errorType: 'message', errorMsg: ['<div class="error-panel"><span>User ', '<title>429 Too Many Requests</title>'], regex: '^[a-zA-Z0-9_]{1,15}$', url: 'https://x.com/{}', probe: 'https://nitter.privacydev.net/{}' },
  { name: 'Unsplash', category: 'creative', errorType: 'status_code', regex: '^[a-z0-9_]{1,60}$', url: 'https://unsplash.com/@{}' },
  { name: 'Vimeo', category: 'media', errorType: 'status_code', url: 'https://vimeo.com/{}' },
  { name: 'VSCO', category: 'creative', errorType: 'status_code', url: 'https://vsco.co/{}' },
  { name: 'WakaTime', category: 'developer', errorType: 'status_code', url: 'https://wakatime.com/@{}' },
  { name: 'Wattpad', category: 'media', errorType: 'status_code', url: 'https://www.wattpad.com/user/{}', probe: 'https://www.wattpad.com/api/v3/users/{}/' },
  { name: 'Wikipedia', category: 'community', errorType: 'message', errorMsg: 'centralauth-admin-nonexistent:', url: 'https://en.wikipedia.org/wiki/Special:CentralAuth/{}?uselang=qqx' },
  { name: 'Xbox Gamertag', category: 'gaming', errorType: 'status_code', url: 'https://xboxgamertag.com/search/{}' },
  { name: 'YouTube', category: 'media', errorType: 'status_code', url: 'https://www.youtube.com/@{}' },

  { name: 'APClips', category: 'adult', nsfw: true, errorType: 'message', errorMsg: 'Amateur Porn Content Creators', url: 'https://apclips.com/{}' },
  { name: 'AdmireMe.Vip', category: 'adult', nsfw: true, errorType: 'message', errorMsg: 'Page Not Found', url: 'https://admireme.vip/{}' },
  { name: 'All Things Worn', category: 'adult', nsfw: true, errorType: 'message', errorMsg: 'Sell Used Panties', url: 'https://www.allthingsworn.com/profile/{}' },
  { name: 'BongaCams', category: 'adult', nsfw: true, errorType: 'status_code', url: 'https://pt.bongacams.com/profile/{}' },
  { name: 'Chaturbate', category: 'adult', nsfw: true, errorType: 'status_code', url: 'https://chaturbate.com/{}' },
  { name: 'Erome', category: 'adult', nsfw: true, errorType: 'status_code', url: 'https://www.erome.com/{}' },
  { name: 'Forum Ophilia', category: 'adult', nsfw: true, errorType: 'message', errorMsg: 'that user does not exist', url: 'https://www.forumophilia.com/profile.php?mode=viewprofile&u={}' },
  { name: 'Heavy-R', category: 'adult', nsfw: true, errorType: 'message', errorMsg: 'Channel not found', url: 'https://www.heavy-r.com/user/{}' },
  { name: 'ImageFap', category: 'adult', nsfw: true, errorType: 'message', errorMsg: 'Not found', url: 'https://www.imagefap.com/profile/{}' },
  { name: 'LushStories', category: 'adult', nsfw: true, errorType: 'response_url', errorUrl: 'https://www.lushstories.com/login', url: 'https://www.lushstories.com/profile/{}' },
  { name: 'Motherless', category: 'adult', nsfw: true, errorType: 'message', errorMsg: 'no longer a member', url: 'https://motherless.com/m/{}' },
  { name: 'PocketStars', category: 'adult', nsfw: true, errorType: 'message', errorMsg: 'Join Your Favorite Adult Stars', url: 'https://pocketstars.com/{}' },
  { name: 'Pornhub', category: 'adult', nsfw: true, errorType: 'status_code', url: 'https://pornhub.com/users/{}' },
  { name: 'RedTube', category: 'adult', nsfw: true, errorType: 'status_code', url: 'https://www.redtube.com/users/{}' },
  { name: 'RocketTube', category: 'adult', nsfw: true, errorType: 'message', errorMsg: 'OOPS! Houston, we have a problem', url: 'https://www.rockettube.com/{}' },
  { name: 'TnAFlix', category: 'adult', nsfw: true, errorType: 'status_code', url: 'https://www.tnaflix.com/profile/{}' },
  { name: 'XVideos', category: 'adult', nsfw: true, errorType: 'status_code', url: 'https://xvideos.com/profiles/{}' },
  { name: 'YouPorn', category: 'adult', nsfw: true, errorType: 'status_code', url: 'https://youporn.com/uservids/{}' },
  { name: 'xHamster', category: 'adult', nsfw: true, errorType: 'status_code', url: 'https://xhamster.com/users/{}', probe: 'https://xhamster.com/users/{}?old_browser=true' },
];

export const catalogSources: SourceDefinition[] = entries.map(createCatalogSource);
export const catalogStats = {
  total: entries.length,
  nsfw: entries.filter((entry) => entry.nsfw).length,
  standard: entries.filter((entry) => !entry.nsfw).length,
  provenance: SHERLOCK_SNAPSHOT,
} as const;
