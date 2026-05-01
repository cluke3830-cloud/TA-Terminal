'use client';

import { useEffect, useRef, useState } from 'react';

const CHART_FONT = { color: '#7a7a90', family: 'Geist Mono', size: 10 };

const GEO_LAYOUT = {
  geo: {
    showframe: false,
    showcoastlines: true, coastlinecolor: '#3a3a4d',
    showland: true, landcolor: '#111117',
    showocean: true, oceancolor: '#050508',
    showcountries: true, countrycolor: '#1e1e28',
    showlakes: false,
    bgcolor: '#050508',
    projection: { type: 'natural earth' },
  },
  paper_bgcolor: '#050508',
  plot_bgcolor: '#050508',
  margin: { l: 0, r: 0, t: 0, b: 0 },
  font: CHART_FONT,
};

export default function MacroFlightsWidget() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
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
    const load = () => {
      fetch('/data_pages/macro/flights')
        .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
        .then((j) => { if (!cancelled) setData(j); })
        .catch((e) => { if (!cancelled) setErr(String(e)); });
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!plotlyReady || !ref.current || !data?.aircraft) return;
    const trace = {
      type: 'scattergeo', mode: 'markers',
      lon: data.aircraft.map((a) => a.lon),
      lat: data.aircraft.map((a) => a.lat),
      marker: {
        size: 2,
        color: data.aircraft.map((a) => a.alt),
        colorscale: [[0, '#3377ff'], [0.5, '#00d4ff'], [1, '#00f59b']],
        opacity: 0.55, line: { width: 0 },
        colorbar: { title: { text: 'Alt (m)', font: CHART_FONT }, tickfont: CHART_FONT, len: 0.6, thickness: 10, x: 0.99, bgcolor: 'rgba(0,0,0,0)' },
      },
      text: data.aircraft.map((a) => `${a.callsign || 'N/A'}<br>${a.country}<br>Alt: ${a.alt}m · ${a.vel || 0}m/s`),
      hovertemplate: '%{text}<extra></extra>',
    };
    window.Plotly.react(ref.current, [trace], GEO_LAYOUT, { displayModeBar: false, responsive: true });
  }, [plotlyReady, data]);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!data) return <div className="loading"><div className="spinner" />Loading flight tracker…</div>;

  return (
    <>
      <div ref={ref} style={{ width: '100%', height: 360, background: '#050508' }} />
      <div className="wmap-stats" style={{ borderTop: '1px solid var(--border)' }}>
        <span>LIVE AIRCRAFT: <b>{(data.count || 0).toLocaleString()}</b></span>
        <span>GLOBAL TOTAL: <b>{data.total != null ? data.total.toLocaleString() : '—'}</b></span>
        <span>SOURCE: <b>OPENSKY · 60s REFRESH</b></span>
        {data.error && <span style={{ color: 'var(--neon-red)' }}>⚠ {data.error}</span>}
      </div>
    </>
  );
}