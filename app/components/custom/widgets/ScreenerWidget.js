'use client';

import { useEffect, useState, useCallback } from 'react';

const PRESETS = [
  'P/E < 20 AND ROE > 0.15',
  'SECTOR = "Technology" AND DEBT/EQUITY < 0.5',
  'P/B < 3 AND NET_MARGIN > 0.1',
  'GROSS_MARGIN > 0.5 AND P/E < 30',
];

function fmtCell(v) {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  const a = Math.abs(v);
  if (a >= 1) return v.toFixed(2);
  return (v * 100).toFixed(2) + '%';
}

export default function ScreenerWidget({ params, onParams }) {
  const [predicate, setPredicate] = useState(params?.predicate || PRESETS[0]);
  const [universe, setUniverse] = useState(params?.universe || 'SP500');
  const [customText, setCustomText] = useState((params?.customTickers || []).join(','));
  const [results, setResults] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // Listen for SCREEN / SCREEN UNIVERSE commands from elsewhere.
  useEffect(() => {
    const onApply = (ev) => {
      const cmd = ev.detail;
      if (!cmd) return;
      if (cmd.kind === 'screen') setPredicate(cmd.predicate);
      else if (cmd.kind === 'screen_universe') setUniverse(cmd.universe);
    };
    window.addEventListener('qt:screener:apply', onApply);
    return () => window.removeEventListener('qt:screener:apply', onApply);
  }, []);

  const run = useCallback(async () => {
    setLoading(true); setErr(''); setResults(null); setStats(null);
    const tickers = customText.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    try {
      const r = await fetch('/data_pages/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ predicate, universe, tickers: universe === 'CUSTOM' ? tickers : null }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d?.stats?.error || `HTTP ${r.status}`); }
      else { setResults(d.matches || []); setStats(d.stats || null); }
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
      onParams?.({ predicate, universe, customTickers: tickers });
    }
  }, [predicate, universe, customText, onParams]);

  const fields = stats?.fields || [];

  return (
    <div className="screener">
      <div className="screener-bar">
        <input
          className="screener-pred"
          value={predicate}
          onChange={(e) => setPredicate(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } }}
          placeholder='predicate, e.g. P/E < 20 AND ROE > 0.15'
        />
        <select className="screener-uni" value={universe} onChange={(e) => setUniverse(e.target.value)}>
          <option value="SP500">S&P 500</option>
          <option value="CUSTOM">User-defined</option>
        </select>
        <button className="screener-btn" onClick={run} disabled={loading}>{loading ? 'Scanning…' : 'Run'}</button>
      </div>
      {universe === 'CUSTOM' && (
        <input
          className="screener-custom"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          placeholder="comma-separated tickers, e.g. NVDA, AAPL, AMD"
        />
      )}
      <div className="screener-presets">
        {PRESETS.map((p) => (
          <button key={p} className="screener-preset" onClick={() => setPredicate(p)}>{p}</button>
        ))}
      </div>
      {err && <div className="err">⚠ {err}</div>}
      {stats && (
        <div className="screener-stats">
          scanned <b>{stats.scanned}</b> · matched <b>{stats.matched}</b> · {stats.ms} ms
        </div>
      )}
      {results && results.length > 0 && (
        <div className="screener-results">
          <table className="dt screener-table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Name</th>
                {fields.map((f) => <th key={f}>{f}</th>)}
              </tr>
            </thead>
            <tbody>
              {results.map((m) => (
                <tr key={m.symbol}>
                  <td className="screener-sym">{m.symbol}</td>
                  <td className="screener-name">{m.cells?.NAME || ''}</td>
                  {fields.map((f) => <td key={f}>{fmtCell(m.cells?.[f])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {results && results.length === 0 && !loading && <div className="screener-empty">no matches</div>}
    </div>
  );
}