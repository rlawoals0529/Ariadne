import { FormEvent, useEffect, useMemo, useState } from 'react';
import { buildScanAnalytics, CATEGORY_LABELS, type ScanAnalytics } from './analytics';
import { buildFriendMetrics, type FriendMetrics, type FriendPair } from './friendGames';
import {
  clearAccountReviews,
  readAccountReviews,
  updateAccountReview,
  writeAccountReviews,
  type AccountReviewState,
  type ReviewAction,
  type ReviewOwnership,
} from './reviewState';
import { buildShareHash, parseShareHash } from './shareState';
import { buildFriendShareCardSvg } from './shareCard';
import type { ResultStatus, SearchResponse, SourceCategory, SourceResult } from './shared/types';

const FRIEND_LIMIT = 6;
const FRIEND_SCAN_CONCURRENCY = 2;

const statusLabel: Record<SourceResult['status'], string> = {
  FOUND: 'Found',
  POSSIBLE: 'Maybe',
  NOT_FOUND: 'No match',
  UNKNOWN: 'Couldn’t tell',
  BLOCKED: 'Blocked',
  SKIPPED: 'Skipped',
};

type SourceAvailability = { id: string; name: string; state: 'exact' | 'fallback' | 'unavailable'; label: string; detail: string };
type SourceStats = { total: number; standard: number; nsfw: number; direct?: number; heuristic?: number; disabled?: number; credentialExact?: string[]; sourceAvailability?: SourceAvailability[]; provenance?: string };
type SensitivityFilter = 'ALL' | 'SFW' | 'NSFW';
type EvidenceFilter = 'ALL' | 'DIRECT' | 'HEURISTIC';
type Mode = 'solo' | 'party';

const resultPriority: Record<ResultStatus, number> = {
  FOUND: 0,
  POSSIBLE: 1,
  UNKNOWN: 2,
  BLOCKED: 3,
  NOT_FOUND: 4,
  SKIPPED: 5,
};

function emptySummary(): Record<ResultStatus, number> {
  return { FOUND: 0, POSSIBLE: 0, NOT_FOUND: 0, UNKNOWN: 0, BLOCKED: 0, SKIPPED: 0 };
}

function summarize(results: SourceResult[]) {
  const summary = emptySummary();
  for (const result of results) summary[result.status] += 1;
  return summary;
}

function friendlyReason(result: SourceResult) {
  switch (result.status) {
    case 'FOUND': return 'The site returned this exact username.';
    case 'POSSIBLE': return 'This looks like a real profile, but Ariadne could not confirm the username automatically.';
    case 'NOT_FOUND': return 'This site’s exact username check said the profile was not there.';
    case 'UNKNOWN': return 'Ariadne did not get enough information to decide.';
    case 'BLOCKED': return 'The site blocked or limited this check.';
    case 'SKIPPED': return 'This username does not fit this site’s username rules.';
  }
}

function compactUsername(value: string, limit = 14) {
  if (value.length <= limit) return value;
  const suffixLength = 4;
  const prefixLength = Math.max(1, limit - suffixLength - 1);
  return `${value.slice(0, prefixLength)}…${value.slice(-suffixLength)}`;
}

async function copy(text: string) {
  await navigator.clipboard.writeText(text);
}

async function scanUsername(username: string, includeNsfw: boolean, onProgress?: (report: SearchResponse) => void): Promise<SearchResponse> {
  let cursor: number | null = 0;
  let accumulated: SourceResult[] = [];
  let latest: SearchResponse | null = null;

  while (cursor !== null) {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: username, kind: 'username', includeNsfw, cursor }),
    });
    const payload = await response.json() as SearchResponse | { error: string };
    if (!response.ok || 'error' in payload) throw new Error('error' in payload ? payload.error : 'Search failed');

    accumulated = [...accumulated, ...payload.results];
    latest = { ...payload, batchCount: accumulated.length, results: accumulated, summary: summarize(accumulated) };
    onProgress?.(latest);
    cursor = payload.nextCursor;
  }

  if (!latest) throw new Error('Search returned no source batches');
  return latest;
}

export default function App() {
  const [mode, setMode] = useState<Mode>('solo');
  const [query, setQuery] = useState('');
  const [partyQueries, setPartyQueries] = useState(['', '']);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [partyData, setPartyData] = useState<SearchResponse[]>([]);
  const [partyProgress, setPartyProgress] = useState('');
  const [sourceStats, setSourceStats] = useState<SourceStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [includeNsfw, setIncludeNsfw] = useState(false);
  const [filter, setFilter] = useState<'ALL' | SourceResult['status']>('ALL');
  const [sensitivityFilter, setSensitivityFilter] = useState<SensitivityFilter>('ALL');
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [resultSearch, setResultSearch] = useState('');
  const [accountReviews, setAccountReviews] = useState<AccountReviewState>({});
  const [reviewFilter, setReviewFilter] = useState<'ALL' | 'UNREVIEWED' | 'MINE' | 'CLEANUP' | 'DONE'>('ALL');

  useEffect(() => {
    const shared = parseShareHash(window.location.hash);
    if (shared) {
      setMode(shared.mode);
      setIncludeNsfw(shared.includeNsfw);
      if (shared.mode === 'solo') {
        setQuery(shared.usernames[0]);
      } else {
        setPartyQueries(shared.usernames);
      }
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }

    fetch('/api/sources')
      .then((response) => response.ok ? response.json() : null)
      .then((payload: SourceStats | null) => payload && setSourceStats(payload))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!data?.query) {
      setAccountReviews({});
      return;
    }
    setAccountReviews(readAccountReviews(window.localStorage, data.query));
    setReviewFilter('ALL');
  }, [data?.query]);

  const categoryOptions = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, number>();
    for (const result of data.results) counts.set(result.category, (counts.get(result.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [data]);

  const visible = useMemo(
    () => data?.results
      .filter((result) => {
        if (filter !== 'ALL' && result.status !== filter) return false;
        if (categoryFilter !== 'ALL' && result.category !== categoryFilter) return false;
        if (sensitivityFilter === 'SFW' && result.nsfw) return false;
        if (sensitivityFilter === 'NSFW' && !result.nsfw) return false;
        if (evidenceFilter === 'DIRECT' && result.evidenceBasis !== 'direct-api') return false;
        if (evidenceFilter === 'HEURISTIC' && result.evidenceBasis !== 'catalog-rule') return false;
        const needle = resultSearch.trim().toLowerCase();
        if (needle && !result.sourceName.toLowerCase().includes(needle) && !result.category.toLowerCase().includes(needle)) return false;
        return true;
      })
      .sort((a, b) => resultPriority[a.status] - resultPriority[b.status] || a.sourceName.localeCompare(b.sourceName)) ?? [],
    [data, filter, categoryFilter, sensitivityFilter, evidenceFilter, resultSearch],
  );

  const activeFilterCount = [filter !== 'ALL', categoryFilter !== 'ALL', sensitivityFilter !== 'ALL', evidenceFilter !== 'ALL', Boolean(resultSearch.trim())].filter(Boolean).length;
  const advancedFilterCount = [sensitivityFilter !== 'ALL', evidenceFilter !== 'ALL'].filter(Boolean).length;

  function setReviewOwnership(sourceId: string, ownership: ReviewOwnership) {
    if (!data) return;
    setAccountReviews((current) => {
      const next = updateAccountReview(current, sourceId, {
        ownership: current[sourceId]?.ownership === ownership ? null : ownership,
      });
      writeAccountReviews(window.localStorage, data.query, next);
      return next;
    });
  }

  function setReviewAction(sourceId: string, action: ReviewAction) {
    if (!data) return;
    setAccountReviews((current) => {
      const next = updateAccountReview(current, sourceId, {
        action: current[sourceId]?.action === action ? null : action,
      });
      writeAccountReviews(window.localStorage, data.query, next);
      return next;
    });
  }

  function resetSourceReview(sourceId: string) {
    if (!data) return;
    setAccountReviews((current) => {
      const next = updateAccountReview(current, sourceId, { ownership: null, action: null });
      writeAccountReviews(window.localStorage, data.query, next);
      return next;
    });
  }

  function clearReviewBoard() {
    if (!data) return;
    if (!window.confirm(`Clear the local review decisions saved for @${data.query}? This does not affect scan results.`)) return;
    clearAccountReviews(window.localStorage, data.query);
    setAccountReviews({});
    setReviewFilter('ALL');
  }

  function clearResultFilters() {
    setFilter('ALL');
    setCategoryFilter('ALL');
    setSensitivityFilter('ALL');
    setEvidenceFilter('ALL');
    setResultSearch('');
  }

  const scanAnalytics = useMemo(() => data ? buildScanAnalytics(data) : null, [data]);
  const partyMetrics = useMemo(() => buildFriendMetrics(partyData), [partyData]);

  async function submitSolo(event: FormEvent) {
    event.preventDefault();
    setError('');
    setData(null);
    setFilter('ALL');
    setSensitivityFilter('ALL');
    setEvidenceFilter('ALL');
    setCategoryFilter('ALL');
    setResultSearch('');
    setLoading(true);
    try {
      const report = await scanUsername(query.trim(), includeNsfw, setData);
      setData(report);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  async function submitParty(event: FormEvent) {
    event.preventDefault();
    const names = partyQueries.map((value) => value.trim()).filter(Boolean);
    const unique = [...new Set(names.map((value) => value.toLowerCase()))];
    if (names.length < 2) {
      setError('Add at least two usernames to compare.');
      return;
    }
    if (names.length > FRIEND_LIMIT) {
      setError(`Compare up to ${FRIEND_LIMIT} usernames at a time.`);
      return;
    }
    if (unique.length !== names.length) {
      setError('Use a different username for each person.');
      return;
    }

    setError('');
    setPartyData([]);
    setPartyProgress('');
    setLoading(true);

    try {
      const reports: Array<SearchResponse | undefined> = new Array(names.length);
      let completed = 0;

      for (let start = 0; start < names.length; start += FRIEND_SCAN_CONCURRENCY) {
        const group = names.slice(start, start + FRIEND_SCAN_CONCURRENCY);
        await Promise.all(group.map(async (username, offset) => {
          const index = start + offset;
          const report = await scanUsername(username, includeNsfw, (partial) => {
            setPartyProgress(`Checking @${username} · ${partial.results.length}/${partial.sourceCount} sites · ${completed}/${names.length} finished`);
          });
          reports[index] = report;
          completed += 1;
          setPartyData(reports.filter((item): item is SearchResponse => Boolean(item)));
          setPartyProgress(`${completed}/${names.length} people finished`);
        }));
      }

      setPartyProgress('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Friend comparison failed');
    } finally {
      setLoading(false);
    }
  }

  function updatePartyQuery(index: number, value: string) {
    setPartyQueries((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  }

  function addPartyMember() {
    setPartyQueries((current) => current.length >= FRIEND_LIMIT ? current : [...current, '']);
  }

  function removePartyMember(index: number) {
    setPartyQueries((current) => current.length <= 2 ? current : current.filter((_, itemIndex) => itemIndex !== index));
  }

  function exportJson() {
    const payload = mode === 'party'
      ? { mode: 'friend-compare', generatedAt: new Date().toISOString(), reports: partyData, games: partyMetrics }
      : data;
    if (!payload) return;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = mode === 'party' ? 'ariadne-friends.json' : `ariadne-${data?.query ?? 'report'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function rescan() {
    if (!data) return;
    setError('');
    setLoading(true);
    try {
      const report = await scanUsername(data.query, data.includeNsfw, setData);
      setData(report);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Rescan failed');
    } finally {
      setLoading(false);
    }
  }

  function exploreThreadCategory(category: SourceCategory | 'ALL') {
    setCategoryFilter(category);
    setFilter('ALL');
    setSensitivityFilter('ALL');
    setEvidenceFilter('ALL');
    setResultSearch('');
    requestAnimationFrame(() => document.getElementById('evidence-explorer')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function shareSetupLink(targetMode: Mode) {
    const usernames = targetMode === 'solo'
      ? [data?.query ?? query.trim()]
      : (partyData.length ? partyData.map((report) => report.query) : partyQueries.map((value) => value.trim()).filter(Boolean));
    const adult = targetMode === 'solo' ? (data?.includeNsfw ?? includeNsfw) : includeNsfw;
    const hash = buildShareHash(targetMode, usernames, adult);
    if (!hash) return;

    const url = `${window.location.origin}${window.location.pathname}${hash}`;
    const title = targetMode === 'solo' ? `Ariadne setup · @${usernames[0]}` : 'Ariadne · Friend Mode setup';
    const text = targetMode === 'solo'
      ? `Open Ariadne with @${usernames[0]} ready to scan.`
      : `Open Ariadne with ${usernames.length} friend usernames ready to compare.`;

    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
      }
    }
    await copy(url);
  }

  async function shareProfileSummary() {
    if (!data) return;
    const found = data.summary.FOUND;
    const maybe = data.summary.POSSIBLE;
    const unclear = data.summary.UNKNOWN + data.summary.BLOCKED;
    const coverage = Math.round((data.results.length / Math.max(1, data.sourceCount)) * 100);
    const signalCategories = new Set(
      data.results
        .filter((result) => result.status === 'FOUND' || result.status === 'POSSIBLE')
        .map((result) => result.category),
    );
    const summaryText = [
      `ARIADNE · PUBLIC FOOTPRINT`,
      `@${data.query}`,
      `${found + maybe} public profile signals across ${signalCategories.size} categor${signalCategories.size === 1 ? 'y' : 'ies'}`,
      `Found: ${found} · Maybe: ${maybe} · Needs review: ${unclear} · Coverage: ${coverage}%`,
      `${data.results.length} of ${data.sourceCount} sources checked`,
      'A username match is a public signal, not proof of account ownership.',
    ].join('\n');

    if (navigator.share) {
      try {
        await navigator.share({ title: `Ariadne · @${data.query}`, text: summaryText });
        return;
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
      }
    }
    await copy(summaryText);
  }

  async function sharePartyCard() {
    if (!partyMetrics.participants.length) return;
    const svg = buildFriendShareCardSvg(partyMetrics);
    const file = new File([svg], 'ariadne-friends.svg', { type: 'image/svg+xml' });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          title: 'Ariadne · Friend Footprint',
          text: 'A scan-derived friend footprint from Ariadne. Public profile signals only.',
          files: [file],
        });
        return;
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
      }
    }

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ariadne-friends.svg';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function sharePartySummary() {
    const closest = partyMetrics.closestPair;
    const twins = partyMetrics.internetTwins;
    const lines = [
      'ARIADNE · FRIEND FOOTPRINT',
      partyMetrics.participants.map((participant) => `@${participant.query}`).join(' × '),
      `${partyMetrics.shared.length} public sites appeared for more than one username · ${partyMetrics.verifiedShared.length} were Found for at least two`,
      ...partyMetrics.participants.map((participant) => `@${participant.query}: ${participant.confirmed} found · ${participant.possible} maybe · ${participant.unique.length} only theirs`),
      closest ? `Most in common: @${closest.names[0]} + @${closest.names[1]} · ${closest.shared} shared` : 'Most in common: —',
      twins ? `Internet twins: @${twins.names[0]} + @${twins.names[1]} · ${twins.similarity}% overlap in this scan` : 'Internet twins: —',
      'Public profile signals only. Maybe results still need a manual check.',
    ];
    const summaryText = lines.join('\n');

    if (navigator.share) {
      try {
        await navigator.share({ title: 'Ariadne · Friend Footprint', text: summaryText });
        return;
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
      }
    }
    await copy(summaryText);
  }

  const standardCount = sourceStats?.standard;
  const nsfwCount = sourceStats?.nsfw;
  const showPrinciples = mode === 'solo' ? !data && !loading : !partyData.length && !loading;

  return (
    <main>
      <header className="nav">
        <a className="brand" href="/" aria-label="Ariadne home"><span className="mark">A</span><span>ARIADNE</span></a>
        <div className="nav-meta">
          <span className="nav-note">EVIDENCE-FIRST PUBLIC PROFILE SEARCH</span>
          {sourceStats?.direct !== undefined && <span className="nav-count">{sourceStats.direct} exact checks</span>}
        </div>
      </header>

      <section className="hero">
        <div className="hero-intro">
          <div className="eyebrow">PUBLIC USERNAME INTELLIGENCE</div>
          <h1>Trace a username<br /><em>without guessing.</em></h1>
          <p className="lede">Ariadne checks public profile sources, separates exact account evidence from plausible pages, and shows how much of each scan it could actually resolve.</p>
          <div className="hero-stats" aria-label="Ariadne coverage">
            <span><strong>{sourceStats?.standard ?? '—'}</strong> public sites</span>
            <span><strong>{sourceStats?.direct ?? '—'}</strong> exact checks</span>
            <span><strong>0</strong> server-side scans stored</span>
          </div>
        </div>

        <div className="mode-tabs" aria-label="Search mode">
          <button type="button" className={mode === 'solo' ? 'active' : ''} onClick={() => { setMode('solo'); setError(''); }}>Search one</button>
          <button type="button" className={mode === 'party' ? 'active' : ''} onClick={() => { setMode('party'); setError(''); }}>Compare friends</button>
        </div>

        {mode === 'solo' ? (
          <form onSubmit={submitSolo} className="search-form">
            <label htmlFor="username">Username</label>
            <div className="search-row">
              <input id="username" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" spellCheck={false} placeholder="e.g. exampleuser" maxLength={64} />
              <button type="submit" disabled={loading || !query.trim()}>{loading ? 'Checking…' : 'Search'}</button>
            </div>
            <NsfwOption checked={includeNsfw} onChange={setIncludeNsfw} disabled={loading} />
            <SourceMeta standardCount={standardCount} nsfwCount={nsfwCount} directCount={sourceStats?.direct} />
          </form>
        ) : (
          <form onSubmit={submitParty} className="search-form party-form">
            <div className="party-form-head">
              <div><label>Friends</label><small>Compare 2–6 usernames. Ariadne checks up to two people at once, then shows where your public profiles overlap.</small></div>
              <button type="button" className="text-button" onClick={addPartyMember} disabled={partyQueries.length >= FRIEND_LIMIT || loading}>+ Add friend</button>
            </div>
            <div className="party-inputs">
              {partyQueries.map((value, index) => (
                <div className="party-input-row" key={index}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <input value={value} onChange={(event) => updatePartyQuery(index, event.target.value)} autoComplete="off" spellCheck={false} placeholder={index === 0 ? 'your username' : 'friend username'} maxLength={64} aria-label={`Friend username ${index + 1}`} />
                  {partyQueries.length > 2 && <button type="button" className="remove-member" onClick={() => removePartyMember(index)} aria-label={`Remove username ${index + 1}`}>×</button>}
                </div>
              ))}
            </div>
            <button className="party-submit" type="submit" disabled={loading || partyQueries.filter((value) => value.trim()).length < 2}>{loading ? 'Comparing…' : 'Compare friends'}</button>
            <NsfwOption checked={includeNsfw} onChange={setIncludeNsfw} disabled={loading} />
            <SourceMeta standardCount={standardCount} nsfwCount={nsfwCount} directCount={sourceStats?.direct} />
          </form>
        )}
        <SourceAvailabilityPanel stats={sourceStats} data={null} />
        {error && <div className="error" role="alert">{error}</div>}
      </section>

      {showPrinciples && (
        <section className="principles" aria-label="How Ariadne handles results">
          <article><span>01</span><h2>Found means found</h2><p>When a site gives Ariadne the exact username back, the result is marked Found.</p></article>
          <article><span>02</span><h2>Maybe means check it</h2><p>Some sites only show whether a profile page looks real. Those results stay Maybe and include a link for you to check.</p></article>
          <article><span>03</span><h2>No guessing</h2><p>If a site blocks the check, times out, or gives a confusing answer, Ariadne says it couldn’t tell.</p></article>
        </section>
      )}

      {loading && (
        <section className="loading-panel">
          <div className="thread-loader" />
          <div>
            <p>{mode === 'party' ? (partyProgress || 'Getting the friend comparison ready…') : `Checking @${query.trim()} across public sites…`}</p>
            {mode === 'solo' && data && <small>{data.results.length} of {data.sourceCount} sites checked</small>}
          </div>
        </section>
      )}

      {mode === 'solo' && data && (
        <section className="results-section">
          <div className="result-header solo-result-header">
            <div>
              <div className="eyebrow">SCAN REPORT</div>
              <p>@{data.query} · {data.results.length}/{data.sourceCount} sources checked</p>
            </div>
            <div className="result-actions">
              <button className="secondary" onClick={rescan} disabled={loading}>Rescan</button>
              <button className="secondary" onClick={exportJson}>Save JSON</button>
            </div>
          </div>

          {scanAnalytics && (
            <ProfileSummary
              data={data}
              analytics={scanAnalytics}
              complete={data.nextCursor === null && !loading}
              onShare={shareProfileSummary}
              onShareSetup={() => shareSetupLink('solo')}
            />
          )}
          {scanAnalytics && (
            <ThreadMap
              data={data}
              analytics={scanAnalytics}
              onExplore={exploreThreadCategory}
            />
          )}
          <AccountReviewBoard
            data={data}
            reviews={accountReviews}
            filter={reviewFilter}
            onFilter={setReviewFilter}
            onOwnership={setReviewOwnership}
            onAction={setReviewAction}
            onReset={resetSourceReview}
            onClear={clearReviewBoard}
          />
          <div className="scan-support-stack" aria-label="Supporting scan details">
            {scanAnalytics && <ScanInsights analytics={scanAnalytics} complete={data.nextCursor === null && !loading} />}
            <SourceAvailabilityPanel stats={sourceStats} data={data} />
          </div>

          <div className="filter-deck" id="evidence-explorer">
            <div className="filter-deck-head">
              <div><span>Evidence Explorer</span><small>{visible.length} of {data.results.length} sources shown</small></div>
              {activeFilterCount > 0 && <button className="clear-filters" onClick={clearResultFilters}>Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}</button>}
            </div>

            <div className="investigation-toolbar">
              <div className="result-search">
                <span aria-hidden="true">⌕</span>
                <input value={resultSearch} onChange={(event) => setResultSearch(event.target.value)} placeholder="Search platform or category" aria-label="Filter results by platform or category" />
                {resultSearch && <button type="button" onClick={() => setResultSearch('')} aria-label="Clear result search">×</button>}
              </div>

              <div className="filter-menus">
                <details className="filter-menu category-menu">
                  <summary>
                    <span>Category</span>
                    <strong>{categoryFilter === 'ALL' ? 'All' : categoryFilter}</strong>
                  </summary>
                  <div className="filter-menu-body">
                    <div className="filters category-filters" aria-label="Filter results by category">
                      <button className={categoryFilter === 'ALL' ? 'active' : ''} onClick={(event) => { setCategoryFilter('ALL'); event.currentTarget.closest('details')?.removeAttribute('open'); }}>All <small>{data.results.length}</small></button>
                      {categoryOptions.map(([category, count]) => (
                        <button key={category} className={categoryFilter === category ? 'active' : ''} onClick={(event) => { setCategoryFilter(category); event.currentTarget.closest('details')?.removeAttribute('open'); }}>
                          {category} <small>{count}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                </details>

                <details className="filter-menu filter-advanced">
                  <summary>
                    <span>More filters</span>
                    <strong>{advancedFilterCount > 0 ? `${advancedFilterCount} active` : 'Evidence'}</strong>
                  </summary>
                  <div className="filter-menu-body filter-advanced-body">
                    <div className="filter-group">
                      <span className="filter-label">Evidence</span>
                      <div className="filters evidence-filters" aria-label="Filter by how the site was checked">
                        {(['ALL', 'DIRECT', 'HEURISTIC'] as const).map((item) => (
                          <button key={item} className={evidenceFilter === item ? 'active' : ''} onClick={() => setEvidenceFilter(item)}>
                            {item === 'ALL' ? 'All checks' : item === 'DIRECT' ? 'Verified by site' : 'Needs a look'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {data.includeNsfw && (
                      <div className="filter-group">
                        <span className="filter-label">Sensitivity</span>
                        <div className="filters sensitivity-filters" aria-label="Filter adult sources">
                          {(['ALL', 'SFW', 'NSFW'] as const).map((item) => (
                            <button key={item} className={sensitivityFilter === item ? 'active' : ''} onClick={() => setSensitivityFilter(item)}>{item === 'ALL' ? 'All sites' : item === 'SFW' ? 'Regular sites' : 'Adult sites'}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              </div>
            </div>

            <div className="filter-group status-filter-group">
              <span className="filter-label">Status</span>
              <div className="filters status-filters" aria-label="Filter results by status">
                {(['ALL', 'FOUND', 'POSSIBLE', 'NOT_FOUND', 'UNKNOWN', 'BLOCKED', 'SKIPPED'] as const).map((item) => (
                  <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>
                    {item === 'ALL' ? 'All' : statusLabel[item]} <small>{item === 'ALL' ? data.results.length : data.summary[item]}</small>
                  </button>
                ))}
              </div>
            </div>
          </div>
          {visible.length > 0 ? (
            <div className="results-list">{visible.map((result) => <ResultCard key={result.sourceId} result={result} />)}</div>
          ) : (
            <div className="results-empty">
              <strong>No sources match these filters.</strong>
              <span>Try clearing a filter or searching for another platform or category.</span>
              <button className="secondary" onClick={clearResultFilters}>Clear filters</button>
            </div>
          )}
        </section>
      )}

      {mode === 'party' && partyData.length > 0 && <PartyReport reports={partyData} metrics={partyMetrics} loading={loading} onExport={exportJson} onShare={sharePartySummary} onShareCard={sharePartyCard} onShareSetup={() => shareSetupLink('party')} />}

      <footer><span>ARIADNE v1.0</span><span>Public profiles only · Adult sites off by default · Friend comparisons are not saved</span></footer>
    </main>
  );
}

function SourceMeta({ standardCount, nsfwCount, directCount }: { standardCount?: number; nsfwCount?: number; directCount?: number }) {
  return (
    <div className="form-meta">
      <span>{standardCount ? `${standardCount} public sites` : 'Wide public-site search'}</span>
      <span>{nsfwCount ? `${nsfwCount} optional adult sites` : 'Adult sites are optional'}</span>
      {directCount !== undefined && <span>{directCount} sites can verify the exact username</span>}
      <span>Scans not stored</span>
    </div>
  );
}

function NsfwOption({ checked, onChange, disabled }: { checked: boolean; onChange: (value: boolean) => void; disabled: boolean }) {
  return (
    <label className="nsfw-option">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      <span className="switch" aria-hidden="true" />
      <span className="nsfw-copy"><strong>Include adult / NSFW sites</strong><small>Off by default. Ariadne only checks public profile pages.</small></span>
    </label>
  );
}

function SourceAvailabilityPanel({ stats, data }: { stats: SourceStats | null; data: SearchResponse | null }) {
  const providers = stats?.sourceAvailability ?? [];
  const scanIssues = data?.results.filter((result) => result.status === 'UNKNOWN' || result.status === 'BLOCKED' || result.status === 'SKIPPED') ?? [];
  const scanAnswered = data ? data.results.filter((result) => result.status === 'FOUND' || result.status === 'NOT_FOUND' || result.status === 'POSSIBLE').length : 0;
  const exactReady = providers.filter((item) => item.state === 'exact').length;

  return (
    <details className="source-availability">
      <summary>
        <span>
          <span className="eyebrow">{data ? 'HOW ARIADNE CHECKED' : 'SOURCE COVERAGE'}</span>
          <strong>{data ? `${scanAnswered}/${data.results.length} checks returned a usable response` : `${exactReady} exact provider checks ready`}</strong>
        </span>
        <span className="availability-summary">{data ? `${scanIssues.length} need attention` : `${stats?.standard ?? '—'} public sites`}</span>
      </summary>

      <div className="availability-body">
        <div className="availability-intro">
          <p>{data ? 'Ariadne keeps source problems separate from “No match.” A blocked or unclear site never counts as proof that an account is absent.' : 'Ariadne uses exact lookups where providers make them available and broad public-page checks everywhere else.'}</p>
          {stats && <span>{stats.direct ?? '—'} exact checks · {stats.heuristic ?? '—'} broad checks · {stats.nsfw ?? '—'} optional adult checks</span>}
        </div>

        {providers.length > 0 && (
          <div className="availability-providers">
            {providers.map((provider) => (
              <div className="availability-provider" key={provider.id}>
                <div className="availability-provider-title"><strong>{provider.name}</strong><span className={'availability-badge ' + provider.state}>{provider.label}</span></div>
                <p>{provider.detail}</p>
              </div>
            ))}
          </div>
        )}

        {data && scanIssues.length > 0 && (
          <div className="availability-issues">
            <div className="availability-section-title"><span>Needs attention in this scan</span><small>{scanIssues.length} source{scanIssues.length === 1 ? '' : 's'}</small></div>
            {scanIssues.slice(0, 12).map((result) => (
              <div className="availability-issue" key={result.sourceId}>
                <strong>{result.sourceName}</strong>
                <span className={'issue-status ' + result.status.toLowerCase()}>{statusLabel[result.status]}</span>
                <small>{result.status === 'BLOCKED' ? 'The site limited the check.' : result.status === 'SKIPPED' ? 'The username format did not fit this site.' : 'The response was not strong enough to decide.'}</small>
              </div>
            ))}
            {scanIssues.length > 12 && <p className="availability-more">+ {scanIssues.length - 12} more source issues are listed in the results below.</p>}
          </div>
        )}

        {data && scanIssues.length === 0 && (
          <div className="availability-clear"><strong>No source availability issues in this scan.</strong><span>Every checked source returned a usable result.</span></div>
        )}
      </div>
    </details>
  );
}
function ProfileSummary({
  data,
  analytics,
  complete,
  onShare,
  onShareSetup,
}: {
  data: SearchResponse;
  analytics: ScanAnalytics;
  complete: boolean;
  onShare: () => void;
  onShareSetup: () => void;
}) {
  const found = data.results.filter((result) => result.status === 'FOUND');
  const possible = data.results.filter((result) => result.status === 'POSSIBLE');
  const unclear = data.summary.UNKNOWN + data.summary.BLOCKED;
  const coverage = Math.round((data.results.length / Math.max(1, data.sourceCount)) * 100);
  const categorySignals = analytics.categories.filter((item) => item.found + item.possible > 0).slice(0, 6);
  const categoryMax = Math.max(1, ...categorySignals.map((item) => item.found + item.possible));
  const signalCount = found.length + possible.length;
  const signalCategoryCount = analytics.categories.filter((item) => item.found + item.possible > 0).length;
  const topSignalCategories = categorySignals.slice(0, 3);
  const mixTotal = Math.max(1, data.results.length);
  const mix = [
    { key: 'found', label: 'Found', value: data.summary.FOUND },
    { key: 'possible', label: 'Maybe', value: data.summary.POSSIBLE },
    { key: 'unclear', label: 'Needs review', value: unclear },
    { key: 'not-found', label: 'No match', value: data.summary.NOT_FOUND },
    { key: 'skipped', label: 'Skipped', value: data.summary.SKIPPED },
  ];

  return (
    <section className="profile-summary" aria-label="Public footprint summary">
      <div className="profile-summary-top">
        <div className="profile-identity">
          <div className="profile-monogram" aria-hidden="true">{data.query.slice(0, 1).toUpperCase()}</div>
          <div>
            <div className="eyebrow">PUBLIC FOOTPRINT REPORT</div>
            <h3>@{data.query}</h3>
            <p>Scanned {new Date(data.checkedAt).toLocaleString()} · {data.sourceCount} configured sources</p>
          </div>
        </div>
        <div className="profile-summary-actions">
          <span className={complete ? 'scan-state complete' : 'scan-state'}>{complete ? 'Scan complete' : 'Updating'}</span>
          <button className="secondary" type="button" onClick={onShare}>Share snapshot</button>
          <button className="secondary" type="button" onClick={onShareSetup} title="Shares a link that only prefills this username">Share setup</button>
        </div>
      </div>

      <div className="profile-story" aria-label="Public footprint at a glance">
        <div className="profile-story-main">
          <div className="eyebrow">AT A GLANCE</div>
          <p className="profile-story-copy">
            {signalCount > 0 ? (
              <>This username surfaced <strong>{signalCount} public profile signal{signalCount === 1 ? '' : 's'}</strong> across <strong>{signalCategoryCount} categor{signalCategoryCount === 1 ? 'y' : 'ies'}</strong>{complete ? ' in this scan.' : ' so far.'}</>
            ) : (
              <>No Found or Maybe profile signals have surfaced{complete ? ' in this scan.' : ' so far.'}</>
            )}
          </p>
          <p className="profile-story-note">
            {unclear > 0
              ? `${unclear} check${unclear === 1 ? '' : 's'} remain blocked or unclear. Ariadne keeps those separate from No match.`
              : 'Blocked and unclear checks stay separate from No match, so absence is never inferred from a failed check.'}
          </p>
        </div>
        <div className="profile-story-context">
          <span>Signal areas</span>
          {topSignalCategories.length > 0 ? (
            <div className="profile-story-tags">
              {topSignalCategories.map((item) => (
                <span key={item.category}><strong>{item.label}</strong><small>{item.found + item.possible} signal{item.found + item.possible === 1 ? '' : 's'}</small></span>
              ))}
            </div>
          ) : (
            <small>No positive signal categories yet.</small>
          )}
        </div>
      </div>

      <div className="profile-metrics" aria-label="Scan summary">
        <div className="profile-metric found"><span>Found</span><strong>{data.summary.FOUND}</strong><small>public profile signals</small></div>
        <div className="profile-metric possible"><span>Maybe</span><strong>{data.summary.POSSIBLE}</strong><small>profiles to review</small></div>
        <div className="profile-metric review"><span>Needs review</span><strong>{unclear}</strong><small>blocked or unclear checks</small></div>
        <div className="profile-metric coverage"><span>Coverage</span><strong>{coverage}%</strong><small>{data.results.length}/{data.sourceCount} returned</small></div>
      </div>

      <div className="profile-mix">
        <div className="profile-section-head">
          <div><div className="eyebrow">SCAN MIX</div><h4>What came back</h4></div>
          <span>{data.results.length} results</span>
        </div>
        <div className="mix-track" role="img" aria-label={mix.map((item) => `${item.label}: ${item.value}`).join(', ')}>
          {mix.filter((item) => item.value > 0).map((item) => (
            <span key={item.key} className={`mix-${item.key}`} style={{ width: `${(item.value / mixTotal) * 100}%` }} />
          ))}
        </div>
        <div className="mix-legend">
          {mix.map((item) => <span key={item.key}><i className={`legend-dot mix-${item.key}`} />{item.label} <strong>{item.value}</strong></span>)}
        </div>
      </div>

      <div className="profile-summary-grid">
        <div className="profile-categories">
          <div className="profile-section-head">
            <div><div className="eyebrow">WHERE THE SIGNALS ARE</div><h4>Categories</h4></div>
            <span>{categorySignals.length ? `${categorySignals.length} with matches` : 'No positive signals'}</span>
          </div>
          {categorySignals.length ? (
            <div className="category-bars">
              {categorySignals.map((item) => {
                const total = item.found + item.possible;
                return (
                  <div className="category-bar-row" key={item.category}>
                    <div className="category-bar-label"><strong>{item.label}</strong><span>{item.found} found · {item.possible} maybe</span></div>
                    <div className="category-bar-track" aria-hidden="true"><span style={{ width: `${(total / categoryMax) * 100}%` }} /><i style={{ width: `${(item.found / categoryMax) * 100}%` }} /></div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="profile-empty">No Found or Maybe signals were returned in the categories checked.</p>
          )}
        </div>

        <div className="profile-hits">
          <div className="profile-section-head">
            <div><div className="eyebrow">QUICK REVIEW</div><h4>Profiles worth opening</h4></div>
            <a href="#evidence-explorer">See all</a>
          </div>

          <div className="profile-hit-list">
            {found.slice(0, 4).map((result) => (
              <a className="profile-hit" key={result.sourceId} href={result.profileUrl} target="_blank" rel="noreferrer">
                <span className="source-glyph">{result.sourceName.slice(0, 1)}</span>
                <span><strong>{result.sourceName}{result.nsfw && <span className="nsfw-badge">18+</span>}</strong><small>{CATEGORY_LABELS[result.category]} · Found</small></span>
                <span aria-hidden="true">↗</span>
              </a>
            ))}
            {possible.slice(0, Math.max(0, 4 - Math.min(found.length, 4))).map((result) => (
              <a className="profile-hit possible-hit" key={result.sourceId} href={result.profileUrl} target="_blank" rel="noreferrer">
                <span className="source-glyph">{result.sourceName.slice(0, 1)}</span>
                <span><strong>{result.sourceName}{result.nsfw && <span className="nsfw-badge">18+</span>}</strong><small>{CATEGORY_LABELS[result.category]} · Maybe</small></span>
                <span aria-hidden="true">↗</span>
              </a>
            ))}
            {!found.length && !possible.length && <p className="profile-empty">No positive profile signals in this scan.</p>}
          </div>
        </div>
      </div>

      <div className="profile-summary-foot">
        <p>Ariadne reports public profile signals only. A matching username does not prove that the same person owns every account. Setup links only prefill the form and never start a scan automatically.</p>
        <a href="#evidence-explorer">Explore all {data.results.length} results <span aria-hidden="true">↓</span></a>
      </div>
    </section>
  );
}
function AccountReviewBoard({
  data,
  reviews,
  filter,
  onFilter,
  onOwnership,
  onAction,
  onReset,
  onClear,
}: {
  data: SearchResponse;
  reviews: AccountReviewState;
  filter: 'ALL' | 'UNREVIEWED' | 'MINE' | 'CLEANUP' | 'DONE';
  onFilter: (filter: 'ALL' | 'UNREVIEWED' | 'MINE' | 'CLEANUP' | 'DONE') => void;
  onOwnership: (sourceId: string, ownership: ReviewOwnership) => void;
  onAction: (sourceId: string, action: ReviewAction) => void;
  onReset: (sourceId: string) => void;
  onClear: () => void;
}) {
  const candidates = data.results
    .filter((result) => result.status === 'FOUND' || result.status === 'POSSIBLE')
    .sort((a, b) => resultPriority[a.status] - resultPriority[b.status] || a.sourceName.localeCompare(b.sourceName));

  if (!candidates.length) return null;

  const reviewed = candidates.filter((result) => Boolean(reviews[result.sourceId]?.ownership)).length;
  const mine = candidates.filter((result) => reviews[result.sourceId]?.ownership === 'mine').length;
  const cleanup = candidates.filter((result) => reviews[result.sourceId]?.action === 'cleanup').length;
  const done = candidates.filter((result) => reviews[result.sourceId]?.action === 'done').length;
  const unreviewed = candidates.length - reviewed;
  const progress = Math.round((reviewed / Math.max(1, candidates.length)) * 100);

  const visible = candidates.filter((result) => {
    const review = reviews[result.sourceId];
    if (filter === 'UNREVIEWED') return !review?.ownership;
    if (filter === 'MINE') return review?.ownership === 'mine';
    if (filter === 'CLEANUP') return review?.action === 'cleanup';
    if (filter === 'DONE') return review?.action === 'done';
    return true;
  });

  const filters = [
    ['ALL', 'All', candidates.length],
    ['UNREVIEWED', 'Unreviewed', unreviewed],
    ['MINE', 'Mine', mine],
    ['CLEANUP', 'Clean up', cleanup],
    ['DONE', 'Done', done],
  ] as const;

  return (
    <section className="account-review" aria-label="Account review and cleanup">
      <div className="account-review-head">
        <div>
          <div className="eyebrow">ACCOUNT REVIEW</div>
          <h3>Decide what is actually yours</h3>
          <p>Ariadne found the public signals. You decide whether an account is yours and what you want to do with it. Cleanup actions unlock after you mark an account Mine.</p>
        </div>
        <div className="review-local-note">
          <strong>Saved only in this browser</strong>
          <span>Your decisions stay on this device and are never sent with a scan.</span>
        </div>
      </div>

      <div className="review-progress" aria-label={`${reviewed} of ${candidates.length} account signals reviewed`}>
        <div>
          <span>Review progress</span>
          <strong>{reviewed}/{candidates.length}</strong>
        </div>
        <div className="review-progress-track" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
        <div className="review-progress-stats">
          <span><strong>{mine}</strong> mine</span>
          <span><strong>{cleanup}</strong> to clean up</span>
          <span><strong>{done}</strong> done</span>
        </div>
      </div>

      <div className="review-toolbar">
        <div className="review-filters" aria-label="Filter account review">
          {filters.map(([key, label, count]) => (
            <button type="button" key={key} className={filter === key ? 'active' : ''} onClick={() => onFilter(key)}>
              {label} <small>{count}</small>
            </button>
          ))}
        </div>
        {reviewed > 0 && <button type="button" className="review-clear" onClick={onClear}>Clear local review</button>}
      </div>

      {visible.length ? (
        <div className="review-list">
          {visible.map((result) => {
            const review = reviews[result.sourceId];
            const isMine = review?.ownership === 'mine';
            return (
              <article className="review-row" key={result.sourceId}>
                <div className="review-source">
                  <span className="source-glyph">{result.sourceName.slice(0, 1)}</span>
                  <div className="review-source-main">
                    <div className="review-source-title">
                      <strong>{result.sourceName}{result.nsfw && <span className="nsfw-badge">18+</span>}</strong>
                      <small>{CATEGORY_LABELS[result.category]} · {statusLabel[result.status]}</small>
                    </div>
                    <div className="review-source-links">
                      <a href={result.profileUrl} target="_blank" rel="noreferrer">Open profile <span aria-hidden="true">↗</span></a>
                      {review?.ownership && <button type="button" onClick={() => onReset(result.sourceId)}>Reset</button>}
                    </div>
                    <span className="review-source-note">{result.status === 'FOUND' ? 'Exact username returned by the site.' : 'Still needs a manual check.'}</span>
                  </div>
                </div>

                <div className="review-choice" role="group" aria-label={`Is ${result.sourceName} yours?`}>
                  <span className="review-choice-label">Is this yours?</span>
                  <div>
                    {([
                      ['mine', 'Mine'],
                      ['not-mine', 'Not mine'],
                      ['unsure', 'Unsure'],
                    ] as const).map(([value, label]) => (
                      <button
                        type="button"
                        key={value}
                        className={review?.ownership === value ? 'active' : ''}
                        aria-pressed={review?.ownership === value}
                        onClick={() => onOwnership(result.sourceId, value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={`review-choice review-action ${isMine ? '' : 'disabled'}`} role="group" aria-label={`What to do with ${result.sourceName}`}>
                  <span className="review-choice-label">What next?</span>
                  <div>
                    {([
                      ['keep', 'Keep'],
                      ['cleanup', 'Clean up'],
                      ['done', 'Done'],
                    ] as const).map(([value, label]) => (
                      <button
                        type="button"
                        key={value}
                        className={review?.action === value ? 'active' : ''}
                        aria-pressed={review?.action === value}
                        disabled={!isMine}
                        title={isMine ? undefined : 'Mark this account Mine first'}
                        onClick={() => onAction(result.sourceId, value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="review-empty">
          <strong>Nothing in this view.</strong>
          <span>Try another review filter.</span>
          <button type="button" className="secondary" onClick={() => onFilter('ALL')}>Show all</button>
        </div>
      )}

      <p className="review-footnote">These labels are your own notes about this scan. Ariadne does not infer account ownership from a matching username.</p>
    </section>
  );
}

function ThreadMap({
  data,
  analytics,
  onExplore,
}: {
  data: SearchResponse;
  analytics: ScanAnalytics;
  onExplore: (category: SourceCategory | 'ALL') => void;
}) {
  const categories = analytics.categories
    .filter((item) => item.found + item.possible > 0)
    .slice(0, 6);
  const totalSignals = data.summary.FOUND + data.summary.POSSIBLE;

  return (
    <section className="thread-map" aria-label="Thread Map">
      <div className="thread-map-head">
        <div><div className="eyebrow">THREAD MAP</div><h3>Follow the strongest signal areas</h3></div>
        <p>Each node is built only from this scan’s Found and Maybe results. Open a category to jump straight into its evidence.</p>
      </div>
      <div className="thread-map-canvas">
        <button type="button" className="thread-map-center" onClick={() => onExplore('ALL')}>
          <span>All evidence</span>
          <strong>@{data.query}</strong>
          <small>{totalSignals} public profile signal{totalSignals === 1 ? '' : 's'}</small>
        </button>
        {categories.length ? categories.map((item) => {
          const total = item.found + item.possible;
          const foundShare = total ? (item.found / total) * 100 : 0;
          return (
            <button type="button" className="thread-node" key={item.category} onClick={() => onExplore(item.category)}>
              <span><strong>{item.label}</strong><b>{total}</b></span>
              <small>{item.found} found · {item.possible} maybe</small>
              <span className="thread-node-track" aria-hidden="true">
                <i style={{ width: `${foundShare}%` }} />
                <em style={{ width: `${100 - foundShare}%` }} />
              </span>
            </button>
          );
        }) : (
          <p className="thread-map-empty">No Found or Maybe signal areas surfaced in this scan. Open all evidence to review blocked, unclear, and No match results.</p>
        )}
      </div>
      <div className="thread-map-foot">
        <span><strong>Tip:</strong> choose a node to filter Evidence Explorer.</span>
        <span>Shared setup links keep usernames in the URL fragment, not the server request.</span>
      </div>
    </section>
  );
}

function ScanInsights({ analytics, complete }: { analytics: ScanAnalytics; complete: boolean }) {
  const funnelMax = Math.max(1, analytics.funnel[0]?.value ?? 1);
  const signalCategories = analytics.categories.filter((item) => item.found + item.possible > 0);
  const categoryMax = Math.max(1, ...signalCategories.map((item) => item.found + item.possible));

  return (
    <details className="scan-insights">
      <summary className="insights-summary">
        <span className="insights-summary-title">
          <span className="eyebrow">SCAN DETAILS</span>
          <strong>How this scan performed</strong>
        </span>
        <span className="insights-summary-metrics" aria-label="Scan detail summary">
          <span><strong>{analytics.coveragePercent}%</strong> coverage</span>
          <span><strong>{analytics.exactResolutionPercent}%</strong> exact resolution</span>
          <span><strong>{analytics.uncertaintyPercent}%</strong> uncertainty</span>
        </span>
        <span className={complete ? 'scan-state complete' : 'scan-state'}>{complete ? 'Complete' : 'Updating'}</span>
      </summary>

      <div className="insights-body">
        <p className="insights-intro">These numbers describe source coverage and evidence quality from this scan. They do not estimate whether matching usernames belong to the same person.</p>

        <div className="metric-grid">
          <article><span>Coverage</span><strong>{analytics.coveragePercent}%</strong><small>{analytics.returned}/{analytics.sourceCount} sources returned</small></article>
          <article><span>Exact resolution</span><strong>{analytics.exactResolutionPercent}%</strong><small>{analytics.exactDecisions}/{analytics.exactAttempted} exact checks reached a decision</small></article>
          <article><span>Verified share</span><strong>{analytics.verifiedSharePercent}%</strong><small>{analytics.verifiedMatches} verified of {analytics.verifiedMatches + analytics.possibleMatches} positive signals</small></article>
          <article><span>Uncertainty</span><strong>{analytics.uncertaintyPercent}%</strong><small>Blocked + unclear among attempted checks</small></article>
          <article><span>P90 response</span><strong>{analytics.p90LatencyMs} ms</strong><small>Median {analytics.medianLatencyMs} ms across attempted sources</small></article>
        </div>

        <div className="analytics-grid">
          <article className="analytics-card funnel-card">
            <div className="analytics-card-head">
              <div><span>Evidence funnel</span><strong>From checks to verified matches</strong></div>
            </div>
            <div className="funnel-chart">
              {analytics.funnel.map((item) => (
                <div className="funnel-row" key={item.label}>
                  <div className="funnel-label"><span>{item.label}</span><strong>{item.value}</strong></div>
                  <div className="bar-track" aria-hidden="true"><span style={{ width: `${Math.max(item.value > 0 ? 4 : 0, (item.value / funnelMax) * 100)}%` }} /></div>
                  <small>{item.note}</small>
                </div>
              ))}
            </div>
          </article>

          <article className="analytics-card category-card">
            <div className="analytics-card-head">
              <div><span>Signal categories</span><strong>Where Found and Maybe appeared</strong></div>
              <div className="chart-legend" aria-label="Chart legend"><span><i className="legend-found" />Found</span><span><i className="legend-maybe" />Maybe</span></div>
            </div>
            {signalCategories.length ? (
              <div className="category-chart">
                {signalCategories.map((item) => (
                  <div className="category-row" key={item.category}>
                    <div className="category-label"><span>{item.label}</span><small>{item.found} found · {item.possible} maybe</small></div>
                    <div className="stack-track" aria-hidden="true">
                      <span className="stack-found" style={{ width: `${(item.found / categoryMax) * 100}%` }} />
                      <span className="stack-maybe" style={{ width: `${(item.possible / categoryMax) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="empty-chart">No Found or Maybe signals yet.</p>}
          </article>
        </div>

        <details className="metric-notes">
          <summary>How these metrics are calculated</summary>
          <p><strong>Exact resolution</strong> is the share of exact checks that returned either Found or No match. <strong>Verified share</strong> compares Found with the combined Found + Maybe signals. <strong>Uncertainty</strong> is Blocked + Couldn’t tell among attempted checks. Response times are observed during this scan only.</p>
        </details>
      </div>
    </details>
  );
}

function PartyReport({ reports, metrics, loading, onExport, onShare, onShareCard, onShareSetup }: { reports: SearchResponse[]; metrics: FriendMetrics; loading: boolean; onExport: () => void; onShare: () => void; onShareCard: () => void; onShareSetup: () => void }) {
  const everyoneLabel = metrics.everyoneSites.length ? `${metrics.everyoneSites.length} ${metrics.everyoneSites.length === 1 ? 'site' : 'sites'}` : 'None yet';
  const everyoneNote = metrics.everyoneSites.length
    ? `${metrics.verifiedEveryoneSites.length} verified for everyone${metrics.everyoneSites.length <= 3 ? ` · ${metrics.everyoneSites.join(', ')}` : ''}`
    : 'No site appeared for every completed friend in this scan';
  const participantLine = metrics.participants.map((participant) => `@${participant.query}`).join(' × ');
  const foundTotal = metrics.participants.reduce((sum, participant) => sum + participant.confirmed, 0);
  const maybeTotal = metrics.participants.reduce((sum, participant) => sum + participant.possible, 0);
  const uniqueTotal = metrics.participants.reduce((sum, participant) => sum + participant.unique.length, 0);
  const overlapRows = metrics.sharedDetails.slice(0, 14);
  const overlapColumns = `minmax(170px, 1.6fr) repeat(${Math.max(1, metrics.participants.length)}, minmax(72px, .7fr))`;
  const overlapMinWidth = 190 + metrics.participants.length * 86;

  return (
    <section className="results-section party-report">
      <div className="party-toolbar">
        <div>
          <div className="eyebrow">FRIEND REPORT</div>
          <p>{reports.length} completed ${reports.length === 1 ? 'scan' : 'scans'}{loading ? ' · still checking' : ''}</p>
        </div>
        <div className="party-actions"><button className="secondary" onClick={onShareCard}>Share card</button><button className="secondary" onClick={onShare}>Share text</button><button className="secondary" onClick={onShareSetup} title="Shares a link that only prefills these usernames">Share setup</button><button className="secondary" onClick={onExport}>Save JSON</button></div>
      </div>

      <section className="friend-report-hero" aria-label="Friend footprint summary">
        <div className="friend-report-main">
          <div className="eyebrow">FRIEND FOOTPRINT</div>
          <h2>{participantLine}</h2>
          <p className="friend-report-story">
            Across {reports.length} completed username{reports.length === 1 ? '' : 's'}, <strong>{metrics.shared.length} public site{metrics.shared.length === 1 ? '' : 's'}</strong> appeared for more than one person. <strong>{metrics.verifiedShared.length}</strong> of those were Found for at least two.
          </p>
          <p className="friend-report-note">This compares public profile signals from this scan. Shared usernames do not prove the accounts belong to the same people.</p>
        </div>
        <div className="friend-report-stats">
          <div><span>People</span><strong>{reports.length}</strong><small>completed scans</small></div>
          <div><span>Shared</span><strong>{metrics.shared.length}</strong><small>Found or Maybe for 2+</small></div>
          <div><span>Everyone</span><strong>{metrics.everyoneSites.length}</strong><small>appeared for all completed</small></div>
        </div>
      </section>

      <section className="friend-share-preview-section" aria-label="Shareable friend footprint card">
        <div className="party-section-head">
          <div><div className="eyebrow">SHARE CARD</div><h3>A snapshot from this scan</h3></div>
          <span>Uses only current Found and Maybe evidence</span>
        </div>
        <article className="friend-share-preview">
          <div className="friend-share-brand"><span className="source-glyph">A</span><div><strong>ARIADNE</strong><small>FRIEND FOOTPRINT</small></div></div>
          <h4>{participantLine}</h4>
          <p><strong>{metrics.shared.length}</strong> public site{metrics.shared.length === 1 ? '' : 's'} appeared for more than one username. <strong>{metrics.verifiedShared.length}</strong> were Found for at least two.</p>
          <dl>
            <div><dt>People</dt><dd>{reports.length}</dd></div>
            <div><dt>Shared</dt><dd>{metrics.shared.length}</dd></div>
            <div><dt>Everyone</dt><dd>{metrics.everyoneSites.length}</dd></div>
            <div><dt>Found</dt><dd>{foundTotal}</dd></div>
            <div><dt>Maybe</dt><dd>{maybeTotal}</dd></div>
          </dl>
          {metrics.shared.length > 0 && (
            <div className="friend-share-sites">
              {metrics.shared.slice(0, 6).map((source) => <span key={source}>{source}</span>)}
              {metrics.shared.length > 6 && <span>+{metrics.shared.length - 6} more</span>}
            </div>
          )}
          <small>Matching usernames are public signals, not proof that accounts belong to the same person.</small>
        </article>
      </section>

      <section className="friend-takes" aria-label="Friend comparison quick takes">
        <div className="party-section-head">
          <div><div className="eyebrow">QUICK TAKES</div><h3>What stood out</h3></div>
          <span>{foundTotal} Found · {maybeTotal} Maybe · {uniqueTotal} one-person signals</span>
        </div>
        <div className="friend-games">
          <PairGame title="Most in common" pair={metrics.closestPair} note={(pair) => `${pair.shared} shared sites · ${pair.verifiedShared} Found for both`} />
          <PairGame title="Internet twins" pair={metrics.internetTwins} note={(pair) => `${pair.similarity}% of their Found/Maybe sites overlap in this scan`} />
          <PairGame title="Most different" pair={metrics.mostDifferentPair} note={(pair) => `${pair.similarity}% overlap · ${pair.shared} shared sites`} />
          <PairGame title="Same corner" pair={metrics.categoryPair} note={(pair) => pair.topCategory ? `${pair.topCategoryCount} shared ${pair.topCategory} ${pair.topCategoryCount === 1 ? 'site' : 'sites'}` : 'No shared category yet'} />
          <FriendGame title="Most one-of-a-kind" value={metrics.mostUnique.map((name) => `@${name}`).join(' · ') || '—'} note="Most Found/Maybe sites that did not appear for another friend" />
          <FriendGame title="Everyone’s here" value={everyoneLabel} note={everyoneNote} />
        </div>
      </section>

      <section className="party-people">
        <div className="party-section-head">
          <div><div className="eyebrow">SIDE BY SIDE</div><h3>Each public footprint</h3></div>
          <span>Found stays separate from Maybe</span>
        </div>
        <div className="party-scoreboard">
          {metrics.participants.map((participant) => (
            <article key={participant.query} className="party-person">
              <div className="party-person-head">
                <span className="source-glyph">{participant.query.slice(0, 1).toUpperCase()}</span>
                <div><strong>@{participant.query}</strong><small>{participant.trail} Found or Maybe signals</small></div>
              </div>
              <dl><div><dt>Found</dt><dd>{participant.confirmed}</dd></div><div><dt>Maybe</dt><dd>{participant.possible}</dd></div><div><dt>Only theirs</dt><dd>{participant.unique.length}</dd></div></dl>
              <div className="category-stack">{participant.categories.slice(0, 5).map(([category, count]) => <span key={category}>{category} {count}</span>)}</div>
              {participant.unique.length > 0 && <p className="party-unique"><span>Only theirs:</span> {participant.unique.slice(0, 6).join(', ')}{participant.unique.length > 6 ? ` +${participant.unique.length - 6}` : ''}</p>}
            </article>
          ))}
        </div>
      </section>

      <section className="shared-paths overlap-map" aria-label="Shared public profile paths">
        <div className="overlap-intro">
          <div className="eyebrow">SHARED PATHS</div>
          <h3>Where the paths cross</h3>
          <p className="shared-note">{metrics.verifiedShared.length} were Found for at least two people · {metrics.everyoneSites.length} appeared for everyone completed.</p>
          <div className="overlap-legend" aria-label="Overlap map legend">
            <span><i className="overlap-key found">F</i>Found</span>
            <span><i className="overlap-key maybe">M</i>Maybe</span>
            <span><i className="overlap-key none">·</i>No signal</span>
          </div>
          {metrics.sharedDetails.length > 14 && <p className="overlap-more">Showing 14 of {metrics.sharedDetails.length} shared sites. Rows with more people appear first, then rows with more Found confirmations.</p>}
        </div>

        {overlapRows.length ? (
          <div className="overlap-scroll" tabIndex={0} aria-label="Scroll shared paths horizontally if needed">
            <div className="overlap-board" style={{ minWidth: `${overlapMinWidth}px` }}>
              <div className="overlap-row overlap-head" style={{ gridTemplateColumns: overlapColumns }}>
                <div className="overlap-source-heading">Public site</div>
                {metrics.participants.map((participant) => (
                  <div className="overlap-person" key={participant.query} title={`@${participant.query}`}>
                    <span>{participant.query.slice(0, 1).toUpperCase()}</span>
                    <small>@{compactUsername(participant.query)}</small>
                  </div>
                ))}
              </div>
              {overlapRows.map((source) => (
                <div className="overlap-row overlap-source-row" style={{ gridTemplateColumns: overlapColumns }} key={source.sourceId}>
                  <div className="overlap-source-name">
                    <strong>{source.sourceName}</strong>
                    <small>{CATEGORY_LABELS[source.category]} · {source.participantCount}/{metrics.participants.length} people</small>
                  </div>
                  {metrics.participants.map((participant) => {
                    const match = source.statuses.find((entry) => entry.query === participant.query);
                    const verdict = match?.status === 'FOUND' ? 'Found' : match?.status === 'POSSIBLE' ? 'Maybe' : 'No Found or Maybe signal';
                    return (
                      <div
                        className={`overlap-cell ${match?.status === 'FOUND' ? 'found' : match?.status === 'POSSIBLE' ? 'maybe' : 'none'}`}
                        key={participant.query}
                        title={`@${participant.query}: ${verdict} on ${source.sourceName}`}
                        aria-label={`@${participant.query}: ${verdict} on ${source.sourceName}`}
                      >
                        <span aria-hidden="true">{match?.status === 'FOUND' ? 'F' : match?.status === 'POSSIBLE' ? 'M' : '·'}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ) : <p className="overlap-empty">No shared Found or Maybe sites showed up in the completed scans.</p>}
      </section>

      <details className="friend-comparison-details">
        <summary>
          <span><span className="eyebrow">COMPARISON DETAILS</span><strong>Found vs. Maybe by person</strong></span>
          <small>{metrics.participants.length} people</small>
        </summary>
        <div className="friend-signal-chart" aria-label="Friend signal comparison">
          <div className="friend-chart-head">
            <div><h3>Signal mix</h3><p>Counts from this comparison only.</p></div>
            <div className="chart-legend" aria-label="Chart legend"><span><i className="legend-found" />Found</span><span><i className="legend-maybe" />Maybe</span></div>
          </div>
          <div className="friend-bars">
            {metrics.participants.map((participant) => {
              const maxTrail = Math.max(1, ...metrics.participants.map((item) => item.trail));
              return (
                <div className="friend-bar-row" key={participant.query}>
                  <strong>@{participant.query}</strong>
                  <div className="friend-bar-track" aria-hidden="true">
                    <span className="friend-found" style={{ width: `${(participant.confirmed / maxTrail) * 100}%` }} />
                    <span className="friend-maybe" style={{ width: `${(participant.possible / maxTrail) * 100}%` }} />
                  </div>
                  <small>{participant.confirmed} found · {participant.possible} maybe</small>
                </div>
              );
            })}
          </div>
        </div>
      </details>

      <p className="party-disclaimer">Friend Mode only compares public profile signals from this scan. A Maybe result still needs a manual check, and none of these comparisons prove identity or account ownership. Shared setup links only prefill the usernames and do not run or save a scan.</p>
    </section>
  );
}

function PairGame({ title, pair, note }: { title: string; pair: FriendPair | null; note: (pair: FriendPair) => string }) {
  if (!pair) return <FriendGame title={title} value="—" note="Not enough people have finished scanning yet" />;
  return <FriendGame title={title} value={`@${pair.names[0]} + @${pair.names[1]}`} note={note(pair)} />;
}

function FriendGame({ title, value, note }: { title: string; value: string; note: string }) {
  return <article className="friend-game"><span>{title}</span><strong>{value}</strong><small>{note}</small></article>;
}

function ResultCard({ result }: { result: SourceResult }) {
  const [open, setOpen] = useState(false);
  const basisLabel = result.evidenceBasis === 'direct-api' ? 'Verified by site' : 'Needs a look';
  const statusNote: Record<ResultStatus, string> = {
    FOUND: 'site confirmed username',
    POSSIBLE: 'open to review',
    NOT_FOUND: 'exact check returned no match',
    UNKNOWN: 'not enough evidence',
    BLOCKED: 'site limited the check',
    SKIPPED: 'username format did not fit',
  };

  return (
    <article className={`result-card status-${result.status.toLowerCase().replace('_', '-')}`}>
      <div className="result-main">
        <button className="result-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          <span className="result-status-rail" aria-hidden="true" />
          <span className="source-glyph">{result.sourceName.slice(0, 1)}</span>
          <span className="source-title">
            <span className="source-line"><strong>{result.sourceName}</strong>{result.nsfw && <span className="nsfw-badge">18+</span>}</span>
            <span className="result-meta-line"><span className="category-badge">{CATEGORY_LABELS[result.category]}</span><span className={`basis-badge ${result.evidenceBasis}`}>{basisLabel}</span></span>
            <small>{friendlyReason(result)}</small>
          </span>
          <span className="result-verdict">
            <span className="status-pill">{statusLabel[result.status]}</span>
            <small>{statusNote[result.status]}</small>
          </span>
          <span className="chevron" aria-hidden="true">{open ? '−' : '+'}</span>
        </button>
        <a className="result-open" href={result.profileUrl} target="_blank" rel="noreferrer" aria-label={`Open ${result.sourceName} profile`}>Open profile <span aria-hidden="true">↗</span></a>
      </div>
      {open && (
        <div className="evidence-panel">
          <div className="evidence-panel-head">
            <div>
              <span className="eyebrow">WHY ARIADNE MARKED THIS {statusLabel[result.status].toUpperCase()}</span>
              <strong>{friendlyReason(result)}</strong>
            </div>
            <span className={`basis-badge ${result.evidenceBasis}`}>{basisLabel}</span>
          </div>
          <div className="evidence-explainer">
            <strong>{basisLabel}</strong>
            <span>{result.evidenceBasis === 'direct-api' ? 'This site gave Ariadne the username directly, so it can be checked exactly.' : 'This page looks like a profile, but the site did not give Ariadne enough information to confirm the username on its own.'}</span>
          </div>
          <div className="actions"><a href={result.profileUrl} target="_blank" rel="noreferrer">Open profile</a><button onClick={() => copy(result.profileUrl)}>Copy link</button><button onClick={() => copy(JSON.stringify(result, null, 2))}>Copy evidence</button></div>
          <details className="technical-details">
            <summary>Technical details</summary>
            <div className="evidence-grid">
              <div><span>Response code</span><strong>{result.httpStatus ?? '—'}</strong></div>
              <div><span>Time</span><strong>{result.durationMs} ms</strong></div>
              <div><span>Checked</span><strong>{new Date(result.checkedAt).toLocaleTimeString()}</strong></div>
            </div>
            <p className="raw-reason">{result.reason}</p>
            <ul>{result.signals.map((signal, index) => <li key={`${signal.kind}-${index}`}><span>{signal.kind}</span>{signal.detail}</li>)}</ul>
          </details>
        </div>
      )}
    </article>
  );
}
