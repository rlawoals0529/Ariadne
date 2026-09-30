import type { SearchResponse, SourceCategory, SourceResult } from './shared/types.js';

export const CATEGORY_LABELS: Record<SourceCategory, string> = {
  social: 'Social',
  developer: 'Developer',
  gaming: 'Gaming',
  creative: 'Creative',
  media: 'Media',
  community: 'Community',
  adult: 'Adult',
  other: 'Other',
};

export type CategoryAnalytics = {
  category: SourceCategory;
  label: string;
  attempted: number;
  found: number;
  possible: number;
  uncertain: number;
};

export type ScanAnalytics = {
  coveragePercent: number;
  returned: number;
  sourceCount: number;
  attempted: number;
  exactAttempted: number;
  exactDecisions: number;
  exactResolutionPercent: number;
  verifiedMatches: number;
  possibleMatches: number;
  verifiedSharePercent: number;
  uncertaintyPercent: number;
  blockedPercent: number;
  medianLatencyMs: number;
  p90LatencyMs: number;
  categories: CategoryAnalytics[];
  funnel: Array<{ label: string; value: number; note: string }>;
};

function percent(value: number, total: number) {
  return total === 0 ? 0 : Math.round((value / total) * 100);
}

function percentile(values: number[], target: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * target) - 1));
  return sorted[index];
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function isAttempted(result: SourceResult) {
  return result.status !== 'SKIPPED';
}

function isUncertain(result: SourceResult) {
  return result.status === 'UNKNOWN' || result.status === 'BLOCKED';
}

export function buildScanAnalytics(report: SearchResponse): ScanAnalytics {
  const attemptedResults = report.results.filter(isAttempted);
  const exactResults = attemptedResults.filter((result) => result.evidenceBasis === 'direct-api');
  const exactDecisions = exactResults.filter((result) => result.status === 'FOUND' || result.status === 'NOT_FOUND');
  const uncertain = attemptedResults.filter(isUncertain);
  const profileSignals = report.summary.FOUND + report.summary.POSSIBLE;
  const latencies = attemptedResults.map((result) => result.durationMs).filter((duration) => Number.isFinite(duration) && duration >= 0);

  const byCategory = new Map<SourceCategory, CategoryAnalytics>();
  for (const result of attemptedResults) {
    const current = byCategory.get(result.category) ?? {
      category: result.category,
      label: CATEGORY_LABELS[result.category],
      attempted: 0,
      found: 0,
      possible: 0,
      uncertain: 0,
    };
    current.attempted += 1;
    if (result.status === 'FOUND') current.found += 1;
    if (result.status === 'POSSIBLE') current.possible += 1;
    if (isUncertain(result)) current.uncertain += 1;
    byCategory.set(result.category, current);
  }

  const categories = [...byCategory.values()].sort((a, b) => {
    const signalDifference = (b.found + b.possible) - (a.found + a.possible);
    return signalDifference || b.attempted - a.attempted || a.label.localeCompare(b.label);
  });

  return {
    coveragePercent: percent(report.results.length, report.sourceCount),
    returned: report.results.length,
    sourceCount: report.sourceCount,
    attempted: attemptedResults.length,
    exactAttempted: exactResults.length,
    exactDecisions: exactDecisions.length,
    exactResolutionPercent: percent(exactDecisions.length, exactResults.length),
    verifiedMatches: report.summary.FOUND,
    possibleMatches: report.summary.POSSIBLE,
    verifiedSharePercent: percent(report.summary.FOUND, profileSignals),
    uncertaintyPercent: percent(uncertain.length, attemptedResults.length),
    blockedPercent: percent(report.summary.BLOCKED, attemptedResults.length),
    medianLatencyMs: median(latencies),
    p90LatencyMs: percentile(latencies, 0.9),
    categories,
    funnel: [
      { label: 'Sources attempted', value: attemptedResults.length, note: 'Checks that were valid for this username' },
      { label: 'Exact checks', value: exactResults.length, note: 'First-party or standards-based identity lookups' },
      { label: 'Exact decisions', value: exactDecisions.length, note: 'Exact checks that returned Found or No match' },
      { label: 'Verified matches', value: report.summary.FOUND, note: 'Sites that returned the requested username' },
    ],
  };
}
