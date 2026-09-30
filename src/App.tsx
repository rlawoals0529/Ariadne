import { FormEvent, useMemo, useState } from 'react';
import type { SearchResponse, SourceResult } from './shared/types';

const statusLabel: Record<SourceResult['status'], string> = {
  FOUND: 'Found',
  NOT_FOUND: 'Not found',
  UNKNOWN: 'Unknown',
  BLOCKED: 'Blocked',
  SKIPPED: 'Skipped',
};

async function copy(text: string) {
  await navigator.clipboard.writeText(text);
}

export default function App() {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'ALL' | SourceResult['status']>('ALL');

  const visible = useMemo(
    () => data?.results.filter((result) => filter === 'ALL' || result.status === filter) ?? [],
    [data, filter],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setData(null);
    setFilter('ALL');
    setLoading(true);
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, kind: 'username' }),
      });
      const payload = await response.json() as SearchResponse | { error: string };
      if (!response.ok || 'error' in payload) throw new Error('error' in payload ? payload.error : 'Search failed');
      setData(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Search failed');
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
        <p className="lede">Ariadne checks public profile sources without pretending every successful HTTP response is a match. Ambiguous evidence stays ambiguous.</p>
        <form onSubmit={submit} className="search-form">
          <label htmlFor="username">Username</label>
          <div className="search-row">
            <input id="username" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" spellCheck={false} placeholder="e.g. rlawoals0529" maxLength={64} />
            <button type="submit" disabled={loading || !query.trim()}>{loading ? 'Following…' : 'Follow thread'}</button>
          </div>
          <div className="form-meta"><span>5 public sources</span><span>No search history stored</span><span>Username only in v0.1</span></div>
        </form>
        {error && <div className="error" role="alert">{error}</div>}
      </section>

      {!data && !loading && (
        <section className="principles" aria-label="How Ariadne verifies results">
          <article><span>01</span><h2>Evidence, not status codes</h2><p>A positive result needs a source-specific identity signal.</p></article>
          <article><span>02</span><h2>Unknown stays unknown</h2><p>Rate limits, blocks, and server failures never become account claims.</p></article>
          <article><span>03</span><h2>Open the proof</h2><p>Every result keeps its URL, response state, timing, and verification signals.</p></article>
        </section>
      )}

      {loading && <section className="loading-panel"><div className="thread-loader" /><p>Following {query.trim()} across public sources…</p></section>}

      {data && (
        <section className="results-section">
          <div className="result-header">
            <div><div className="eyebrow">THREAD REPORT</div><h2>@{data.query}</h2><p>{data.summary.FOUND} confirmed across {data.sourceCount} checked sources</p></div>
            <button className="secondary" onClick={exportJson}>Export JSON</button>
          </div>

          <div className="filters" aria-label="Filter results">
            {(['ALL', 'FOUND', 'NOT_FOUND', 'UNKNOWN', 'BLOCKED', 'SKIPPED'] as const).map((item) => (
              <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>
                {item === 'ALL' ? 'All' : statusLabel[item]}
              </button>
            ))}
          </div>

          <div className="results-list">
            {visible.map((result) => <ResultCard key={result.sourceId} result={result} />)}
          </div>
        </section>
      )}

      <footer><span>ARIADNE v0.1</span><span>Public sources only · No breach data · No password-reset probing</span></footer>
    </main>
  );
}

function ResultCard({ result }: { result: SourceResult }) {
  const [open, setOpen] = useState(result.status === 'FOUND');
  return (
    <article className={`result-card status-${result.status.toLowerCase().replace('_', '-')}`}>
      <div className="result-main">
        <button className="result-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          <span className="source-glyph">{result.sourceName.slice(0, 1)}</span>
          <span className="source-title"><strong>{result.sourceName}</strong><small>{result.reason}</small></span>
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
