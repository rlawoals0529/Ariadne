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

type SourceStats = { total: number; standard: number; nsfw: number; provenance?: string };
type SensitivityFilter = 'ALL' | 'SFW' | 'NSFW';

function emptySummary(): Record<ResultStatus, number> {
  return { FOUND: 0, POSSIBLE: 0, NOT_FOUND: 0, UNKNOWN: 0, BLOCKED: 0, SKIPPED: 0 };
}

function summarize(results: SourceResult[]) {
  const summary = emptySummary();
  for (const result of results) summary[result.status] += 1;
  return summary;
}

async function copy(text: string) {
  await navigator.clipboard.writeText(text);
}

export default function App() {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [sourceStats, setSourceStats] = useState<SourceStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [includeNsfw, setIncludeNsfw] = useState(false);
  const [filter, setFilter] = useState<'ALL' | SourceResult['status']>('ALL');
  const [sensitivityFilter, setSensitivityFilter] = useState<SensitivityFilter>('ALL');

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
      return true;
    }) ?? [],
    [data, filter, sensitivityFilter],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setData(null);
    setFilter('ALL');
    setSensitivityFilter('ALL');
    setLoading(true);

    let cursor: number | null = 0;
    let accumulated: SourceResult[] = [];
    let latest: SearchResponse | null = null;

    try {
      while (cursor !== null) {
        const response = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, kind: 'username', includeNsfw, cursor }),
        });
        const payload = await response.json() as SearchResponse | { error: string };
        if (!response.ok || 'error' in payload) throw new Error('error' in payload ? payload.error : 'Search failed');

        accumulated = [...accumulated, ...payload.results];
        latest = {
          ...payload,
          batchCount: accumulated.length,
          results: accumulated,
          summary: summarize(accumulated),
        };
        setData(latest);
        cursor = payload.nextCursor;
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Search failed';
      setError(accumulated.length && latest ? `Scan stopped after ${accumulated.length} of ${latest.sourceCount} sources: ${message}` : message);
    } finally {
      setLoading(false);
    }
  }

  function exportJson() {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ariadne-${data.query}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const standardCount = sourceStats?.standard;
  const nsfwCount = sourceStats?.nsfw;

  return (
    <main>
      <header className="nav">
        <a className="brand" href="/" aria-label="Ariadne home">
          <span className="mark">A</span><span>ARIADNE</span>
        </a>
        <div className="nav-note">PUBLIC ACCOUNT DISCOVERY · EVIDENCE FIRST</div>
      </header>

      <section className="hero">
        <div className="eyebrow">FOLLOW THE THREAD</div>
        <h1>Find the account.<br /><em>Keep the evidence.</em></h1>
        <p className="lede">Ariadne checks a wide catalog of public profile sources without pretending every successful response is a confirmed match. Broad-catalog hits stay <strong>Possible</strong> until the evidence is strong enough to confirm them.</p>
        <form onSubmit={submit} className="search-form">
          <label htmlFor="username">Username</label>
          <div className="search-row">
            <input id="username" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" spellCheck={false} placeholder="e.g. rlawoals0529" maxLength={64} />
            <button type="submit" disabled={loading || !query.trim()}>{loading ? 'Following…' : 'Follow thread'}</button>
          </div>

          <label className="nsfw-option">
            <input type="checkbox" checked={includeNsfw} onChange={(event) => setIncludeNsfw(event.target.checked)} disabled={loading} />
            <span className="switch" aria-hidden="true" />
            <span className="nsfw-copy">
              <strong>Include NSFW / adult sources</strong>
              <small>Off by default. Checks public profile pages only; explicit site names may appear in results.</small>
            </span>
          </label>

          <div className="form-meta">
            <span>{standardCount ? `${standardCount} standard sources` : 'Wide public-source catalog'}</span>
            <span>{nsfwCount ? `${nsfwCount} optional NSFW sources` : 'Optional NSFW catalog'}</span>
            <span>No search history stored</span>
          </div>
        </form>
        {error && <div className="error" role="alert">{error}</div>}
      </section>

      {!data && !loading && (
        <section className="principles" aria-label="How Ariadne verifies results">
          <article><span>01</span><h2>Confirmed vs. possible</h2><p>Direct API identity matches are confirmed. Broader site rules are labeled possible until you open the profile.</p></article>
          <article><span>02</span><h2>Unknown stays unknown</h2><p>Rate limits, CAPTCHAs, blocks, timeouts, and server failures never become account claims.</p></article>
          <article><span>03</span><h2>Explicit stays opt-in</h2><p>Adult sources are excluded unless you deliberately enable the NSFW catalog before searching.</p></article>
        </section>
      )}

      {loading && (
        <section className="loading-panel">
          <div className="thread-loader" />
          <div>
            <p>Following {query.trim()} across public sources…</p>
            {data && <small>{data.results.length} of {data.sourceCount} sources checked</small>}
          </div>
        </section>
      )}

      {data && (
        <section className="results-section">
          <div className="result-header">
            <div>
              <div className="eyebrow">THREAD REPORT</div>
              <h2>@{data.query}</h2>
              <p>{data.summary.FOUND} confirmed · {data.summary.POSSIBLE} possible · {data.results.length}/{data.sourceCount} checked</p>
            </div>
            <button className="secondary" onClick={exportJson}>Export JSON</button>
          </div>

          <div className="filters" aria-label="Filter results by verification status">
            {(['ALL', 'FOUND', 'POSSIBLE', 'NOT_FOUND', 'UNKNOWN', 'BLOCKED', 'SKIPPED'] as const).map((item) => (
              <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>
                {item === 'ALL' ? 'All' : statusLabel[item]}
              </button>
            ))}
          </div>

          {data.includeNsfw && (
            <div className="filters sensitivity-filters" aria-label="Filter results by sensitivity">
              {(['ALL', 'SFW', 'NSFW'] as const).map((item) => (
                <button key={item} className={sensitivityFilter === item ? 'active' : ''} onClick={() => setSensitivityFilter(item)}>
                  {item === 'ALL' ? 'All sources' : item === 'SFW' ? 'Standard only' : 'NSFW only'}
                </button>
              ))}
            </div>
          )}

          <div className="results-list">
            {visible.map((result) => <ResultCard key={result.sourceId} result={result} />)}
          </div>
        </section>
      )}

      <footer><span>ARIADNE v0.2</span><span>Public profile sources only · NSFW off by default · No breach data · No password-reset or signup probing</span></footer>
    </main>
  );
}

function ResultCard({ result }: { result: SourceResult }) {
  const [open, setOpen] = useState(result.status === 'FOUND' || result.status === 'POSSIBLE');
  return (
    <article className={`result-card status-${result.status.toLowerCase().replace('_', '-')}`}>
      <div className="result-main">
        <button className="result-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          <span className="source-glyph">{result.sourceName.slice(0, 1)}</span>
          <span className="source-title">
            <span className="source-line"><strong>{result.sourceName}</strong>{result.nsfw && <span className="nsfw-badge">NSFW</span>}<span className="category-badge">{result.category}</span></span>
            <small>{result.reason}</small>
          </span>
          <span className="status-pill">{statusLabel[result.status]}</span>
          <span className="confidence">{result.confidence === 'none' ? '—' : `${result.confidence} confidence`}</span>
          <span className="chevron">{open ? '−' : '+'}</span>
        </button>
      </div>
      {open && (
        <div className="evidence-panel">
          <div className="evidence-grid">
            <div><span>HTTP</span><strong>{result.httpStatus ?? '—'}</strong></div>
            <div><span>Duration</span><strong>{result.durationMs} ms</strong></div>
            <div><span>Checked</span><strong>{new Date(result.checkedAt).toLocaleTimeString()}</strong></div>
          </div>
          <ul>{result.signals.map((signal, index) => <li key={`${signal.kind}-${index}`}><span>{signal.kind}</span>{signal.detail}</li>)}</ul>
          <div className="actions">
            <a href={result.profileUrl} target="_blank" rel="noreferrer">Open profile</a>
            <button onClick={() => copy(result.profileUrl)}>Copy URL</button>
            <button onClick={() => copy(JSON.stringify(result, null, 2))}>Copy evidence</button>
          </div>
        </div>
      )}
    </article>
  );
}
