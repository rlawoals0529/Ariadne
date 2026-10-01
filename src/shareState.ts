export type SharedSetup = {
  mode: 'solo' | 'party';
  usernames: string[];
  includeNsfw: boolean;
};

const HASH_PREFIX = '#setup?';
const FRIEND_LIMIT = 6;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function cleanUsernames(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const username = value.trim();
    const key = username.toLocaleLowerCase();
    if (!USERNAME_PATTERN.test(username) || seen.has(key)) continue;
    seen.add(key);
    output.push(username);
  }

  return output;
}

export function buildShareHash(mode: SharedSetup['mode'], usernames: string[], includeNsfw = false) {
  const cleaned = cleanUsernames(usernames);
  if (mode === 'solo' && cleaned.length < 1) return '';
  if (mode === 'party' && (cleaned.length < 2 || cleaned.length > FRIEND_LIMIT)) return '';

  const params = new URLSearchParams();
  params.set('mode', mode);
  for (const username of mode === 'solo' ? cleaned.slice(0, 1) : cleaned) params.append('u', username);
  if (includeNsfw) params.set('adult', '1');
  return `${HASH_PREFIX}${params.toString()}`;
}

export function parseShareHash(hash: string): SharedSetup | null {
  if (!hash.startsWith(HASH_PREFIX)) return null;

  const params = new URLSearchParams(hash.slice(HASH_PREFIX.length));
  const mode = params.get('mode');
  if (mode !== 'solo' && mode !== 'party') return null;

  const usernames = cleanUsernames(params.getAll('u'));
  if (mode === 'solo' && usernames.length !== 1) return null;
  if (mode === 'party' && (usernames.length < 2 || usernames.length > FRIEND_LIMIT)) return null;

  return {
    mode,
    usernames,
    includeNsfw: params.get('adult') === '1',
  };
}
