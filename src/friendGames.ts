import type { SearchResponse, SourceResult } from './shared/types.js';

function isTrail(result: SourceResult) {
  return result.status === 'FOUND' || result.status === 'POSSIBLE';
}

export type FriendPair = {
  names: [string, string];
  shared: number;
  verifiedShared: number;
  union: number;
  similarity: number;
  topCategory: string | null;
  topCategoryCount: number;
};

export type FriendSharedSource = {
  sourceId: string;
  sourceName: string;
  category: SourceResult['category'];
  participantCount: number;
  foundCount: number;
  possibleCount: number;
  statuses: Array<{
    query: string;
    status: 'FOUND' | 'POSSIBLE';
  }>;
};

export type FriendMetrics = {
  participants: Array<{
    query: string;
    confirmed: number;
    possible: number;
    trail: number;
    unique: string[];
    categories: Array<[string, number]>;
  }>;
  shared: string[];
  sharedDetails: FriendSharedSource[];
  verifiedShared: string[];
  everyoneSites: string[];
  verifiedEveryoneSites: string[];
  mostFound: string[];
  mostUnique: string[];
  closestPair: FriendPair | null;
  internetTwins: FriendPair | null;
  mostDifferentPair: FriendPair | null;
  categoryPair: FriendPair | null;
};

export function buildFriendMetrics(reports: SearchResponse[]): FriendMetrics {
  const sourceUsers = new Map<string, Set<string>>();
  const verifiedSourceUsers = new Map<string, Set<string>>();
  const sourceNames = new Map<string, string>();
  const sourceCategories = new Map<string, SourceResult['category']>();
  const sourceStatuses = new Map<string, Map<string, 'FOUND' | 'POSSIBLE'>>();

  for (const report of reports) {
    for (const result of report.results.filter(isTrail)) {
      sourceNames.set(result.sourceId, result.sourceName);
      sourceCategories.set(result.sourceId, result.category);
      const statuses = sourceStatuses.get(result.sourceId) ?? new Map<string, 'FOUND' | 'POSSIBLE'>();
      statuses.set(report.query, result.status);
      sourceStatuses.set(result.sourceId, statuses);
      const users = sourceUsers.get(result.sourceId) ?? new Set<string>();
      users.add(report.query);
      sourceUsers.set(result.sourceId, users);

      if (result.status === 'FOUND') {
        const usersWithVerifiedMatch = verifiedSourceUsers.get(result.sourceId) ?? new Set<string>();
        usersWithVerifiedMatch.add(report.query);
        verifiedSourceUsers.set(result.sourceId, usersWithVerifiedMatch);
      }
    }
  }

  const namesFor = (entries: Map<string, Set<string>>, minimum: number) => [...entries.entries()]
    .filter(([, users]) => users.size >= minimum)
    .map(([sourceId]) => sourceNames.get(sourceId) ?? sourceId)
    .sort((a, b) => a.localeCompare(b));

  const shared = namesFor(sourceUsers, 2);
  const sharedDetails: FriendSharedSource[] = [...sourceStatuses.entries()]
    .filter(([, statuses]) => statuses.size >= 2)
    .map(([sourceId, statuses]) => {
      const entries = reports.flatMap((report) => {
        const status = statuses.get(report.query);
        return status ? [{ query: report.query, status }] : [];
      });
      const foundCount = entries.filter((entry) => entry.status === 'FOUND').length;
      return {
        sourceId,
        sourceName: sourceNames.get(sourceId) ?? sourceId,
        category: sourceCategories.get(sourceId) ?? 'other',
        participantCount: entries.length,
        foundCount,
        possibleCount: entries.length - foundCount,
        statuses: entries,
      };
    })
    .sort((a, b) => b.participantCount - a.participantCount || b.foundCount - a.foundCount || a.sourceName.localeCompare(b.sourceName));
  const verifiedShared = namesFor(verifiedSourceUsers, 2);
  const everyoneSites = reports.length >= 2 ? namesFor(sourceUsers, reports.length) : [];
  const verifiedEveryoneSites = reports.length >= 2 ? namesFor(verifiedSourceUsers, reports.length) : [];

  const participants = reports.map((report) => {
    const trails = report.results.filter(isTrail);
    const unique = trails
      .filter((result) => sourceUsers.get(result.sourceId)?.size === 1)
      .map((result) => result.sourceName)
      .sort((a, b) => a.localeCompare(b));
    const categoryCounts = new Map<string, number>();
    for (const result of trails) categoryCounts.set(result.category, (categoryCounts.get(result.category) ?? 0) + 1);

    return {
      query: report.query,
      confirmed: report.summary.FOUND,
      possible: report.summary.POSSIBLE,
      trail: report.summary.FOUND + report.summary.POSSIBLE,
      unique,
      categories: [...categoryCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    };
  });

  function leaders(value: (participant: FriendMetrics['participants'][number]) => number) {
    const max = Math.max(0, ...participants.map(value));
    return participants.filter((participant) => value(participant) === max).map((participant) => participant.query);
  }

  const resultSets = new Map<string, Set<string>>();
  const verifiedSets = new Map<string, Set<string>>();
  for (const report of reports) {
    resultSets.set(report.query, new Set(report.results.filter(isTrail).map((result) => result.sourceId)));
    verifiedSets.set(report.query, new Set(report.results.filter((result) => result.status === 'FOUND').map((result) => result.sourceId)));
  }

  const pairs: FriendPair[] = [];
  for (let left = 0; left < reports.length; left += 1) {
    for (let right = left + 1; right < reports.length; right += 1) {
      const a = reports[left].query;
      const b = reports[right].query;
      const aSet = resultSets.get(a) ?? new Set<string>();
      const bSet = resultSets.get(b) ?? new Set<string>();
      const sharedIds = [...aSet].filter((sourceId) => bSet.has(sourceId));
      const union = new Set([...aSet, ...bSet]).size;
      const aVerified = verifiedSets.get(a) ?? new Set<string>();
      const bVerified = verifiedSets.get(b) ?? new Set<string>();
      const verifiedCount = [...aVerified].filter((sourceId) => bVerified.has(sourceId)).length;
      const categoryCounts = new Map<string, number>();
      for (const sourceId of sharedIds) {
        const category = sourceCategories.get(sourceId) ?? 'other';
        categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      }
      const topCategoryEntry = [...categoryCounts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];
      pairs.push({
        names: [a, b],
        shared: sharedIds.length,
        verifiedShared: verifiedCount,
        union,
        similarity: union === 0 ? 0 : Math.round((sharedIds.length / union) * 100),
        topCategory: topCategoryEntry?.[0] ?? null,
        topCategoryCount: topCategoryEntry?.[1] ?? 0,
      });
    }
  }

  const byNames = (a: FriendPair, b: FriendPair) => a.names.join('|').localeCompare(b.names.join('|'));
  const closestPair = pairs.length
    ? [...pairs].sort((a, b) => b.shared - a.shared || b.verifiedShared - a.verifiedShared || byNames(a, b))[0]
    : null;
  const internetTwins = pairs.length
    ? [...pairs].sort((a, b) => b.similarity - a.similarity || b.verifiedShared - a.verifiedShared || b.shared - a.shared || byNames(a, b))[0]
    : null;
  const mostDifferentPair = pairs.length
    ? [...pairs].sort((a, b) => a.similarity - b.similarity || a.shared - b.shared || byNames(a, b))[0]
    : null;
  const categoryPair = pairs.some((pair) => pair.topCategoryCount > 0)
    ? [...pairs].sort((a, b) => b.topCategoryCount - a.topCategoryCount || b.verifiedShared - a.verifiedShared || b.shared - a.shared || byNames(a, b))[0]
    : null;

  return {
    participants,
    shared,
    sharedDetails,
    verifiedShared,
    everyoneSites,
    verifiedEveryoneSites,
    mostFound: leaders((participant) => participant.confirmed),
    mostUnique: leaders((participant) => participant.unique.length),
    closestPair,
    internetTwins,
    mostDifferentPair,
    categoryPair,
  };
}
