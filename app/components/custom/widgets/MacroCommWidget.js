'use client';

import { useEffect, useState } from 'react';

export default function MacroCommWidget() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/data_pages/macro/commodities')
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!data) return <div className="loading"><div className="spinner" />Loading commodities…</div>;

  const items = data.commodities || data.items || data.list || [];
  if (items.length === 0) return <div className="loading">No commodity data</div>;

  return (
    <div className="macro-widget">
      <div className="macro-title">Commodities</div>
      <table className="dt">
        <thead><tr><th>Symbol</th><th>Name</th><th>Price</th><th>Δ %</th></tr></thead>
        <tbody>
          {items.slice(0, 12).map((c, i) => (
            <tr key={i}>
              <td>{c.symbol || c.ticker}</td>
              <td>{c.name}</td>
              <td className="vc">{c.price?.toFixed?.(2) ?? c.price ?? '—'}</td>
              <td className={(c.changePct ?? c.change) >= 0 ? 'vg' : 'vr'}>
                {(c.changePct ?? c.change) != null ? `${(c.changePct ?? c.change) >= 0 ? '+' : ''}${(c.changePct ?? c.change).toFixed(2)}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}