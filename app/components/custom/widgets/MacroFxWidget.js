'use client';

import { useEffect, useState } from 'react';
import { fmtPct } from '../../ui';

export default function MacroFxWidget() {
  const [fx, setFx] = useState(null);
  const [err, setErr] = useState('');
  const [tf, setTf] = useState('24h');

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/data_pages/macro/fx')
        .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
        .then((j) => { if (!cancelled) setFx(j); })
        .catch((e) => { if (!cancelled) setErr(String(e)); });
    };
    load();
    const t = setInterval(load, 30 * 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!fx?.matrices) return <div className="loading"><div className="spinner" />FX matrix loading…</div>;

  const matrix = fx.matrices[tf] || fx.matrices['24h'];
  const cur = fx.currencies || [];
  const cell = (a, b) => {
    if (a === b) return { bg: 'var(--graphite)', text: '—' };
    const v = matrix[a]?.[b];
    if (v == null) return { bg: 'var(--obsidian)', text: '—' };
    const intensity = Math.min(1, Math.abs(v) / 2.0);
    const bg = v > 0
      ? `rgba(0, 245, 155, ${0.20 + intensity * 0.65})`
      : v < 0
      ? `rgba(255, 51, 85, ${0.20 + intensity * 0.65})`
      : 'rgba(85,85,104,0.15)';
    const text = (v > 0 ? '+' : '') + v.toFixed(2);
    return { bg, text };
  };
  const tfLabel = tf === '24h' ? '24h' : tf === '1w' ? '1-week' : '1-month';

  return (
    <div style={{ padding: '8px 14px 12px' }}>
      <div className="fx-dxy">
        <div>
          <div className="fx-dxy-l">DXY · USD Index (ICE)</div>
          <div className="fx-dxy-v">{fx.dxy != null ? fx.dxy.toFixed(2) : '—'}</div>
        </div>
        <div className="fx-tf">
          {['24h', '1w', '1m'].map((t) => (
            <button key={t} className={`mt ${tf === t ? 'a' : ''}`} onClick={() => setTf(t)}>{t.toUpperCase()}</button>
          ))}
        </div>
        <div className={`fx-dxy-c ${fx.dxyChange24h >= 0 ? 'comm-chg up' : 'comm-chg dn'}`}>
          {fx.dxyChange24h != null ? fmtPct(fx.dxyChange24h) : '—'} 24h
        </div>
      </div>
      <div className="fx-matrix" style={{ gridTemplateColumns: `60px repeat(${cur.length}, 1fr)`, marginTop: 10 }}>
        <div className="fx-mh">·</div>
        {cur.map((c) => <div key={`h-${c}`} className="fx-mh">{c}</div>)}
        {cur.map((a) => (
          <div key={`row-${a}`} style={{ display: 'contents' }}>
            <div className="fx-mh">{a}</div>
            {cur.map((b) => {
              const c = cell(a, b);
              return (
                <div key={`${a}-${b}`} className={`fx-mc${a === b ? ' diag' : ''}`} style={{ background: c.bg }} title={`${a}/${b}: ${c.text}% (${tfLabel})`}>
                  {c.text}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--ash)', letterSpacing: 0.5 }}>
        ROW = base · COL = quote · % = {tfLabel} relative strength
      </div>
    </div>
  );
}