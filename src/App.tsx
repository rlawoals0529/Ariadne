import { FormEvent, useEffect, useMemo, useState } from 'react';
import { buildFriendMetrics, type FriendMetrics, type FriendPair } from './friendGames';
import type { ResultStatus, SearchResponse, SourceResult } from './shared/types';

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

type SourceStats = { total: number; standard: number; nsfw: number; direct?: number; heuristic?: number; disabled?: number; provenance?: string };
type SensitivityFilter = 'ALL' | 'SFW' | 'NSFW';
type EvidenceFilter = 'ALL' | 'DIRECT' | 'HEURISTIC';
type Mode = 'solo' | 'party';

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

  const partyMetrics = useMemo(() => buildFriendMetrics(partyData), [partyData]);

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

  async function copyPartyCard() {
    const closest = partyMetrics.closestPair;
    const twins = partyMetrics.internetTwins;
    const lines = [
      'ARIADNE · FRIEND MODE',
      ...partyMetrics.participants.map((participant) => `@${participant.query}: ${participant.confirmed} found, ${participant.possible} maybe, ${participant.unique.length} only-theirs`),
      `Sites in common: ${partyMetrics.shared.length}`,
      `Everyone shares: ${partyMetrics.everyoneSites.length}`,
      closest ? `Most in common: @${closest.names[0]} + @${closest.names[1]} (${closest.shared} shared)` : 'Most in common: —',
      twins ? `Internet twins: @${twins.names[0]} + @${twins.names[1]} (${twins.similarity}% overlap in this scan)` : 'Internet twins: —',
      'Public profile pages only. “Maybe” results still need a quick manual check.',
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
        <div className="nav-note">PUBLIC USERNAME SEARCH · NO GUESSING</div>
      </header>

      <section className="hero">
        <div className="eyebrow">SEARCH PUBLIC PROFILES</div>
        <h1>See where a username<br /><em>shows up.</em></h1>
        <p className="lede">Type a username and Ariadne checks public profile pages. It separates matches a site can verify from pages that still need a quick look from you.</p>

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
          <div className="result-header">
            <div>
              <div className="eyebrow">SEARCH RESULTS</div>
              <h2>@{data.query}</h2>
              <p>{data.summary.FOUND} found · {data.summary.POSSIBLE} maybe · {data.results.length}/{data.sourceCount} sites checked</p>
            </div>
            <button className="secondary" onClick={exportJson}>Save JSON</button>
          </div>

          <EvidenceOverview data={data} />

          <div className="filters" aria-label="Filter results">
            {(['ALL', 'FOUND', 'POSSIBLE', 'NOT_FOUND', 'UNKNOWN', 'BLOCKED', 'SKIPPED'] as const).map((item) => (
              <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item === 'ALL' ? 'All' : statusLabel[item]}</button>
            ))}
          </div>

          <div className="filters evidence-filters" aria-label="Filter by how the site was checked">
            {(['ALL', 'DIRECT', 'HEURISTIC'] as const).map((item) => (
              <button key={item} className={evidenceFilter === item ? 'active' : ''} onClick={() => setEvidenceFilter(item)}>
                {item === 'ALL' ? 'All checks' : item === 'DIRECT' ? 'Verified by site' : 'Needs a look'}
              </button>
            ))}
          </div>

          {data.includeNsfw && (
            <div className="filters sensitivity-filters" aria-label="Filter adult sources">
              {(['ALL', 'SFW', 'NSFW'] as const).map((item) => (
                <button key={item} className={sensitivityFilter === item ? 'active' : ''} onClick={() => setSensitivityFilter(item)}>{item === 'ALL' ? 'All sites' : item === 'SFW' ? 'Regular sites' : 'Adult sites'}</button>
              ))}
            </div>
          )}

          <div className="results-list">{visible.map((result) => <ResultCard key={result.sourceId} result={result} />)}</div>
        </section>
      )}

      {mode === 'party' && partyData.length > 0 && <PartyReport reports={partyData} metrics={partyMetrics} loading={loading} onExport={exportJson} onCopy={copyPartyCard} />}

      <footer><span>ARIADNE v0.7</span><span>Public profiles only · Adult sites off by default · Friend comparisons are not saved</span></footer>
    </main>
  );
}

function SourceMeta({ standardCount, nsfwCount, directCount }: { standardCount?: number; nsfwCount?: number; directCount?: number }) {
  return (
    <div className="form-meta">
      <span>{standardCount ? `${standardCount} public sites` : 'Wide public-site search'}</span>
      <span>{nsfwCount ? `${nsfwCount} optional adult sites` : 'Adult sites are optional'}</span>
      {directCount !== undefined && <span>{directCount} sites can verify the exact username</span>}
      <span>Nothing saved</span>
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

function EvidenceOverview({ data }: { data: SearchResponse }) {
  const direct = data.results.filter((result) => result.evidenceBasis === 'direct-api');
  const heuristic = data.results.filter((result) => result.evidenceBasis === 'catalog-rule');
  const found = direct.filter((result) => result.status === 'FOUND').length;
  const maybe = heuristic.filter((result) => result.status === 'POSSIBLE').length;
  const couldNotCheck = data.summary.UNKNOWN + data.summary.BLOCKED;
  return (
    <div className="evidence-overview" aria-label="Result summary">
      <div><span>Found</span><strong>{found}</strong><small>The site returned the exact username</small></div>
      <div><span>Maybe</span><strong>{maybe}</strong><small>The profile looks real; open it to check</small></div>
      <div><span>Couldn’t check</span><strong>{couldNotCheck}</strong><small>The site blocked us or gave an unclear answer</small></div>
      <div><span>No profile found</span><strong>{data.summary.NOT_FOUND}</strong><small>Only exact site checks can show this</small></div>
    </div>
  );
}

function PartyReport({ reports, metrics, loading, onExport, onCopy }: { reports: SearchResponse[]; metrics: FriendMetrics; loading: boolean; onExport: () => void; onCopy: () => void }) {
  const everyoneLabel = metrics.everyoneSites.length ? `${metrics.everyoneSites.length} ${metrics.everyoneSites.length === 1 ? 'site' : 'sites'}` : 'None yet';
  const everyoneNote = metrics.everyoneSites.length
    ? `${metrics.verifiedEveryoneSites.length} verified for everyone${metrics.everyoneSites.length <= 3 ? ` · ${metrics.everyoneSites.join(', ')}` : ''}`
    : 'No site appeared for every completed friend in this scan';

  return (
    <section className="results-section party-report">
      <div className="result-header">
        <div><div className="eyebrow">FRIEND MODE</div><h2>{reports.length} people compared</h2><p>{metrics.shared.length} sites showed up for more than one person{loading ? ' · still checking' : ''}</p></div>
        <div className="party-actions"><button className="secondary" onClick={onCopy}>Copy summary</button><button className="secondary" onClick={onExport}>Save JSON</button></div>
      </div>

      <div className="friend-games" aria-label="Friend games">
        <PairGame title="Most in common" pair={metrics.closestPair} note={(pair) => `${pair.shared} shared sites · ${pair.verifiedShared} verified for both`} />
        <PairGame title="Internet twins" pair={metrics.internetTwins} note={(pair) => `${pair.similarity}% of their found/maybe sites overlap in this scan`} />
        <PairGame title="Most different" pair={metrics.mostDifferentPair} note={(pair) => `${pair.similarity}% overlap · ${pair.shared} shared sites`} />
        <PairGame title="Same corner" pair={metrics.categoryPair} note={(pair) => pair.topCategory ? `${pair.topCategoryCount} shared ${pair.topCategory} ${pair.topCategoryCount === 1 ? 'site' : 'sites'}` : 'No shared category yet'} />
        <FriendGame title="Most one-of-a-kind" value={metrics.mostUnique.map((name) => `@${name}`).join(' · ') || '—'} note="Most sites that did not show up for another friend" />
        <FriendGame title="Everyone’s here" value={everyoneLabel} note={everyoneNote} />
      </div>

      <div className="party-scoreboard">
        {metrics.participants.map((participant) => (
          <article key={participant.query} className="party-person">
            <div className="party-person-head"><div><span className="source-glyph">{participant.query.slice(0, 1).toUpperCase()}</span></div><div><strong>@{participant.query}</strong><small>{participant.trail} found or maybe</small></div></div>
            <dl><div><dt>Found</dt><dd>{participant.confirmed}</dd></div><div><dt>Maybe</dt><dd>{participant.possible}</dd></div><div><dt>Only theirs</dt><dd>{participant.unique.length}</dd></div></dl>
            <div className="category-stack">{participant.categories.slice(0, 5).map(([category, count]) => <span key={category}>{category} {count}</span>)}</div>
            {participant.unique.length > 0 && <p className="party-unique"><span>Only theirs:</span> {participant.unique.slice(0, 6).join(', ')}{participant.unique.length > 6 ? ` +${participant.unique.length - 6}` : ''}</p>}
          </article>
        ))}
      </div>

      <div className="shared-paths">
        <div>
          <div className="eyebrow">SITES IN COMMON</div>
          <h3>Where you overlap</h3>
          <p className="shared-note">{metrics.verifiedShared.length} were verified for at least two people · {metrics.everyoneSites.length} appeared for everyone completed.</p>
        </div>
        {metrics.shared.length ? <div className="path-cloud">{metrics.shared.map((source) => <span key={source}>{source}</span>)}</div> : <p>No shared sites showed up in the completed scans.</p>}
      </div>

      <p className="party-disclaimer">Friend mode only compares what this scan saw on public profile pages. A “Maybe” result still needs a quick manual check, so the friend-game cards are for fun rather than identity proof.</p>
    </section>
  );
}

function PairGame({ title, pair, note }: { title: string; pair: FriendPair | null; note: (pair: FriendPair) => string }) {
  if (!pair) return <FriendGame title={title} value="—" note="Not enough people have finished scanning yet" />;
  return <FriendGame title={title} value={`@${pair.names[0]} + @${pair.names[1]}`} note={note(pair)} />;
}

function FriendGame({ title, value, note }: { title: string; value: string; note: string }) {
  return <article><span>{title}</span><strong>{value}</strong><small>{note}</small></article>;
}

function ResultCard({ result }: { result: SourceResult }) {
  const [open, setOpen] = useState(result.status === 'FOUND' || result.status === 'POSSIBLE');
  const basisLabel = result.evidenceBasis === 'direct-api' ? 'Verified by site' : 'Needs a look';
  const quickNote = result.status === 'FOUND' ? 'site confirmed it' : result.status === 'POSSIBLE' ? 'you should check' : '';
  return (
    <article className={`result-card status-${result.status.toLowerCase().replace('_', '-')}`}>
      <div className="result-main">
        <button className="result-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          <span className="source-glyph">{result.sourceName.slice(0, 1)}</span>
          <span className="source-title">
            <span className="source-line"><strong>{result.sourceName}</strong>{result.nsfw && <span className="nsfw-badge">18+</span>}<span className="category-badge">{result.category}</span><span className={`basis-badge ${result.evidenceBasis}`}>{basisLabel}</span></span>
            <small>{friendlyReason(result)}</small>
          </span>
          <span className="status-pill">{statusLabel[result.status]}</span>
          <span className="confidence">{quickNote}</span>
          <span className="chevron">{open ? '−' : '+'}</span>
        </button>
      </div>
      {open && (
        <div className="evidence-panel">
          <div className="evidence-explainer">
            <strong>{basisLabel}</strong>
            <span>{result.evidenceBasis === 'direct-api' ? 'This site gave Ariadne the username directly, so it can be checked exactly.' : 'This page looks like a profile, but the site did not give Ariadne enough information to confirm the username on its own.'}</span>
          </div>
          <div className="actions"><a href={result.profileUrl} target="_blank" rel="noreferrer">Open profile</a><button onClick={() => copy(result.profileUrl)}>Copy link</button><button onClick={() => copy(JSON.stringify(result, null, 2))}>Copy details</button></div>
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
