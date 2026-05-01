'use client';

import { useEffect, useState } from 'react';

export default function EarnWidget({ params }) {
  const symbol = (params?.symbol || 'NVDA').toUpperCase();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    setData(null); setErr('');
    fetch(`/data_pages/earnings?symbol=${symbol}`)
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [symbol]);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!data) return <div className="loading"><div className="spinner" />Loading earnings…</div>;

  const next = data.calendar?.[0];
  const hist = data.history || [];

  return (
    <div className="earn-widget">
      {next?.date && (
        <div className="ne"><span className="ne-icon">📅</span><div><div className="ne-lbl">Next Earnings</div><div className="ne-date">{next.date}</div></div></div>
      )}
      {hist.length > 0 ? (
        <table className="dt"><thead><tr><th>Date</th><th>Est.</th><th>Actual</th><th>Surprise</th></tr></thead>
          <tbody>{hist.slice(0, 6).map((e, i) => {
            const s = e.eps != null && e.epsEstimated ? ((e.eps - e.epsEstimated) / Math.abs(e.epsEstimated || 1) * 100) : null;
            return <tr key={i}><td>{e.date}</td><td>${e.epsEstimated?.toFixed(2) ?? '—'}</td><td>${e.eps?.toFixed(2) ?? '—'}</td><td className={s != null ? (s >= 0 ? 'vg' : 'vr') : ''}>{s != null ? `${s >= 0 ? '+' : ''}${s.toFixed(1)}%` : '—'}</td></tr>;
          })}</tbody></table>
      ) : (
        <div className="loading">No earnings history available for {symbol}</div>
      )}
    </div>
  );
}