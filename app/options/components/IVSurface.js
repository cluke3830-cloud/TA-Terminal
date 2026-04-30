'use client';
import { useEffect, useRef } from 'react';

export default function IVSurface({ sym, opts, plotlyReady }) {
  const ref = useRef(null);
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
      title: { text: `${sym} Implied Volatility Surface (Calls)`, font: { size: 12, color: '#a0a0b4' } },
    }, { responsive: true, displayModeBar: false });
  }, [opts, sym, plotlyReady]);

  return <div ref={ref} className="ivbox" />;
}