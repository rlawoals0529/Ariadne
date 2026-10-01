import type { SourceCategory } from '../shared/types.js';
import { classifyHttpFailure, type Verdict } from './evidence.js';
import type { SourceDefinition } from './sources.js';

type ErrorType = 'status_code' | 'message' | 'response_url';

type Entry = {
  name: string;
  category: SourceCategory;
  url: string;
  probe?: string;
  errorType: ErrorType;
  errorMsg?: string;
  errorUrl?: string;
  regex?: string;
};

const SNAPSHOT = 'sherlock-project/sherlock@e40a45ec2a074b90703b3b4b842c8a3adbd6ada3';
const BODY_LIMIT = 64_000;
const BLOCK_MARKERS = [
  '<title>just a moment...</title>',
  'cf-chl-',
  'challenge-platform',
  'cf-turnstile',
  'g-recaptcha',
  'hcaptcha',
  '<title>access denied</title>',
];

const headers = {
  Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
  'User-Agent': 'Ariadne/0.4 public-profile-verifier',
};

function fill(template: string, username: string) {
  return template.replaceAll('{}', encodeURIComponent(username));
}

function idFor(name: string) {
  return `catalog-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    return `${url.origin}${path}${url.search}`;
  } catch {
    return value.replace(/\/+$/, '');
  }
}

function isGenericRedirect(target: string, finalUrl: string): boolean {
  try {
    if (normalizeUrl(target) === normalizeUrl(finalUrl)) return false;
    const targetUrl = new URL(target);
    const final = new URL(finalUrl);
    const targetPath = targetUrl.pathname.replace(/\/+$/, '') || '/';
    const finalPath = final.pathname.replace(/\/+$/, '') || '/';
    if (targetPath === finalPath) return false;
    return finalPath === '/'
      || /\/(?:login|log-in|signin|sign-in|auth|404|not-found|notfound)(?:\/|$)/i.test(finalPath);
  } catch {
    return false;
  }
}

function uncertain(status: number, detail: string): Verdict {
  return {
    status: 'UNKNOWN',
    confidence: 'none',
    reason: 'The public source did not return enough profile-specific evidence to decide.',
    signals: [
      { kind: 'status', detail: `HTTP ${status}` },
      { kind: 'provenance', detail },
      { kind: 'provenance', detail: `Rule adapted from ${SNAPSHOT}.` },
    ],
  };
}

function notFound(status: number, detail: string): Verdict {
  return {
    status: 'NOT_FOUND',
    confidence: 'medium',
    reason: 'The public source returned its configured missing-profile signal.',
    signals: [
      { kind: 'status', detail: `HTTP ${status}` },
      { kind: 'negative', detail },
      { kind: 'provenance', detail: `Rule adapted from ${SNAPSHOT}.` },
    ],
  };
}

function possible(status: number, rule: ErrorType): Verdict {
  return {
    status: 'POSSIBLE',
    confidence: 'medium',
    reason: 'The public profile rule suggests a match, but Ariadne does not have direct identity evidence for this source.',
    signals: [
      { kind: 'status', detail: `HTTP ${status}` },
      { kind: 'identity', detail: `The configured ${rule.replace('_', ' ')} rule did not produce a missing-profile signal.` },
      { kind: 'provenance', detail: `Rule adapted from ${SNAPSHOT}; heuristic matches remain possible until manually confirmed.` },
    ],
  };
}

async function readTextLimited(response: Response) {
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

function createSource(entry: Entry): SourceDefinition {
  let validator: RegExp | null = null;
  if (entry.regex) {
    try { validator = new RegExp(entry.regex); } catch { validator = null; }
  }

  return {
    id: idFor(entry.name),
    name: entry.name,
    category: entry.category,
    nsfw: false,
    profileUrl: (username) => fill(entry.url, username),
    validate: validator ? (username) => validator!.test(username) : undefined,
    probe: async (username, signal) => {
      const target = fill(entry.probe ?? entry.url, username);
      const response = await fetch(target, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal,
      });
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
              { kind: 'provenance', detail: `Rule adapted from ${SNAPSHOT}.` },
            ],
          },
        };
      }
      if (response.status === 404 || response.status === 410) {
        return { httpStatus: response.status, verdict: notFound(response.status, `Missing-profile status matched HTTP ${response.status}.`) };
      }

      const body = await readTextLimited(response);
      const lower = body.toLowerCase();
      if (BLOCK_MARKERS.some((marker) => lower.includes(marker))) {
        return {
          httpStatus: response.status,
          verdict: {
            status: 'BLOCKED',
            confidence: 'none',
            reason: 'The source returned an anti-bot or CAPTCHA challenge, so Ariadne will not infer a match.',
            signals: [
              { kind: 'block', detail: 'Challenge-page marker detected.' },
              { kind: 'provenance', detail: `Rule adapted from ${SNAPSHOT}.` },
            ],
          },
        };
      }

      if (entry.errorType === 'message' && entry.errorMsg && body.includes(entry.errorMsg)) {
        return { httpStatus: response.status, verdict: notFound(response.status, `Matched negative marker: ${entry.errorMsg.slice(0, 120)}`) };
      }

      if (entry.errorType === 'response_url' && entry.errorUrl) {
        if (normalizeUrl(response.url) === normalizeUrl(fill(entry.errorUrl, username))) {
          return { httpStatus: response.status, verdict: notFound(response.status, `Final URL matched ${entry.errorUrl}.`) };
        }
      }

      if (response.ok && isGenericRedirect(target, response.url)) {
        return {
          httpStatus: response.status,
          verdict: uncertain(response.status, `Profile request redirected to generic destination ${response.url}.`),
        };
      }

      if (response.ok && !body.trim()) {
        return {
          httpStatus: response.status,
          verdict: uncertain(response.status, 'Successful response body was empty.'),
        };
      }

      if (response.ok) return { httpStatus: response.status, verdict: possible(response.status, entry.errorType) };

      return {
        httpStatus: response.status,
        verdict: {
          status: 'UNKNOWN',
          confidence: 'none',
          reason: 'The source response was neither a configured match nor a reliable missing-profile signal.',
          signals: [
            { kind: 'status', detail: `HTTP ${response.status}` },
            { kind: 'provenance', detail: `Rule adapted from ${SNAPSHOT}.` },
          ],
        },
      };
    },
  };
}

const entries: Entry[] = [
  { name: '9GAG', category: 'social', errorType: 'status_code', url: 'https://www.9gag.com/u/{}' },
  { name: 'Academia.edu', category: 'community', errorType: 'status_code', regex: '^[^.]*$', url: 'https://independent.academia.edu/{}' },
  { name: 'Airbit', category: 'media', errorType: 'status_code', url: 'https://airbit.com/{}' },
  { name: 'Airliners', category: 'community', errorType: 'status_code', url: 'https://www.airliners.net/user/{}/profile/photos' },
  { name: 'Apple Developer', category: 'developer', errorType: 'status_code', url: 'https://developer.apple.com/forums/profile/{}' },
  { name: 'Apple Discussions', category: 'community', errorType: 'message', errorMsg: 'Looking for something in Apple Support Communities?', url: 'https://discussions.apple.com/profile/{}' },
  { name: 'Aparat', category: 'media', errorType: 'status_code', url: 'https://www.aparat.com/{}/', probe: 'https://www.aparat.com/api/fa/v1/user/user/information/username/{}' },
  { name: 'Archive of Our Own', category: 'media', errorType: 'status_code', regex: '^[^.]*?$', url: 'https://archiveofourown.org/users/{}' },
  { name: 'Arduino Forum', category: 'developer', errorType: 'status_code', url: 'https://forum.arduino.cc/u/{}/summary' },
  { name: 'Asciinema', category: 'developer', errorType: 'status_code', url: 'https://asciinema.org/~{}' },
  { name: 'AudioJungle', category: 'creative', errorType: 'status_code', regex: '^[a-zA-Z0-9_]+$', url: 'https://audiojungle.net/user/{}' },
  { name: 'AWS Skills Profile', category: 'developer', errorType: 'message', errorMsg: 'shareProfileAccepted\":false', url: 'https://skillsprofile.skillbuilder.aws/user/{}/' },
  { name: 'BOOTH', category: 'creative', errorType: 'response_url', errorUrl: 'https://booth.pm/', regex: '^[\\w@-]+?$', url: 'https://{}.booth.pm/' },
  { name: 'BiggerPockets', category: 'community', errorType: 'status_code', url: 'https://www.biggerpockets.com/users/{}' },
  { name: 'Bitwarden Forum', category: 'developer', errorType: 'status_code', regex: '^(?![.-])[a-zA-Z0-9_.-]{3,20}$', url: 'https://community.bitwarden.com/u/{}/summary' },
  { name: 'Blipfoto', category: 'creative', errorType: 'status_code', url: 'https://www.blipfoto.com/{}' },
  { name: 'Blogger', category: 'media', errorType: 'status_code', regex: '^[a-zA-Z][a-zA-Z0-9_-]*$', url: 'https://{}.blogspot.com' },
  { name: 'BookCrossing', category: 'community', errorType: 'status_code', url: 'https://www.bookcrossing.com/mybookshelf/{}/' },
  { name: 'Brave Community', category: 'community', errorType: 'status_code', url: 'https://community.brave.com/u/{}/' },
  { name: 'BuzzFeed', category: 'media', errorType: 'status_code', url: 'https://buzzfeed.com/{}' },
  { name: 'Cfx.re Forum', category: 'gaming', errorType: 'status_code', url: 'https://forum.cfx.re/u/{}/summary' },
  { name: 'Pinterest', category: 'creative', errorType: 'status_code', url: 'https://www.pinterest.com/{}/', probe: 'https://www.pinterest.com/oembed.json?url=https://www.pinterest.com/{}/' },
  { name: 'CGTrader', category: 'creative', errorType: 'status_code', regex: '^[^.]*?$', url: 'https://www.cgtrader.com/{}' },
  { name: 'Carbonmade', category: 'creative', errorType: 'response_url', errorUrl: 'https://carbonmade.com/fourohfour?domain={}.carbonmade.com', regex: '^[\\w@-]+?$', url: 'https://{}.carbonmade.com' },
  { name: 'CodeChef', category: 'developer', errorType: 'response_url', errorUrl: 'https://www.codechef.com/', url: 'https://www.codechef.com/users/{}' },
  { name: 'CodeSandbox', category: 'developer', errorType: 'message', errorMsg: 'Could not find user with username', regex: '^[a-zA-Z0-9_-]{3,30}$', url: 'https://codesandbox.io/u/{}', probe: 'https://codesandbox.io/api/v1/users/{}' },
  { name: 'Coderwall', category: 'developer', errorType: 'status_code', url: 'https://coderwall.com/{}' },
  { name: 'Crowdin', category: 'developer', errorType: 'status_code', regex: '^[a-zA-Z0-9._-]{2,255}$', url: 'https://crowdin.com/profile/{}' },
  { name: 'Credly', category: 'developer', errorType: 'status_code', url: 'https://www.credly.com/users/{}' },
  { name: 'Cults3D', category: 'creative', errorType: 'message', errorMsg: 'Oh dear, this page is not working!', url: 'https://cults3d.com/en/users/{}/creations' },
  { name: 'DailyMotion', category: 'media', errorType: 'status_code', url: 'https://www.dailymotion.com/{}' },
  { name: 'Disqus', category: 'community', errorType: 'status_code', url: 'https://disqus.com/{}' },
  { name: 'DMOJ', category: 'developer', errorType: 'message', errorMsg: 'No such user', url: 'https://dmoj.ca/user/{}' },
  { name: 'EyeEm', category: 'creative', errorType: 'status_code', url: 'https://www.eyeem.com/u/{}' },
  { name: 'Flightradar24', category: 'community', errorType: 'status_code', regex: '^[a-zA-Z0-9_]{3,20}$', url: 'https://my.flightradar24.com/{}' },
  { name: 'Flipboard', category: 'media', errorType: 'status_code', regex: '^([a-zA-Z0-9_]){1,15}$', url: 'https://flipboard.com/@{}' },
  { name: 'Giphy', category: 'media', errorType: 'message', errorMsg: '<title> GIFs - Find &amp; Share on GIPHY</title>', url: 'https://giphy.com/{}' },
  { name: 'Gitee', category: 'developer', errorType: 'status_code', url: 'https://gitee.com/{}' },
  { name: 'GitBook', category: 'developer', errorType: 'status_code', regex: '^[\\w@-]+?$', url: 'https://{}.gitbook.io/' },
  { name: 'Gumroad', category: 'creative', errorType: 'message', errorMsg: 'Page not found (404) - Gumroad', regex: '^[^.]*?$', url: 'https://www.gumroad.com/{}' },
  { name: 'HackerEarth', category: 'developer', errorType: 'status_code', url: 'https://hackerearth.com/@{}' },
  { name: 'hackster', category: 'developer', errorType: 'status_code', url: 'https://www.hackster.io/{}' },
  { name: 'Instructables', category: 'creative', errorType: 'status_code', url: 'https://www.instructables.com/member/{}' },
  { name: 'Kongregate', category: 'gaming', errorType: 'status_code', regex: '^[a-zA-Z][a-zA-Z0-9_-]*$', url: 'https://www.kongregate.com/accounts/{}' },
  { name: 'LemmyWorld', category: 'community', errorType: 'message', errorMsg: '<h1>Error!</h1>', url: 'https://lemmy.world/u/{}' },
  { name: 'Lobsters', category: 'developer', errorType: 'status_code', regex: '[A-Za-z0-9][A-Za-z0-9_-]{0,24}', url: 'https://lobste.rs/u/{}' },
  { name: 'MuseScore', category: 'creative', errorType: 'status_code', url: 'https://musescore.com/{}' },
  { name: 'MyMiniFactory', category: 'creative', errorType: 'status_code', url: 'https://www.myminifactory.com/users/{}' },
  { name: 'Newgrounds', category: 'creative', errorType: 'status_code', regex: '^[a-zA-Z][a-zA-Z0-9_-]*$', url: 'https://{}.newgrounds.com' },
  { name: 'ObservableHQ', category: 'developer', errorType: 'message', errorMsg: 'Page not found', url: 'https://observablehq.com/@{}' },
  { name: 'Odysee', category: 'media', errorType: 'message', errorMsg: '<link rel="canonical" content="odysee.com"/>', url: 'https://odysee.com/@{}' },
  { name: 'Open Collective', category: 'community', errorType: 'status_code', url: 'https://opencollective.com/{}' },
  { name: 'OpenGameArt', category: 'creative', errorType: 'status_code', url: 'https://opengameart.org/users/{}' },
  { name: 'Packagist', category: 'developer', errorType: 'response_url', errorUrl: 'https://packagist.org/search/?q={}&reason=vendor_not_found', url: 'https://packagist.org/packages/{}/' },
  { name: 'Pokemon Showdown', category: 'gaming', errorType: 'status_code', url: 'https://pokemonshowdown.com/users/{}' },
  { name: 'Pronouns.page', category: 'social', errorType: 'status_code', url: 'https://pronouns.page/@{}' },
  { name: 'PSNProfiles.com', category: 'gaming', errorType: 'response_url', errorUrl: 'https://psnprofiles.com/?psnId={}', url: 'https://psnprofiles.com/{}' },
  { name: 'Python.org Discussions', category: 'developer', errorType: 'message', errorMsg: 'Oops! That page doesn’t exist or is private.', url: 'https://discuss.python.org/u/{}/summary' },
  { name: 'Rate Your Music', category: 'media', errorType: 'status_code', url: 'https://rateyourmusic.com/~{}' },
  { name: 'Redbubble', category: 'creative', errorType: 'status_code', url: 'https://www.redbubble.com/people/{}' },
  { name: 'ResearchGate', category: 'community', errorType: 'response_url', errorUrl: 'https://www.researchgate.net/directory/profiles', regex: '\\w+_\\w+', url: 'https://www.researchgate.net/profile/{}' },
  { name: 'ReverbNation', category: 'media', errorType: 'message', errorMsg: "Sorry, we couldn't find that page", url: 'https://www.reverbnation.com/{}' },
  { name: 'RubyGems', category: 'developer', errorType: 'status_code', regex: '^[a-zA-Z][a-zA-Z0-9_-]{1,40}$', url: 'https://rubygems.org/profiles/{}' },
  { name: 'RuneScape', category: 'gaming', errorType: 'message', errorMsg: '{"error":"NO_PROFILE","loggedIn":"false"}', regex: '^(?! )[\\w -]{1,12}(?<! )$', url: 'https://apps.runescape.com/runemetrics/app/overview/player/{}', probe: 'https://apps.runescape.com/runemetrics/profile/profile?user={}' },
  { name: 'Scribd', category: 'media', errorType: 'message', errorMsg: 'Page not found', url: 'https://www.scribd.com/{}' },
  { name: 'SlideShare', category: 'media', errorType: 'message', errorMsg: '<title>Page no longer exists</title>', url: 'https://slideshare.net/{}' },
  { name: 'SmugMug', category: 'creative', errorType: 'status_code', regex: '^[a-zA-Z]{1,35}$', url: 'https://{}.smugmug.com' },
  { name: 'SpaceHey', category: 'social', errorType: 'message', errorMsg: 'Not Found (Error 404) | SpaceHey', url: 'https://spacehey.com/{}' },
  { name: 'SpeakerDeck', category: 'creative', errorType: 'status_code', url: 'https://speakerdeck.com/{}' },
  { name: 'Splice', category: 'media', errorType: 'status_code', url: 'https://splice.com/{}' },
  { name: 'Splits.io', category: 'gaming', errorType: 'status_code', regex: '^[^.]*?$', url: 'https://splits.io/users/{}' },
  { name: 'Status Cafe', category: 'social', errorType: 'message', errorMsg: 'Page Not Found', url: 'https://status.cafe/users/{}' },
  { name: 'TETR.IO', category: 'gaming', errorType: 'message', errorMsg: 'No such user!', url: 'https://ch.tetr.io/u/{}', probe: 'https://ch.tetr.io/api/users/{}' },
  { name: 'TheMovieDB', category: 'media', errorType: 'status_code', url: 'https://www.themoviedb.org/u/{}' },
  { name: 'TradingView', category: 'community', errorType: 'status_code', url: 'https://www.tradingview.com/u/{}/' },
  { name: 'Trovo', category: 'media', errorType: 'message', errorMsg: 'Uh Ohhh...', url: 'https://trovo.live/s/{}/' },
  { name: 'tumblr', category: 'social', errorType: 'status_code', url: 'https://{}.tumblr.com/' },
  { name: 'Typeracer', category: 'gaming', errorType: 'message', errorMsg: 'Profile Not Found', url: 'https://data.typeracer.com/pit/profile?user={}' },
  { name: 'Ultimate-Guitar', category: 'media', errorType: 'status_code', url: 'https://ultimate-guitar.com/u/{}' },
  { name: 'Untappd', category: 'social', errorType: 'status_code', url: 'https://untappd.com/user/{}' },
  { name: 'VirusTotal', category: 'developer', errorType: 'status_code', url: 'https://www.virustotal.com/gui/user/{}' },
  { name: 'WordPress', category: 'media', errorType: 'response_url', errorUrl: 'wordpress.com/typo/?subdomain=', regex: '^[a-zA-Z][a-zA-Z0-9_-]*$', url: 'https://{}.wordpress.com/' },
  { name: 'WordPress.org', category: 'community', errorType: 'response_url', errorUrl: 'https://wordpress.org', url: 'https://profiles.wordpress.org/{}/' },
  { name: 'devRant', category: 'developer', errorType: 'response_url', errorUrl: 'https://devrant.com/', url: 'https://devrant.com/users/{}' },
  { name: 'geocaching', category: 'community', errorType: 'status_code', url: 'https://www.geocaching.com/p/default.aspx?u={}' },
  { name: 'osu!', category: 'gaming', errorType: 'status_code', url: 'https://osu.ppy.sh/users/{}' },
  { name: 'write.as', category: 'media', errorType: 'status_code', url: 'https://write.as/{}' },
  { name: 'YouNow', category: 'media', errorType: 'message', errorMsg: 'No users found', url: 'https://www.younow.com/{}/', probe: 'https://api.younow.com/php/api/broadcast/info/user={}/' },
  { name: 'YouPic', category: 'creative', errorType: 'status_code', url: 'https://youpic.com/photographer/{}/' },
  { name: 'Ask Fedora', category: 'developer', errorType: 'status_code', url: 'https://ask.fedoraproject.org/u/{}' },
  { name: 'Caddy Community', category: 'developer', errorType: 'status_code', url: 'https://caddy.community/u/{}/summary' },
  { name: 'Cloudflare Community', category: 'developer', errorType: 'status_code', url: 'https://community.cloudflare.com/u/{}' },
  { name: 'Choice Community', category: 'community', errorType: 'status_code', url: 'https://choice.community/u/{}/summary' },
  { name: 'Discuss Elastic', category: 'developer', errorType: 'status_code', url: 'https://discuss.elastic.co/u/{}' },
  { name: 'Joplin Forum', category: 'developer', errorType: 'status_code', url: 'https://discourse.joplinapp.org/u/{}' },
  { name: 'Jupyter Community Forum', category: 'developer', errorType: 'message', errorMsg: 'Oops! That page doesn’t exist or is private.', url: 'https://discourse.jupyter.org/u/{}/summary' },
  { name: 'Nextcloud Forum', category: 'developer', errorType: 'status_code', regex: '^(?![.-])[a-zA-Z0-9_.-]{3,20}$', url: 'https://help.nextcloud.com/u/{}/summary' },
  { name: 'n8n Community', category: 'developer', errorType: 'status_code', url: 'https://community.n8n.io/u/{}/summary' },
  { name: 'Sublime Forum', category: 'developer', errorType: 'status_code', url: 'https://forum.sublimetext.com/u/{}' },
  { name: 'WICG Forum', category: 'developer', errorType: 'status_code', regex: '^(?![.-])[a-zA-Z0-9_.-]{3,20}$', url: 'https://discourse.wicg.io/u/{}/summary' },
  { name: 'LessWrong', category: 'community', errorType: 'response_url', errorUrl: 'https://www.lesswrong.com/', url: 'https://www.lesswrong.com/users/{}' },
  { name: 'LinuxFR.org', category: 'community', errorType: 'status_code', url: 'https://linuxfr.org/users/{}' },
  { name: 'LiveJournal', category: 'social', errorType: 'status_code', regex: '^[a-zA-Z][a-zA-Z0-9_-]*$', url: 'https://{}.livejournal.com' },
  { name: 'MyDramaList', category: 'media', errorType: 'message', errorMsg: 'The requested page was not found', url: 'https://www.mydramalist.com/profile/{}' },
  { name: 'NintendoLife', category: 'gaming', errorType: 'status_code', url: 'https://www.nintendolife.com/users/{}' },
  { name: 'NitroType', category: 'gaming', errorType: 'message', errorMsg: '<title>Nitro Type | Competitive Typing Game | Race Your Friends</title>', url: 'https://www.nitrotype.com/racer/{}' },
  { name: 'NotABug.org', category: 'developer', errorType: 'status_code', url: 'https://notabug.org/{}', probe: 'https://notabug.org/{}/followers' },
  { name: 'Nothing Community', category: 'community', errorType: 'status_code', url: 'https://nothing.community/u/{}' },
  { name: 'Polygon', category: 'gaming', errorType: 'status_code', url: 'https://www.polygon.com/users/{}' },
  { name: 'Slashdot', category: 'community', errorType: 'message', errorMsg: 'user you requested does not exist', url: 'https://slashdot.org/~{}' },
  { name: 'Sporcle', category: 'gaming', errorType: 'status_code', url: 'https://www.sporcle.com/user/{}/people' },
  { name: 'Star Citizen', category: 'gaming', errorType: 'message', errorMsg: '404', url: 'https://robertsspaceindustries.com/citizens/{}' },
  { name: 'ThemeForest', category: 'creative', errorType: 'status_code', url: 'https://themeforest.net/user/{}' },
  { name: 'VLR', category: 'gaming', errorType: 'status_code', url: 'https://www.vlr.gg/user/{}' },
  { name: 'Wowhead', category: 'gaming', errorType: 'status_code', url: 'https://wowhead.com/user={}' },
  { name: 'CurseForge', category: 'gaming', errorType: 'status_code', url: 'https://www.curseforge.com/members/{}/projects' },
  { name: 'GameFAQs', category: 'gaming', errorType: 'status_code', url: 'https://gamefaqs.gamespot.com/community/{}' },
  { name: 'GameSpot', category: 'gaming', errorType: 'status_code', url: 'https://www.gamespot.com/profile/{}/' },
  { name: 'Giant Bomb', category: 'gaming', errorType: 'status_code', url: 'https://www.giantbomb.com/profile/{}/' },
  { name: 'Genius Users', category: 'media', errorType: 'status_code', regex: '^[a-zA-Z0-9]*?$', url: 'https://genius.com/{}' },
  { name: 'GeeksforGeeks', category: 'developer', errorType: 'message', errorMsg: 'false   | GeeksforGeeks Profile', url: 'https://auth.geeksforgeeks.org/user/{}' },
  { name: 'Gradle Plugins', category: 'developer', errorType: 'status_code', regex: '^(?!-)[a-zA-Z0-9-]{3,}(?<!-)$', url: 'https://plugins.gradle.org/u/{}' },
  { name: 'LottieFiles', category: 'creative', errorType: 'status_code', url: 'https://lottiefiles.com/{}' },
  { name: 'Playstrategy', category: 'gaming', errorType: 'status_code', url: 'https://playstrategy.org/@/{}' },
  { name: 'Pychess', category: 'gaming', errorType: 'message', errorMsg: '404', url: 'https://www.pychess.org/@/{}' },
  { name: 'Slant', category: 'community', errorType: 'status_code', regex: '^.{2,32}$', url: 'https://www.slant.co/users/{}' },
  { name: 'Smule', category: 'media', errorType: 'message', errorMsg: 'Smule | Page Not Found (404)', url: 'https://www.smule.com/{}' },
  { name: 'SOOP', category: 'media', errorType: 'status_code', url: 'https://www.sooplive.co.kr/station/{}', probe: 'https://api-channel.sooplive.co.kr/v1.1/channel/{}/station' },
  { name: 'CSSBattle', category: 'developer', errorType: 'status_code', url: 'https://cssbattle.dev/player/{}' },
  { name: 'CTAN', category: 'developer', errorType: 'status_code', url: 'https://ctan.org/author/{}' },
  { name: 'Coders Rank', category: 'developer', errorType: 'message', errorMsg: 'not a registered member', regex: '^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$', url: 'https://profile.codersrank.io/user/{}/' },
  { name: 'Codolio', category: 'developer', errorType: 'message', errorMsg: '<title>Page Not Found | Codolio</title>', regex: '^[a-zA-Z0-9_-]{3,30}$', url: 'https://codolio.com/profile/{}' },
  { name: 'ColourLovers', category: 'creative', errorType: 'status_code', url: 'https://www.colourlovers.com/lover/{}' },
  { name: 'Contently', category: 'creative', errorType: 'response_url', errorUrl: 'https://contently.com', regex: '^[a-zA-Z][a-zA-Z0-9_-]*$', url: 'https://{}.contently.com/' },
  { name: 'Coroflot', category: 'creative', errorType: 'status_code', url: 'https://www.coroflot.com/{}' },
  { name: 'Crevado', category: 'creative', errorType: 'status_code', regex: '^[\\w@-]+?$', url: 'https://{}.crevado.com' },
  { name: 'CryptoHack', category: 'developer', errorType: 'response_url', errorUrl: 'https://cryptohack.org/', url: 'https://cryptohack.org/user/{}/' },
  { name: 'CyberDefenders', category: 'developer', errorType: 'status_code', regex: '^[^\\/:*?"<>|@]{3,50}$', url: 'https://cyberdefenders.org/p/{}' },
  { name: 'Exposure', category: 'creative', errorType: 'status_code', regex: '^[a-zA-Z0-9-]{1,63}$', url: 'https://{}.exposure.co/' },
  { name: 'HackTheBox', category: 'developer', errorType: 'status_code', url: 'https://forum.hackthebox.com/u/{}' },
  { name: 'Houzz', category: 'creative', errorType: 'status_code', url: 'https://houzz.com/user/{}' },
  { name: 'HubPages', category: 'media', errorType: 'status_code', url: 'https://hubpages.com/@{}' },
  { name: 'Instapaper', category: 'media', errorType: 'status_code', url: 'https://www.instapaper.com/p/{}' },
  { name: 'Issuu', category: 'media', errorType: 'status_code', url: 'https://issuu.com/{}' },
  { name: 'LibraryThing', category: 'media', errorType: 'message', errorMsg: "<p>Error: This user doesn't exist</p>", url: 'https://www.librarything.com/profile/{}' },
  { name: 'PentesterLab', category: 'developer', errorType: 'status_code', regex: '^[\\w]{4,30}$', url: 'https://pentesterlab.com/profile/{}' },
  { name: 'Plurk', category: 'social', errorType: 'message', errorMsg: 'User Not Found!', url: 'https://www.plurk.com/{}' },
  { name: 'Polarsteps', category: 'social', errorType: 'status_code', url: 'https://polarsteps.com/{}', probe: 'https://api.polarsteps.com/users/byusername/{}' },
  { name: 'Replit.com', category: 'developer', errorType: 'status_code', url: 'https://replit.com/@{}' },
  { name: 'Sessionize', category: 'community', errorType: 'status_code', url: 'https://sessionize.com/{}' },
  { name: 'Velog', category: 'media', errorType: 'status_code', url: 'https://velog.io/@{}/posts' },
  { name: 'WebNode', category: 'creative', errorType: 'status_code', regex: '^[\\w@-]+?$', url: 'https://{}.webnode.cz/' },
  { name: 'Weebly', category: 'creative', errorType: 'status_code', regex: '^[a-zA-Z0-9-]{1,63}$', url: 'https://{}.weebly.com/' },
  { name: 'Wix', category: 'creative', errorType: 'status_code', regex: '^[\\w@-]+?$', url: 'https://{}.wix.com' },
  { name: 'Wordnik', category: 'media', errorType: 'message', errorMsg: 'Page Not Found', regex: '^[a-zA-Z0-9_.+-]{1,40}$', url: 'https://www.wordnik.com/users/{}' },
  { name: 'CNET', category: 'community', errorType: 'status_code', regex: '^[a-z].*$', url: 'https://www.cnet.com/profiles/{}/' },
  { name: 'NICommunityForum', category: 'community', errorType: 'message', errorMsg: 'The page you were looking for could not be found.', url: 'https://community.native-instruments.com/profile/{}' },
  { name: 'Weblate', category: 'developer', errorType: 'status_code', regex: '^[a-zA-Z0-9@._-]{1,150}$', url: 'https://hosted.weblate.org/user/{}/' },
  { name: 'Icons8 Community', category: 'community', errorType: 'status_code', url: 'https://community.icons8.com/u/{}/summary' },
  { name: 'Ionic Forum', category: 'developer', errorType: 'status_code', url: 'https://forum.ionicframework.com/u/{}' },
];

export const extendedCatalogSources: SourceDefinition[] = entries.map(createSource);
export const extendedCatalogStats = {
  total: entries.length,
  provenance: SNAPSHOT,
  rules: {
    statusCode: entries.filter((entry) => entry.errorType === 'status_code').length,
    message: entries.filter((entry) => entry.errorType === 'message').length,
    responseUrl: entries.filter((entry) => entry.errorType === 'response_url').length,
    withProbe: entries.filter((entry) => Boolean(entry.probe)).length,
    withRegex: entries.filter((entry) => Boolean(entry.regex)).length,
    statusOnly: entries.filter((entry) => entry.errorType === 'status_code' && !entry.probe && !entry.regex).length,
  },
} as const;
