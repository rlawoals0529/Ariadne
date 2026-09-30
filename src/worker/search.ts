import type { SearchResponse, SourceResult } from '../shared/types.js';
import { sources, type SourceDefinition } from './sources.js';

const TIMEOUT_MS = 5500;

async function checkSource(source: SourceDefinition, username: string): Promise<SourceResult> {
  const checkedAt = new Date().toISOString();
  const started = Date.now();
  const profileUrl = source.profileUrl(username);

  if (source.validate && !source.validate(username)) {
    return {
      sourceId: source.id,
      sourceName: source.name,
      profileUrl,
      status: 'SKIPPED',
      confidence: 'none',
      reason: 'This username does not satisfy the source’s documented identifier format.',
      httpStatus: null,
      checkedAt,
      durationMs: Date.now() - started,
      signals: [{ kind: 'negative', detail: 'Source-specific username validation failed before any network request.' }],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('source timeout'), TIMEOUT_MS);
  try {
    const { httpStatus, verdict } = await source.probe(username, controller.signal);
    return {
      sourceId: source.id,
      sourceName: source.name,
      profileUrl,
      httpStatus,
      checkedAt,
      durationMs: Date.now() - started,
      ...verdict,
    };
  } catch (error) {
    const timedOut = controller.signal.aborted;
    return {
      sourceId: source.id,
      sourceName: source.name,
      profileUrl,
      status: 'UNKNOWN',
      confidence: 'none',
      reason: timedOut ? 'The source did not answer before the verification timeout.' : 'The source request failed before Ariadne could verify the account.',
      httpStatus: null,
      checkedAt,
      durationMs: Date.now() - started,
      signals: [{ kind: 'error', detail: timedOut ? `Timed out after ${TIMEOUT_MS} ms.` : error instanceof Error ? error.message : 'Unknown network error.' }],
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function validateUsername(input: unknown): string {
  if (typeof input !== 'string') throw new Error('query must be a string');
  const value = input.trim();
  if (!value) throw new Error('query is required');
  if (value.length > 64) throw new Error('query must be 64 characters or fewer');
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error('query contains unsupported characters');
  return value;
}

export async function searchUsername(username: string): Promise<SearchResponse> {
  const results = await Promise.all(sources.map((source) => checkSource(source, username)));
  const summary: SearchResponse['summary'] = { FOUND: 0, NOT_FOUND: 0, UNKNOWN: 0, BLOCKED: 0, SKIPPED: 0 };
  for (const result of results) summary[result.status] += 1;

  return {
    query: username,
    kind: 'username',
    checkedAt: new Date().toISOString(),
    sourceCount: sources.length,
    results,
    summary,
  };
}
