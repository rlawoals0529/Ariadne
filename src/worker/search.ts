import type { EvidenceBasis, ResultStatus, SearchResponse, SourceResult } from '../shared/types.js';
import { sources, type SourceDefinition } from './sources.js';

const TIMEOUT_MS = 4500;
const CONCURRENCY = 5;
export const SEARCH_BATCH_SIZE = 20;

// These inherited catalog entries currently rely on availability/existence helpers or
// third-party mirrors rather than the first-party public profile itself. Keep them out
// of production scans until Ariadne has a dedicated public-profile adapter for them.
const DISABLED_WIDE_SOURCE_IDS = new Set([
  'catalog-boardgamegeek',
  'catalog-chess-com',
  'catalog-duolingo',
  'catalog-instagram',
  'catalog-pypi',
  'catalog-tryhackme',
  'catalog-x-twitter',
]);

function eligibleSources(): SourceDefinition[] {
  return sources.filter((source) => !DISABLED_WIDE_SOURCE_IDS.has(source.id));
}

function evidenceBasis(source: SourceDefinition): EvidenceBasis {
  return source.id.startsWith('catalog-') ? 'catalog-rule' : 'direct-api';
}

async function checkSource(source: SourceDefinition, username: string): Promise<SourceResult> {
  const checkedAt = new Date().toISOString();
  const started = Date.now();
  const profileUrl = source.profileUrl(username);
  const basis = evidenceBasis(source);

  if (source.validate && !source.validate(username)) {
    return {
      sourceId: source.id,
      sourceName: source.name,
      profileUrl,
      category: source.category,
      nsfw: source.nsfw,
      evidenceBasis: basis,
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
      category: source.category,
      nsfw: source.nsfw,
      evidenceBasis: basis,
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
      category: source.category,
      nsfw: source.nsfw,
      evidenceBasis: basis,
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

async function checkBatch(batch: SourceDefinition[], username: string): Promise<SourceResult[]> {
  const output = new Array<SourceResult>(batch.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= batch.length) return;
      output[index] = await checkSource(batch[index], username);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, () => worker()));
  return output;
}

export function validateUsername(input: unknown): string {
  if (typeof input !== 'string') throw new Error('query must be a string');
  const value = input.trim();
  if (!value) throw new Error('query is required');
  if (value.length > 64) throw new Error('query must be 64 characters or fewer');
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error('query contains unsupported characters');
  return value;
}

export function validateCursor(input: unknown): number {
  if (input === undefined) return 0;
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 0) throw new Error('cursor must be a non-negative integer');
  return input;
}

export function selectSources(includeNsfw: boolean): SourceDefinition[] {
  const eligible = eligibleSources();
  return includeNsfw ? eligible : eligible.filter((source) => !source.nsfw);
}

export function searchableSourceStats() {
  const all = selectSources(true);
  const nsfw = all.filter((source) => source.nsfw).length;
  const direct = all.filter((source) => evidenceBasis(source) === 'direct-api').length;
  return {
    total: all.length,
    standard: all.length - nsfw,
    nsfw,
    direct,
    heuristic: all.length - direct,
    disabled: sources.length - all.length,
  };
}

function emptySummary(): Record<ResultStatus, number> {
  return { FOUND: 0, POSSIBLE: 0, NOT_FOUND: 0, UNKNOWN: 0, BLOCKED: 0, SKIPPED: 0 };
}

export async function searchUsername(username: string, options: { includeNsfw: boolean; cursor: number }): Promise<SearchResponse> {
  const selected = selectSources(options.includeNsfw);
  const cursor = Math.min(options.cursor, selected.length);
  const batch = selected.slice(cursor, cursor + SEARCH_BATCH_SIZE);
  const results = await checkBatch(batch, username);
  const summary = emptySummary();
  for (const result of results) summary[result.status] += 1;
  const next = cursor + batch.length;

  return {
    query: username,
    kind: 'username',
    checkedAt: new Date().toISOString(),
    sourceCount: selected.length,
    batchCount: batch.length,
    includeNsfw: options.includeNsfw,
    nextCursor: next < selected.length ? next : null,
    results,
    summary,
  };
}
