'use client';
import { useEffect, useRef, useState } from 'react';

export default function VixTerm({ plotlyReady }) {
  const termRef = useRef(null);
  const histRef = useRef(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/data_pages/macro/vix')
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { if (d.error) setErr(d.error); else setData(d); } })
      .catch((e) => !cancelled && setErr(e.message));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!plotlyReady || !data || !termRef.current) return;
    const c = data.current;
    const tenors = [
      { x: 30, y: c.VIX, label: 'VIX' },
      { x: 90, y: c.VIX3M, label: 'VIX3M' },
      { x: 180, y: c.VIX6M, label: 'VIX6M' },
    ].filter((p) => p.y != null);
    window.Plotly.newPlot(termRef.current, [{
      x: tenors.map((t) => t.x),
      y: tenors.map((t) => t.y),
      text: tenors.map((t) => t.label),
      type: 'scatter', mode: 'lines+markers+text', textposition: 'top center',
      line: { color: c.regime === 'contango' ? '#00f59b' : '#ff3355', width: 3, shape: 'spline' },
      marker: { size: 12, color: '#cceeFF' },
      hovertemplate: '%{text}<br>%{y:.2f}<extra></extra>',
    }], {
      paper_bgcolor: '#111117', plot_bgcolor: '#111117',
      font: { color: '#a0a0b4', family: 'Geist Mono', size: 10 },
      margin: { l: 50, r: 20, t: 32, b: 40 },
      title: { text: `VIX Term Structure · ${c.regime?.toUpperCase()}`, font: { size: 12, color: '#a0a0b4' } },
      xaxis: { title: 'Tenor (days)', gridcolor: '#282835' },
      yaxis: { title: 'VIX (level)', gridcolor: '#282835' },
    }, { responsive: true, displayModeBar: false });
  }, [data, plotlyReady]);

  useEffect(() => {
    if (!plotlyReady || !data?.history?.length || !histRef.current) return;
    const h = data.history.filter((p) => p.ratio != null);
    window.Plotly.newPlot(histRef.current, [{
      x: h.map((p) => p.d), y: h.map((p) => p.ratio),
      type: 'scatter', mode: 'lines',
      line: { color: '#00d4ff', width: 2 },
      fill: 'tozeroy', fillcolor: 'rgba(0,212,255,0.12)',
      hovertemplate: '%{x}<br>VIX/VIX3M: %{y:.3f}<extra></extra>',
    }, {
      x: h.map((p) => p.d), y: h.map(() => 1),
      type: 'scatter', mode: 'lines',
      line: { color: '#ff3355', width: 1, dash: 'dash' },
      hoverinfo: 'skip', showlegend: false,
    }], {
      paper_bgcolor: '#111117', plot_bgcolor: '#111117',
      font: { color: '#a0a0b4', family: 'Geist Mono', size: 10 },
      margin: { l: 50, r: 20, t: 32, b: 40 },
      title: { text: '90d VIX/VIX3M Ratio · 1.0 = inversion', font: { size: 12, color: '#a0a0b4' } },
      xaxis: { gridcolor: '#282835' },
      yaxis: { title: 'Ratio', gridcolor: '#282835' },
      showlegend: false,
    }, { responsive: true, displayModeBar: false });
  }, [data, plotlyReady]);

  if (err) return <div className="card-b"><div className="err">⚠ VIX: {err}</div></div>;
  if (!data) return <div className="card-b"><div className="loading"><div className="spinner" />Loading VIX term structure…</div></div>;

  const c = data.current;
  return (
    <div className="card-b">
      <div style={{ padding: '0 14px 8px', display: 'flex', gap: 16, fontSize: 11, fontFamily: 'var(--mono)', flexWrap: 'wrap' }}>
        <span>VIX: <b className="vc">{c.VIX?.toFixed(2)}</b></span>
        <span>VIX3M: <b className="vc">{c.VIX3M?.toFixed(2)}</b></span>
        <span>VIX6M: <b className="vc">{c.VIX6M?.toFixed(2)}</b></span>
        <span>VIX/VIX3M: <b className={c.regime === 'contango' ? 'vg' : 'vr'}>{c.ratio?.toFixed(3)}</b></span>
        <span className={`badge ${c.regime === 'contango' ? 'b-g' : 'b-p'}`}>{c.regime?.toUpperCase()}</span>
      </div>
      <div className="g2">
        <div ref={termRef} style={{ height: 280 }} />
        <div ref={histRef} style={{ height: 280 }} />
      </div>
    </div>
  );
}