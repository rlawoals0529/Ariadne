import { searchableSourceStats, searchUsername, validateCursor, validateUsername } from './search.js';
import { sourceStats } from './sources.js';

type RateLimit = { limit(options: { key: string }): Promise<{ success: boolean }> };
type Env = { SEARCH_RATE_LIMITER: RateLimit; ASSETS?: { fetch(request: Request): Promise<Response> } };

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
} as const;

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', ...extra },
  });
}

function publicSourceStats() {
  return { ...searchableSourceStats(), provenance: sourceStats.provenance };
}

async function handleSearch(request: Request, env: Env): Promise<Response> {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return json({ error: 'application/json required' }, 415);
  }

  let body: { query?: unknown; kind?: unknown; includeNsfw?: unknown; cursor?: unknown };
  try {
    body = await request.json() as { query?: unknown; kind?: unknown; includeNsfw?: unknown; cursor?: unknown };
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  if (body.kind !== undefined && body.kind !== 'username') {
    return json({ error: 'only username search is enabled' }, 400);
  }
  if (body.includeNsfw !== undefined && typeof body.includeNsfw !== 'boolean') {
    return json({ error: 'includeNsfw must be a boolean' }, 400);
  }

  let username: string;
  let cursor: number;
  try {
    username = validateUsername(body.query);
    cursor = validateCursor(body.cursor);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'invalid query' }, 400);
  }

  const client = request.headers.get('CF-Connecting-IP') ?? 'anonymous';
  const limiter = await env.SEARCH_RATE_LIMITER.limit({ key: `username-search:${client}` });
  if (!limiter.success) return json({ error: 'search rate limit exceeded; retry shortly' }, 429);

  return json(await searchUsername(username, { includeNsfw: body.includeNsfw === true, cursor }));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        return json({ ok: true, service: 'ariadne', version: '0.5.1', sources: publicSourceStats() });
      }
      if (request.method === 'GET' && url.pathname === '/api/sources') {
        return json(publicSourceStats());
      }
      if (request.method === 'POST' && url.pathname === '/api/search') {
        return await handleSearch(request, env);
      }
      if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('request failed', error instanceof Error ? error.message : 'unknown error');
      return json({ error: 'internal server error' }, 500);
    }
  },
};
