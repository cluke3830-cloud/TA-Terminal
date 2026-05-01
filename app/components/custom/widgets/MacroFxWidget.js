'use client';

import { useEffect, useState } from 'react';

export default function MacroFxWidget() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/data_pages/macro/fx')
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!data) return <div className="loading"><div className="spinner" />Loading FX…</div>;

  const rates = data.rates || data.pairs || [];
  const list = Array.isArray(rates) ? rates : Object.entries(rates).map(([k, v]) => ({ pair: k, value: v }));
  if (list.length === 0) return <div className="loading">No FX data</div>;

  return (
    <div className="macro-widget">
      <div className="macro-title">FX rates</div>
      <table className="dt">
        <thead><tr><th>Pair</th><th>Rate</th><th>Δ %</th></tr></thead>
        <tbody>
          {list.slice(0, 14).map((r, i) => (
            <tr key={i}>
              <td>{r.pair || r.symbol || r.name}</td>
              <td className="vc">{(r.value ?? r.rate)?.toFixed?.(4) ?? (r.value ?? r.rate ?? '—')}</td>
              <td className={r.changePct >= 0 ? 'vg' : 'vr'}>{r.changePct != null ? `${r.changePct >= 0 ? '+' : ''}${r.changePct.toFixed(2)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}