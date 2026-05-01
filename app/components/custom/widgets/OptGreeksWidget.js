'use client';

import { useEffect, useState } from 'react';

export default function OptGreeksWidget({ params }) {
  const symbol = (params?.symbol || 'NVDA').toUpperCase();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    setData(null); setErr('');
    fetch(`/data_pages/options/greeks?symbol=${symbol}`)
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [symbol]);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!data) return <div className="loading"><div className="spinner" />Loading greeks…</div>;

  const rows = data.greeks || data.rows || [];
  if (rows.length === 0) return <div className="loading">No greeks available for {symbol}</div>;
  const subset = rows.slice(0, 10);

  return (
    <div className="opt-widget">
      <div className="opt-meta">spot ${data.spot?.toFixed(2) || '—'}</div>
      <table className="dt opt-table">
        <thead><tr><th>Type</th><th>Strike</th><th>DTE</th><th>Δ</th><th>Γ</th><th>ν</th><th>Θ</th></tr></thead>
        <tbody>
          {subset.map((g, i) => (
            <tr key={i}>
              <td>{g.type?.toUpperCase()}</td>
              <td>{g.strike}</td>
              <td>{g.dte}</td>
              <td>{g.delta?.toFixed(3) ?? '—'}</td>
              <td>{g.gamma?.toFixed(4) ?? '—'}</td>
              <td>{g.vega?.toFixed(3) ?? '—'}</td>
              <td>{g.theta?.toFixed(3) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}