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
      const response = await fetch(fill(entry.probe ?? entry.url, username), {
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
];

export const extendedCatalogSources: SourceDefinition[] = entries.map(createSource);
export const extendedCatalogStats = {
  total: entries.length,
  provenance: SNAPSHOT,
} as const;
