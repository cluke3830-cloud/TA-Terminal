'use client';
import { useEffect, useRef } from 'react';

export default function IVRVGap({ sym, opts, plotlyReady }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!opts?.surface?.length || !opts?.rv || !ref.current || !plotlyReady) return;
    const calls = opts.surface.filter((d) => d.type === 'call');
    if (calls.length < 5) return;
    const rv = opts.rv;
    const strikes = [...new Set(calls.map((d) => d.strike))].sort((a, b) => a - b);
    const dtes = [...new Set(calls.map((d) => d.dte))].sort((a, b) => a - b);
    const lk = {};
    calls.forEach((d) => { lk[`${d.strike}-${d.dte}`] = d.iv; });
    const z = dtes.map((dte) => strikes.map((k) => {
      const iv = lk[`${k}-${dte}`];
      return iv != null ? +(iv - rv).toFixed(2) : null;
    }));
    window.Plotly.newPlot(ref.current, [{
      type: 'surface', x: strikes, y: dtes, z, zmid: 0,
      colorscale: [[0, '#cc1133'], [0.2, '#993355'], [0.4, '#553355'], [0.5, '#1a1a25'], [0.6, '#334477'], [0.8, '#2288aa'], [1, '#00eebb']],
      contours: {
        z: { show: true, usecolormap: true, highlightcolor: '#ffffff', project: { z: true } },
        x: { show: true, color: 'rgba(255,255,255,0.04)', width: 1 },
        y: { show: true, color: 'rgba(255,255,255,0.04)', width: 1 },
      },
      hovertemplate: 'Strike: $%{x:.0f}<br>DTE: %{y}d<br>IV−RV: %{z:+.1f}%<extra></extra>',
      lighting: { ambient: 0.55, diffuse: 0.65, specular: 0.2, roughness: 0.9, fresnel: 0.3 },
      opacity: 0.95,
    }], {
      scene: {
        xaxis: { title: { text: 'Strike ($)', font: { size: 10 } }, color: '#555568', gridcolor: '#282835', showspikes: false },
        yaxis: { title: { text: 'Days to Expiry', font: { size: 10 } }, color: '#555568', gridcolor: '#282835', showspikes: false },
        zaxis: { title: { text: 'IV − RV (%)', font: { size: 10 } }, color: '#555568', gridcolor: '#282835', showspikes: false },
        bgcolor: '#111117', camera: { eye: { x: 1.6, y: -1.9, z: 0.65 } },
        aspectratio: { x: 1.2, y: 1, z: 0.6 },
      },
      paper_bgcolor: '#111117', plot_bgcolor: '#111117',
      font: { color: '#555568', family: 'Geist Mono', size: 9 },
      margin: { l: 0, r: 0, t: 36, b: 0 },
      title: { text: `${sym} IV−RV Gap | RV(90d) = ${rv.toFixed(1)}%`, font: { size: 12, color: '#a0a0b4' } },
    }, { responsive: true, displayModeBar: false });
  }, [opts, sym, plotlyReady]);

  return <div ref={ref} className="ivbox" />;
}