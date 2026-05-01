'use client';

import { useEffect, useRef, useState } from 'react';

export default function OptIVWidget({ params }) {
  const symbol = (params?.symbol || 'NVDA').toUpperCase();
  const ref = useRef(null);
  const [opts, setOpts] = useState(null);
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
    setOpts(null); setErr('');
    fetch(`/data_pages/options?symbol=${symbol}`)
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((j) => { if (!cancelled) setOpts(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => {
    if (!opts?.surface?.length || !ref.current || !plotlyReady) return;
    const calls = opts.surface.filter((d) => d.type === 'call');
    if (calls.length < 5) return;
    const strikes = [...new Set(calls.map((d) => d.strike))].sort((a, b) => a - b);
    const dtes = [...new Set(calls.map((d) => d.dte))].sort((a, b) => a - b);
    const lk = {};
    calls.forEach((d) => { lk[`${d.strike}-${d.dte}`] = d.iv; });
    const z = dtes.map((dte) => strikes.map((k) => lk[`${k}-${dte}`] ?? null));
    window.Plotly.newPlot(ref.current, [{
      type: 'surface', x: strikes, y: dtes, z,
      colorscale: [[0, '#050520'], [0.1, '#0a0a4a'], [0.25, '#1a3388'], [0.4, '#2255bb'], [0.55, '#3388dd'], [0.7, '#55aaee'], [0.85, '#88ccff'], [1, '#cceeFF']],
      contours: {
        z: { show: true, usecolormap: true, highlightcolor: '#00d4ff', project: { z: true } },
        x: { show: true, color: 'rgba(0,212,255,0.08)', width: 1 },
        y: { show: true, color: 'rgba(0,212,255,0.08)', width: 1 },
      },
      hovertemplate: 'Strike: $%{x:.0f}<br>DTE: %{y}d<br>IV: %{z:.1f}%<extra></extra>',
      lighting: { ambient: 0.55, diffuse: 0.65, specular: 0.2, roughness: 0.9, fresnel: 0.3 },
      opacity: 0.95,
    }], {
      scene: {
        xaxis: { title: { text: 'Strike ($)', font: { size: 10 } }, color: '#555568', gridcolor: '#282835', showspikes: false },
        yaxis: { title: { text: 'Days to Expiry', font: { size: 10 } }, color: '#555568', gridcolor: '#282835', showspikes: false },
        zaxis: { title: { text: 'IV (%)', font: { size: 10 } }, color: '#555568', gridcolor: '#282835', showspikes: false },
        bgcolor: '#111117', camera: { eye: { x: 1.6, y: -1.9, z: 0.65 } },
        aspectratio: { x: 1.2, y: 1, z: 0.6 },
      },
      paper_bgcolor: '#111117', plot_bgcolor: '#111117',
      font: { color: '#555568', family: 'Geist Mono', size: 9 },
      margin: { l: 0, r: 0, t: 36, b: 0 },
      title: { text: `${symbol} Implied Volatility Surface (Calls)`, font: { size: 12, color: '#a0a0b4' } },
    }, { responsive: true, displayModeBar: false });
  }, [opts, symbol, plotlyReady]);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!opts) return <div className="loading"><div className="spinner" />Computing IV surface…</div>;
  const calls = opts.surface?.filter((d) => d.type === 'call') || [];
  if (calls.length < 5) return <div className="loading">No IV surface data for {symbol}</div>;

  return (
    <>
      <div ref={ref} className="ivbox" />
      <div className="ivleg"><b>X:</b> Strike. <b>Y:</b> DTE. <b>Z:</b> IV (%) — market&apos;s expected annualized move.</div>
    </>
  );
}
