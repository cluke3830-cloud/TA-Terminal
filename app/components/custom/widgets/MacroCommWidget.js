'use client';

import { useEffect, useRef, useState } from 'react';
import { fmt, fmtPct } from '../../ui';

function CommodityCard({ c, plotlyReady }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!plotlyReady || !ref.current || !c.sparkline || c.sparkline.length < 2) return;
    const isUp = c.changePct == null ? true : c.changePct >= 0;
    const color = isUp ? '#00f59b' : '#ff3355';
    window.Plotly.newPlot(ref.current, [{
      type: 'scatter', mode: 'lines', x: c.sparkline.map((_, i) => i), y: c.sparkline,
      line: { color, width: 2, shape: 'spline' }, fill: 'tozeroy',
      fillcolor: isUp ? 'rgba(0,245,155,0.12)' : 'rgba(255,51,85,0.12)', hoverinfo: 'skip',
    }], {
      paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
      xaxis: { visible: false, fixedrange: true },
      yaxis: { visible: false, fixedrange: true, range: [Math.min(...c.sparkline) * 0.98, Math.max(...c.sparkline) * 1.02] },
      margin: { l: 0, r: 0, t: 0, b: 0 }, showlegend: false,
    }, { displayModeBar: false, responsive: true });
  }, [plotlyReady, c.sparkline, c.changePct]);

  const ytdColor = c.ytdPct == null ? 'var(--smoke)' : c.ytdPct >= 0 ? '#00f59b' : '#ff3355';
  return (
    <div className="comm-card" style={{ cursor: 'default' }}>
      <div className="comm-row-top">
        <div className="comm-name">{c.name}</div>
        <span className={`comm-cat-tag cat-${c.category}`}>{c.category}</span>
      </div>
      <div className="comm-price">{c.price != null ? fmt(c.price, c.price < 10 ? 3 : 2) : '—'}</div>
      <div className="comm-row-mid">
        <span className={`comm-chg ${c.changePct == null ? '' : c.changePct >= 0 ? 'up' : 'dn'}`}>
          {c.changePct != null ? fmtPct(c.changePct) : '—'} 24h
        </span>
        <span className="comm-unit">{c.unit}</span>
      </div>
      <div ref={ref} className="comm-spark" />
      <div className="comm-hi-lo">
        <div className="comm-hi-lo-row">
          <span>52W</span>
          <span>{c.weekLow52 != null ? `$${fmt(c.weekLow52, c.weekLow52 < 10 ? 3 : 2)} – $${fmt(c.weekHigh52, c.weekHigh52 < 10 ? 3 : 2)}` : '—'}</span>
        </div>
        <div className="comm-hi-lo-row">
          <span>YTD</span>
          <span style={{ color: ytdColor, fontWeight: 700 }}>{c.ytdPct != null ? fmtPct(c.ytdPct) : '—'}</span>
        </div>
      </div>
    </div>
  );
}

export default function MacroCommWidget() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [plotlyReady, setPlotlyReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.Plotly) { setPlotlyReady(true); return; }
    const t = setInterval(() => { if (window.Plotly) { setPlotlyReady(true); clearInterval(t); } }, 100);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/data_pages/macro/commodities')
        .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
        .then((j) => { if (!cancelled) setData(j); })
        .catch((e) => { if (!cancelled) setErr(String(e)); });
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!data?.commodities) return <div className="loading"><div className="spinner" />Loading commodities…</div>;

  return (
    <div style={{ padding: '8px 14px 12px' }}>
      <div className="comm-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {data.commodities.map((c) => (
          <CommodityCard key={c.symbol} c={c} plotlyReady={plotlyReady} />
        ))}
      </div>
    </div>
  );
}