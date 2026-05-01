'use client';

import { useEffect, useState } from 'react';

export default function MacroYieldsWidget() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/data_pages/macro/yields')
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!data) return <div className="loading"><div className="spinner" />Loading yields…</div>;

  const curve = data.curve || data.yields || [];
  if (curve.length === 0) return <div className="loading">No yield data</div>;

  return (
    <div className="macro-widget">
      <div className="macro-title">US Treasury yield curve</div>
      <table className="dt">
        <thead><tr><th>Tenor</th><th>Yield</th><th>Δ 1d</th></tr></thead>
        <tbody>
          {curve.map((p, i) => (
            <tr key={i}>
              <td>{p.tenor || p.label || p.maturity}</td>
              <td className="vc">{p.yield != null ? p.yield.toFixed(3) + '%' : (p.value != null ? p.value.toFixed(3) + '%' : '—')}</td>
              <td className={p.change >= 0 ? 'vg' : 'vr'}>{p.change != null ? `${p.change >= 0 ? '+' : ''}${p.change.toFixed(3)}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}