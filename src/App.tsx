import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { ResultStatus, SearchResponse, SourceResult } from './shared/types';

const statusLabel: Record<SourceResult['status'], string> = {
  FOUND: 'Confirmed',
  POSSIBLE: 'Possible',
  NOT_FOUND: 'Not found',
  UNKNOWN: 'Unknown',
  BLOCKED: 'Blocked',
  SKIPPED: 'Skipped',
};

type SourceStats = { total: number; standard: number; nsfw: number; direct?: number; heuristic?: number; disabled?: number; provenance?: string };
type SensitivityFilter = 'ALL' | 'SFW' | 'NSFW';
type EvidenceFilter = 'ALL' | 'DIRECT' | 'HEURISTIC';
type Mode = 'solo' | 'party';

type PartyMetrics = {
  participants: Array<{
    query: string;
    confirmed: number;
    possible: number;
    trail: number;
    unique: string[];
    categories: Array<[string, number]>;
  }>;
  shared: string[];
  longest: string[];
  mostConfirmed: string[];
  mostUnique: string[];
};

function emptySummary(): Record<ResultStatus, number> {
  return { FOUND: 0, POSSIBLE: 0, NOT_FOUND: 0, UNKNOWN: 0, BLOCKED: 0, SKIPPED: 0 };
}

function summarize(results: SourceResult[]) {
  const summary = emptySummary();
  for (const result of results) summary[result.status] += 1;
  return summary;
}

function isTrail(result: SourceResult) {
  return result.status === 'FOUND' || result.status === 'POSSIBLE';
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

function buildPartyMetrics(reports: SearchResponse[]): PartyMetrics {
  const sourceUsers = new Map<string, Set<string>>();
  const sourceNames = new Map<string, string>();

  for (const report of reports) {
    for (const result of report.results.filter(isTrail)) {
      sourceNames.set(result.sourceId, result.sourceName);
      const users = sourceUsers.get(result.sourceId) ?? new Set<string>();
      users.add(report.query);
      sourceUsers.set(result.sourceId, users);
    }
  }

  const shared = [...sourceUsers.entries()]
    .filter(([, users]) => users.size >= 2)
    .map(([sourceId]) => sourceNames.get(sourceId) ?? sourceId)
    .sort((a, b) => a.localeCompare(b));

  const participants = reports.map((report) => {
    const trails = report.results.filter(isTrail);
    const unique = trails.filter((result) => sourceUsers.get(result.sourceId)?.size === 1).map((result) => result.sourceName).sort((a, b) => a.localeCompare(b));
    const categoryCounts = new Map<string, number>();
    for (const result of trails) categoryCounts.set(result.category, (categoryCounts.get(result.category) ?? 0) + 1);
    const categories = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    return {
      query: report.query,
      confirmed: report.summary.FOUND,
      possible: report.summary.POSSIBLE,
      trail: report.summary.FOUND + report.summary.POSSIBLE,
      unique,
      categories,
    };
  });

  function leaders(value: (participant: PartyMetrics['participants'][number]) => number) {
    const max = Math.max(0, ...participants.map(value));
    return participants.filter((participant) => value(participant) === max).map((participant) => participant.query);
  }

  return {
    participants,
    shared,
    longest: leaders((participant) => participant.trail),
    mostConfirmed: leaders((participant) => participant.confirmed),
    mostUnique: leaders((participant) => participant.unique.length),
  };
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

  useEffect(() => {
    fetch('/api/sources')
      .then((response) => response.ok ? response.json() : null)
      .then((payload: SourceStats | null) => payload && setSourceStats(payload))
      .catch(() => undefined);
  }, []);

  const visible = useMemo(
    () => data?.results.filter((result) => {
      if (filter !== 'ALL' && result.status !== filter) return false;
      if (sensitivityFilter === 'SFW' && result.nsfw) return false;
      if (sensitivityFilter === 'NSFW' && !result.nsfw) return false;
      if (evidenceFilter === 'DIRECT' && result.evidenceBasis !== 'direct-api') return false;
      if (evidenceFilter === 'HEURISTIC' && result.evidenceBasis !== 'catalog-rule') return false;
      return true;
    }) ?? [],
    [data, filter, sensitivityFilter, evidenceFilter],
  );

  const partyMetrics = useMemo(() => buildPartyMetrics(partyData), [partyData]);

  async function submitSolo(event: FormEvent) {
    event.preventDefault();
    setError('');
    setData(null);
    setFilter('ALL');
    setSensitivityFilter('ALL');
    setEvidenceFilter('ALL');
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
      setError('Add at least two usernames for Thread Party.');
      return;
    }
    if (unique.length !== names.length) {
      setError('Thread Party usernames must be unique.');
      return;
    }

    setError('');
    setPartyData([]);
    setPartyProgress('');
    setLoading(true);

    try {
      const reports: SearchResponse[] = [];
      for (let index = 0; index < names.length; index += 1) {
        const username = names[index];
        setPartyProgress(`Scanning @${username} · ${index + 1} of ${names.length}`);
        const report = await scanUsername(username, includeNsfw, (partial) => {
          setPartyProgress(`Scanning @${username} · ${partial.results.length}/${partial.sourceCount} sources · ${index + 1} of ${names.length}`);
        });
        reports.push(report);
        setPartyData([...reports]);
      }
      setPartyProgress('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Party scan failed');
    } finally {
      setLoading(false);
    }
  }

  function updatePartyQuery(index: number, value: string) {
    setPartyQueries((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  }

  function addPartyMember() {
    setPartyQueries((current) => current.length >= 4 ? current : [...current, '']);
  }

  function removePartyMember(index: number) {
    setPartyQueries((current) => current.length <= 2 ? current : current.filter((_, itemIndex) => itemIndex !== index));
  }

  function exportJson() {
    const payload = mode === 'party' ? { mode: 'thread-party', generatedAt: new Date().toISOString(), reports: partyData } : data;
    if (!payload) return;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = mode === 'party' ? 'ariadne-thread-party.json' : `ariadne-${data?.query ?? 'report'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyPartyCard() {
    const lines = [
      'ARIADNE · THREAD PARTY',
      ...partyMetrics.participants.map((participant) => `@${participant.query}: ${participant.confirmed} confirmed, ${participant.possible} possible, ${participant.unique.length} unique paths`),
      `Shared paths: ${partyMetrics.shared.length}`,
      `Longest thread: ${partyMetrics.longest.map((name) => `@${name}`).join(', ')}`,
      'Public-profile scan only. Possible matches are not confirmed identities.',
    ];
    await copy(lines.join('\n'));
  }

  const standardCount = sourceStats?.standard;
  const nsfwCount = sourceStats?.nsfw;
  const showPrinciples = mode === 'solo' ? !data && !loading : !partyData.length && !loading;

  return (
    <main>
      <header className="nav">
        <a className="brand" href="/" aria-label="Ariadne home"><span className="mark">A</span><span>ARIADNE</span></a>
        <div className="nav-note">PUBLIC ACCOUNT DISCOVERY · EVIDENCE FIRST</div>
      </header>

      <section className="hero">
        <div className="eyebrow">FOLLOW THE THREAD</div>
        <h1>Find the account.<br /><em>Keep the evidence.</em></h1>
        <p className="lede">Ariadne checks a wide catalog of public profile sources without pretending every successful response is a confirmed match. Broad-catalog hits stay <strong>Possible</strong> until the evidence is strong enough to confirm them.</p>

        <div className="mode-tabs" aria-label="Search mode">
          <button type="button" className={mode === 'solo' ? 'active' : ''} onClick={() => { setMode('solo'); setError(''); }}>Solo thread</button>
          <button type="button" className={mode === 'party' ? 'active' : ''} onClick={() => { setMode('party'); setError(''); }}>Thread Party</button>
        </div>

        {mode === 'solo' ? (
          <form onSubmit={submitSolo} className="search-form">
            <label htmlFor="username">Username</label>
            <div className="search-row">
              <input id="username" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" spellCheck={false} placeholder="e.g. exampleuser" maxLength={64} />
              <button type="submit" disabled={loading || !query.trim()}>{loading ? 'Following…' : 'Follow thread'}</button>
            </div>
            <NsfwOption checked={includeNsfw} onChange={setIncludeNsfw} disabled={loading} />
            <SourceMeta standardCount={standardCount} nsfwCount={nsfwCount} directCount={sourceStats?.direct} />
          </form>
        ) : (
          <form onSubmit={submitParty} className="search-form party-form">
            <div className="party-form-head">
              <div><label>Friends</label><small>Compare 2–4 usernames. Reports stay in this browser tab and are not saved by Ariadne.</small></div>
              <button type="button" className="text-button" onClick={addPartyMember} disabled={partyQueries.length >= 4 || loading}>+ Add friend</button>
            </div>
            <div className="party-inputs">
              {partyQueries.map((value, index) => (
                <div className="party-input-row" key={index}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <input value={value} onChange={(event) => updatePartyQuery(index, event.target.value)} autoComplete="off" spellCheck={false} placeholder={index === 0 ? 'your username' : 'friend username'} maxLength={64} aria-label={`Party username ${index + 1}`} />
                  {partyQueries.length > 2 && <button type="button" className="remove-member" onClick={() => removePartyMember(index)} aria-label={`Remove username ${index + 1}`}>×</button>}
                </div>
              ))}
            </div>
            <button className="party-submit" type="submit" disabled={loading || partyQueries.filter((value) => value.trim()).length < 2}>{loading ? 'Tracing party…' : 'Compare threads'}</button>
            <NsfwOption checked={includeNsfw} onChange={setIncludeNsfw} disabled={loading} />
            <SourceMeta standardCount={standardCount} nsfwCount={nsfwCount} directCount={sourceStats?.direct} />
          </form>
        )}
        {error && <div className="error" role="alert">{error}</div>}
      </section>

      {showPrinciples && (
        <section className="principles" aria-label="How Ariadne verifies results">
          <article><span>01</span><h2>Direct vs. heuristic</h2><p>Direct identity adapters can confirm a username. Catalog rules stay possible until you verify the profile yourself.</p></article>
          <article><span>02</span><h2>Unknown stays unknown</h2><p>Rate limits, CAPTCHAs, blocks, timeouts, and server failures never become account claims.</p></article>
          <article><span>03</span><h2>Compare, don’t score privacy</h2><p>Thread Party uses factual public-profile counts and overlap. It does not assign a privacy, safety, or reputation score.</p></article>
        </section>
      )}

      {loading && (
        <section className="loading-panel">
          <div className="thread-loader" />
          <div>
            <p>{mode === 'party' ? (partyProgress || 'Preparing party scan…') : `Following ${query.trim()} across public sources…`}</p>
            {mode === 'solo' && data && <small>{data.results.length} of {data.sourceCount} sources checked</small>}
          </div>
        </section>
      )}

      {mode === 'solo' && data && (
        <section className="results-section">
          <div className="result-header">
            <div>
              <div className="eyebrow">THREAD REPORT</div>
              <h2>@{data.query}</h2>
              <p>{data.summary.FOUND} confirmed · {data.summary.POSSIBLE} possible · {data.results.length}/{data.sourceCount} checked</p>
            </div>
            <button className="secondary" onClick={exportJson}>Export JSON</button>
          </div>

          <EvidenceOverview data={data} />

          <div className="filters" aria-label="Filter results by verification status">
            {(['ALL', 'FOUND', 'POSSIBLE', 'NOT_FOUND', 'UNKNOWN', 'BLOCKED', 'SKIPPED'] as const).map((item) => (
              <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item === 'ALL' ? 'All' : statusLabel[item]}</button>
            ))}
          </div>

          <div className="filters evidence-filters" aria-label="Filter results by evidence basis">
            {(['ALL', 'DIRECT', 'HEURISTIC'] as const).map((item) => (
              <button key={item} className={evidenceFilter === item ? 'active' : ''} onClick={() => setEvidenceFilter(item)}>
                {item === 'ALL' ? 'All evidence' : item === 'DIRECT' ? 'Direct identity' : 'Heuristic rules'}
              </button>
            ))}
          </div>

          {data.includeNsfw && (
            <div className="filters sensitivity-filters" aria-label="Filter results by sensitivity">
              {(['ALL', 'SFW', 'NSFW'] as const).map((item) => (
                <button key={item} className={sensitivityFilter === item ? 'active' : ''} onClick={() => setSensitivityFilter(item)}>{item === 'ALL' ? 'All sources' : item === 'SFW' ? 'Standard only' : 'NSFW only'}</button>
              ))}
            </div>
          )}

          <div className="results-list">{visible.map((result) => <ResultCard key={result.sourceId} result={result} />)}</div>
        </section>
      )}

      {mode === 'party' && partyData.length > 0 && <PartyReport reports={partyData} metrics={partyMetrics} loading={loading} onExport={exportJson} onCopy={copyPartyCard} />}

      <footer><span>ARIADNE v0.4</span><span>Public profile sources only · NSFW off by default · Party scans are not stored · No breach data</span></footer>
    </main>
  );
}

function SourceMeta({ standardCount, nsfwCount, directCount }: { standardCount?: number; nsfwCount?: number; directCount?: number }) {
  return (
    <div className="form-meta">
      <span>{standardCount ? `${standardCount} standard sources` : 'Wide public-source catalog'}</span>
      <span>{nsfwCount ? `${nsfwCount} optional NSFW sources` : 'Optional NSFW catalog'}</span>
      {directCount !== undefined && <span>{directCount} direct identity adapters</span>}
      <span>No search history stored</span>
    </div>
  );
}

function NsfwOption({ checked, onChange, disabled }: { checked: boolean; onChange: (value: boolean) => void; disabled: boolean }) {
  return (
    <label className="nsfw-option">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      <span className="switch" aria-hidden="true" />
      <span className="nsfw-copy"><strong>Include NSFW / adult sources</strong><small>Off by default. Checks public profile pages only; explicit site names may appear in results.</small></span>
    </label>
  );
}

function EvidenceOverview({ data }: { data: SearchResponse }) {
  const direct = data.results.filter((result) => result.evidenceBasis === 'direct-api');
  const heuristic = data.results.filter((result) => result.evidenceBasis === 'catalog-rule');
  const directConfirmed = direct.filter((result) => result.status === 'FOUND').length;
  const heuristicPossible = heuristic.filter((result) => result.status === 'POSSIBLE').length;
  const inconclusive = data.summary.UNKNOWN + data.summary.BLOCKED;
  return (
    <div className="evidence-overview" aria-label="Evidence summary">
      <div><span>Direct confirmations</span><strong>{directConfirmed}</strong><small>Identity returned by a public API</small></div>
      <div><span>Heuristic possibilities</span><strong>{heuristicPossible}</strong><small>Profile rule matched; verify manually</small></div>
      <div><span>Inconclusive</span><strong>{inconclusive}</strong><small>Unknown or blocked responses</small></div>
      <div><span>Explicitly absent</span><strong>{data.summary.NOT_FOUND}</strong><small>Configured missing-profile signal</small></div>
    </div>
  );
}

function PartyReport({ reports, metrics, loading, onExport, onCopy }: { reports: SearchResponse[]; metrics: PartyMetrics; loading: boolean; onExport: () => void; onCopy: () => void }) {
  return (
    <section className="results-section party-report">
      <div className="result-header">
        <div><div className="eyebrow">THREAD PARTY</div><h2>{reports.length} threads</h2><p>{metrics.shared.length} shared public-profile paths found across the completed scans{loading ? ' · scan still running' : ''}</p></div>
        <div className="party-actions"><button className="secondary" onClick={onCopy}>Copy party card</button><button className="secondary" onClick={onExport}>Export JSON</button></div>
      </div>
      <div className="party-awards" aria-label="Thread Party highlights">
        <PartyAward title="Longest thread" names={metrics.longest} note="Most confirmed + possible public-profile paths" />
        <PartyAward title="Most confirmed" names={metrics.mostConfirmed} note="Most direct high-confidence identity matches" />
        <PartyAward title="Most solo paths" names={metrics.mostUnique} note="Most sites not shared by another party member" />
      </div>
      <div className="party-scoreboard">
        {metrics.participants.map((participant) => (
          <article key={participant.query} className="party-person">
            <div className="party-person-head"><div><span className="source-glyph">{participant.query.slice(0, 1).toUpperCase()}</span></div><div><strong>@{participant.query}</strong><small>{participant.trail} public-profile paths</small></div></div>
            <dl><div><dt>Confirmed</dt><dd>{participant.confirmed}</dd></div><div><dt>Possible</dt><dd>{participant.possible}</dd></div><div><dt>Solo paths</dt><dd>{participant.unique.length}</dd></div></dl>
            <div className="category-stack">{participant.categories.slice(0, 5).map(([category, count]) => <span key={category}>{category} {count}</span>)}</div>
            {participant.unique.length > 0 && <p className="party-unique"><span>Unique:</span> {participant.unique.slice(0, 6).join(', ')}{participant.unique.length > 6 ? ` +${participant.unique.length - 6}` : ''}</p>}
          </article>
        ))}
      </div>
      <div className="shared-paths"><div><div className="eyebrow">SHARED PATHS</div><h3>Where the threads cross</h3></div>{metrics.shared.length ? <div className="path-cloud">{metrics.shared.map((source) => <span key={source}>{source}</span>)}</div> : <p>No shared confirmed/possible paths among the completed scans.</p>}</div>
      <p className="party-disclaimer">Thread Party is a comparison of this scan’s public-profile evidence, not a privacy, identity, reputation, or safety score. Possible matches still require manual confirmation.</p>
    </section>
  );
}

function PartyAward({ title, names, note }: { title: string; names: string[]; note: string }) {
  return <article><span>{title}</span><strong>{names.map((name) => `@${name}`).join(' · ') || '—'}</strong><small>{note}</small></article>;
}

function ResultCard({ result }: { result: SourceResult }) {
  const [open, setOpen] = useState(result.status === 'FOUND' || result.status === 'POSSIBLE');
  const basisLabel = result.evidenceBasis === 'direct-api' ? 'Direct identity' : 'Heuristic rule';
  return (
    <article className={`result-card status-${result.status.toLowerCase().replace('_', '-')}`}>
      <div className="result-main">
        <button className="result-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          <span className="source-glyph">{result.sourceName.slice(0, 1)}</span>
          <span className="source-title">
            <span className="source-line"><strong>{result.sourceName}</strong>{result.nsfw && <span className="nsfw-badge">NSFW</span>}<span className="category-badge">{result.category}</span><span className={`basis-badge ${result.evidenceBasis}`}>{basisLabel}</span></span>
            <small>{result.reason}</small>
          </span>
          <span className="status-pill">{statusLabel[result.status]}</span>
          <span className="confidence">{result.confidence === 'none' ? basisLabel : `${result.confidence} · ${basisLabel}`}</span>
          <span className="chevron">{open ? '−' : '+'}</span>
        </button>
      </div>
      {open && (
        <div className="evidence-panel">
          <div className="evidence-explainer">
            <strong>{basisLabel}</strong>
            <span>{result.evidenceBasis === 'direct-api' ? 'This adapter checks a public API for the requested identifier.' : 'This adapter uses a public profile rule. A positive response remains possible, not confirmed.'}</span>
          </div>
          <div className="evidence-grid">
            <div><span>Confidence</span><strong>{result.confidence === 'none' ? 'No claim' : result.confidence}</strong></div>
            <div><span>HTTP</span><strong>{result.httpStatus ?? '—'}</strong></div>
            <div><span>Duration</span><strong>{result.durationMs} ms</strong></div>
            <div><span>Checked</span><strong>{new Date(result.checkedAt).toLocaleTimeString()}</strong></div>
          </div>
          <ul>{result.signals.map((signal, index) => <li key={`${signal.kind}-${index}`}><span>{signal.kind}</span>{signal.detail}</li>)}</ul>
          <div className="actions"><a href={result.profileUrl} target="_blank" rel="noreferrer">Open profile</a><button onClick={() => copy(result.profileUrl)}>Copy URL</button><button onClick={() => copy(JSON.stringify(result, null, 2))}>Copy evidence</button></div>
        </div>
      )}
    </article>
  );
}
