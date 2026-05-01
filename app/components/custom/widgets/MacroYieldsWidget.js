'use client';

import { useEffect, useRef, useState } from 'react';

const CHART_FONT = { color: '#7a7a90', family: 'Geist Mono', size: 10 };

export default function MacroYieldsWidget() {
  const [yields, setYields] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('current');
  const [plotlyReady, setPlotlyReady] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.Plotly) { setPlotlyReady(true); return; }
    const t = setInterval(() => { if (window.Plotly) { setPlotlyReady(true); clearInterval(t); } }, 100);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/data_pages/macro/yields')
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((j) => { if (!cancelled) setYields(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!plotlyReady || !ref.current || !yields?.current) return;
    const labels = yields.current.map((p) => p.label);
    const cur = yields.current.map((p) => p.yield);
    const traces = [{
      type: 'scatter', mode: 'lines+markers', x: labels, y: cur,
      line: { color: '#00d4ff', width: 2.5, shape: 'spline' },
      marker: { size: 6, color: '#00d4ff', line: { width: 1, color: '#050508' } },
      name: 'Current', fill: 'tozeroy', fillcolor: 'rgba(0,212,255,0.05)',
      hovertemplate: '%{x}: %{y:.2f}%<extra></extra>',
    }];
    if (tab !== 'current' && yields.historical?.[tab]) {
      const h = yields.historical[tab];
      traces.push({
        type: 'scatter', mode: 'lines', x: labels,
        y: labels.map((l) => h.find((p) => p.label === l)?.yield ?? null),
        line: { color: '#9955ff', width: 1.5, dash: 'dot', shape: 'spline' },
        name: tab.toUpperCase() + ' Ago', hovertemplate: '%{x}: %{y:.2f}%<extra></extra>',
      });
    }
    window.Plotly.newPlot(ref.current, traces, {
      paper_bgcolor: '#0b0b10', plot_bgcolor: '#0b0b10',
      xaxis: { color: '#7a7a90', gridcolor: '#1e1e28', linecolor: '#3a3a4d', tickfont: CHART_FONT, title: { text: 'MATURITY', font: { ...CHART_FONT, size: 9 }, standoff: 10 } },
      yaxis: { color: '#7a7a90', gridcolor: '#1e1e28', linecolor: '#3a3a4d', tickfont: CHART_FONT, ticksuffix: '%', title: { text: 'YIELD', font: { ...CHART_FONT, size: 9 }, standoff: 10 } },
      margin: { l: 50, r: 20, t: 14, b: 40 },
      legend: { orientation: 'h', x: 0, y: 1.12, font: CHART_FONT },
      hovermode: 'x unified', font: CHART_FONT,
      shapes: yields.inversion ? [{ type: 'rect', xref: 'x', yref: 'paper', x0: '2Y', x1: '10Y', y0: 0, y1: 1, fillcolor: 'rgba(255,51,85,0.06)', line: { width: 0 } }] : [],
    }, { displayModeBar: false, responsive: true });
  }, [plotlyReady, yields, tab]);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!yields) return <div className="loading"><div className="spinner" />Loading FRED yield data…</div>;

  return (
    <div style={{ padding: '8px 14px 12px' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {['current', '1y', '2y', '5y'].map((t) => (
          <button key={t} className={`tf ${tab === t ? 'a' : ''}`} onClick={() => setTab(t)}>
            {t === 'current' ? 'NOW' : t.toUpperCase() + ' AGO'}
          </button>
        ))}
      </div>
      <div className="yc-pills" style={{ padding: 0, marginBottom: 6 }}>
        <span className={`yc-pill${yields.inversion ? ' inv' : ''}`}>10Y-2Y <b>{yields.spread_10_2 != null ? (yields.spread_10_2 > 0 ? '+' : '') + yields.spread_10_2.toFixed(2) : '—'}</b></span>
        <span className="yc-pill">30Y-5Y <b>{yields.spread_30_5 != null ? (yields.spread_30_5 > 0 ? '+' : '') + yields.spread_30_5.toFixed(2) : '—'}</b></span>
        <span className="yc-pill">FED FUNDS <b>{yields.fedFundsRate != null ? yields.fedFundsRate.toFixed(2) + '%' : '—'}</b></span>
        {yields.inversion && <span className="yc-pill inv"><b>⚠ INVERTED</b></span>}
      </div>
      <div ref={ref} style={{ height: 340, width: '100%' }} />
    </div>
  );
}