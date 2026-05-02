'use client';

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { fmt, fmtPct, fmtDate, fmtTime, Load, Err } from '../components/ui';
import SentimentHeatmap from './components/SentimentHeatmap';

const FOCUS_TO_ID = {
  yields: 'sec-yields',
  comm: 'sec-comm',
  fx: 'sec-fx',
  banks: 'sec-banks',
  cal: 'sec-cal',
};

// ═══════════════════════════════════════════════════════════════════════════════
//  QUANTUM TERMINAL — MACRO ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

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
  font: { color: '#7a7a90', family: 'Geist Mono', size: 10 },
};

const CHART_FONT = { color: '#7a7a90', family: 'Geist Mono', size: 10 };

function FearGreedGauge({ score, label, color }) {
  // Semicircular gauge from -90° to +90° (left → right). Score 0 → -90°, 100 → +90°.
  const angle = -90 + (score / 100) * 180;
  const cx = 200, cy = 180, r = 140;
  const arcPath = (a0, a1) => {
    const rad = (a) => ((a - 90) * Math.PI) / 180;
    const x0 = cx + r * Math.cos(rad(a0));
    const y0 = cy + r * Math.sin(rad(a0));
    const x1 = cx + r * Math.cos(rad(a1));
    const y1 = cy + r * Math.sin(rad(a1));
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  };
  const zones = [
    { from: 0, to: 36, color: '#ff3355' },
    { from: 36, to: 72, color: '#ff8833' },
    { from: 72, to: 108, color: '#ffc700' },
    { from: 108, to: 144, color: '#00d4ff' },
    { from: 144, to: 180, color: '#00f59b' },
  ];
  return (
    <svg viewBox="0 0 400 230" xmlns="http://www.w3.org/2000/svg">
      {zones.map((z, i) => (
        <path key={i} d={arcPath(z.from, z.to)} fill="none" stroke={z.color} strokeWidth={20} strokeLinecap="butt" opacity="0.9" />
      ))}
      {/* Tick marks */}
      {[0, 25, 50, 75, 100].map((v) => {
        const a = -90 + (v / 100) * 180;
        const rad = ((a - 90) * Math.PI) / 180;
        const x1 = cx + (r - 28) * Math.cos(rad);
        const y1 = cy + (r - 28) * Math.sin(rad);
        const x2 = cx + (r - 14) * Math.cos(rad);
        const y2 = cy + (r - 14) * Math.sin(rad);
        const tx = cx + (r - 44) * Math.cos(rad);
        const ty = cy + (r - 44) * Math.sin(rad);
        return (
          <g key={v}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#3a3a4d" strokeWidth={1} />
            <text x={tx} y={ty + 3} fontFamily="Geist Mono" fontSize="9" fill="#7a7a90" textAnchor="middle">{v}</text>
          </g>
        );
      })}
      {/* Needle */}
      <g transform={`rotate(${angle} ${cx} ${cy})`}>
        <line x1={cx} y1={cy} x2={cx} y2={cy - r + 32} stroke={color} strokeWidth={3} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={9} fill={color} />
        <circle cx={cx} cy={cy} r={4} fill="#050508" />
      </g>
      {/* Score text */}
      <text x={cx} y={cy + 35} fontFamily="Geist Mono" fontSize="42" fontWeight="700" fill={color} textAnchor="middle">{Math.round(score)}</text>
      <text x={cx} y={cy + 60} fontFamily="Geist Mono" fontSize="12" fontWeight="600" fill="#cccce0" textAnchor="middle" letterSpacing="3">{label}</text>
    </svg>
  );
}

function FXMatrix({ fx, tf, onTfChange }) {
  if (!fx || !fx.matrices) return <div className="loading"><div className="spinner" />FX matrix loading…</div>;
  const matrix = fx.matrices[tf] || fx.matrices['24h'];
  const cur = fx.currencies;
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
    <>
      <div className="fx-dxy">
        <div>
          <div className="fx-dxy-l">DXY · USD Index (ICE)</div>
          <div className="fx-dxy-v">{fx.dxy != null ? fx.dxy.toFixed(2) : '—'}</div>
        </div>
        <div className="fx-tf">
          {['24h', '1w', '1m'].map((t) => (
            <button key={t} className={`mt ${tf === t ? 'a' : ''}`} onClick={() => onTfChange(t)}>{t.toUpperCase()}</button>
          ))}
        </div>
        <div className={`fx-dxy-c ${fx.dxyChange24h >= 0 ? 'comm-chg up' : 'comm-chg dn'}`}>
          {fx.dxyChange24h != null ? fmtPct(fx.dxyChange24h) : '—'} 24h
        </div>
      </div>
      <div className="fx-matrix" style={{ gridTemplateColumns: `60px repeat(${cur.length}, 1fr)` }}>
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
      <div style={{ marginTop: 10, fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--ash)', letterSpacing: 0.5 }}>
        ROW = base currency · COL = quote · % = {tfLabel} relative strength of row vs col
      </div>
    </>
  );
}

function CommodityCard({ c, plotlyReady, onExpand }) {
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
    <button type="button" className="comm-card" onClick={() => onExpand && onExpand(c)} aria-label={`Expand ${c.name} chart`}>
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
    </button>
  );
}

function CommodityModal({ commodity, plotlyReady, onClose }) {
  const ref = useRef(null);
  const [tf, setTf] = useState('1y');
  const [hist, setHist] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!commodity) return;
    setLoading(true); setError(null);
    fetch(`/data_pages/macro/commodity-history?symbol=${commodity.symbol}&tf=${tf}`)
      .then((r) => r.json())
      .then((j) => { if (j.error) throw new Error(j.error); setHist(j); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [commodity, tf]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!plotlyReady || !ref.current || !hist?.prices?.length) return;
    const prices = hist.prices;
    const dates = hist.dates;
    const isUp = prices[prices.length - 1] >= prices[0];
    const color = isUp ? '#00f59b' : '#ff3355';
    window.Plotly.newPlot(ref.current, [{
      type: 'scatter', mode: 'lines', x: dates, y: prices,
      line: { color, width: 2, shape: 'spline' }, fill: 'tozeroy',
      fillcolor: isUp ? 'rgba(0,245,155,0.08)' : 'rgba(255,51,85,0.08)',
      hovertemplate: '%{x}<br>$%{y:.2f}<extra></extra>',
    }], {
      paper_bgcolor: '#0b0b10', plot_bgcolor: '#0b0b10',
      xaxis: { color: '#7a7a90', gridcolor: '#1e1e28', linecolor: '#3a3a4d', tickfont: CHART_FONT },
      yaxis: { color: '#7a7a90', gridcolor: '#1e1e28', linecolor: '#3a3a4d', tickfont: CHART_FONT },
      margin: { l: 60, r: 20, t: 14, b: 40 }, showlegend: false,
      hovermode: 'x unified', font: CHART_FONT,
    }, { displayModeBar: false, responsive: true });
  }, [plotlyReady, hist]);

  if (!commodity) return null;
  const ytdColor = commodity.ytdPct == null ? 'var(--smoke)' : commodity.ytdPct >= 0 ? '#00f59b' : '#ff3355';

  return (
    <div className="comm-modal-bd" onClick={onClose}>
      <div className="comm-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="comm-modal-h">
          <div>
            <div className="comm-modal-title">{commodity.name}</div>
            <div className="comm-modal-sub">
              {commodity.symbol} · {commodity.unit} ·
              <span style={{ color: '#cccce0', marginLeft: 6 }}>${commodity.price != null ? fmt(commodity.price, 2) : '—'}</span>
              <span className={`comm-chg ${commodity.changePct >= 0 ? 'up' : 'dn'}`} style={{ marginLeft: 8 }}>
                {commodity.changePct != null ? fmtPct(commodity.changePct) : '—'} 24h
              </span>
              <span style={{ marginLeft: 12, color: 'var(--smoke)' }}>YTD <b style={{ color: ytdColor }}>{commodity.ytdPct != null ? fmtPct(commodity.ytdPct) : '—'}</b></span>
            </div>
          </div>
          <button className="comm-modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="comm-modal-tf">
          {['1m', '3m', '6m', '1y', '5y'].map((t) => (
            <button key={t} className={`mt ${tf === t ? 'a' : ''}`} onClick={() => setTf(t)}>{t.toUpperCase()}</button>
          ))}
        </div>
        <div className="comm-modal-chart" ref={ref}>
          {loading && <Load t={`Loading ${tf.toUpperCase()} history…`} />}
          {error && <Err m={error} />}
        </div>
      </div>
    </div>
  );
}

export default function MacroDashboard() {
  return (
    <Suspense fallback={<div className="loading"><div className="spinner" />Loading macro…</div>}>
      <MacroDashboardInner />
    </Suspense>
  );
}

function MacroDashboardInner() {
  const searchParams = useSearchParams();

  const [yields, setYields] = useState(null);
  const [banks, setBanks] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [commodities, setCommodities] = useState(null);
  const [fx, setFx] = useState(null);
  const [flows, setFlows] = useState(null);
  const [feargreed, setFeargreed] = useState(null);
  const [geoData, setGeoData] = useState(null);
  const [oilData, setOilData] = useState(null);

  const [mapTab, setMapTab] = useState('geo');
  const [yieldTab, setYieldTab] = useState('current');
  const [calTab, setCalTab] = useState('upcoming');
  const [calFilter, setCalFilter] = useState({ impact: 'ALL', currency: 'ALL' });
  const [fxTf, setFxTf] = useState('24h');
  const [expandedComm, setExpandedComm] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [plotlyReady, setPlotlyReady] = useState(false);
  const [clock, setClock] = useState('');
  const [ld, setLd] = useState({});
  const [er, setEr] = useState({});

  const mapRef = useRef(null);
  const ycRef = useRef(null);
  const flowMapRef = useRef(null);
  const flowSankeyRef = useRef(null);

  // Plotly readiness
  useEffect(() => {
    const t = setInterval(() => {
      if (typeof window !== 'undefined' && window.Plotly) { setPlotlyReady(true); clearInterval(t); }
    }, 100);
    return () => clearInterval(t);
  }, []);

  // Live clock + countdown ticker
  useEffect(() => {
    setClock(fmtTime());
    const t = setInterval(() => { setClock(fmtTime()); setNow(Date.now()); }, 1000);
    return () => clearInterval(t);
  }, []);

  const nextHighImpact = useMemo(() => {
    if (!calendar?.upcoming) return null;
    return calendar.upcoming.find((e) => e.impact === 'High') || null;
  }, [calendar]);

  const filteredEvents = useMemo(() => {
    if (!calendar) return [];
    const src = calTab === 'upcoming' ? calendar.upcoming : calendar.recent;
    return (src || []).filter((e) => {
      if (calFilter.impact !== 'ALL' && e.impact !== calFilter.impact) return false;
      if (calFilter.currency !== 'ALL' && e.currency !== calFilter.currency) return false;
      return true;
    });
  }, [calendar, calTab, calFilter]);

  const groupedEvents = useMemo(() => {
    if (!filteredEvents.length) return [];
    const groups = {};
    for (const e of filteredEvents) {
      const day = (e.date || '').slice(0, 10);
      if (!groups[day]) groups[day] = [];
      groups[day].push(e);
    }
    const todayKey = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    const yestKey = yest.toISOString().slice(0, 10);
    return Object.entries(groups)
      .sort(([a], [b]) => calTab === 'upcoming' ? a.localeCompare(b) : b.localeCompare(a))
      .map(([day, events]) => {
        const d = new Date(day + 'T00:00:00');
        const wd = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
        let label;
        if (day === todayKey) label = `TODAY · ${wd}`;
        else if (day === tomorrowKey) label = `TOMORROW · ${wd}`;
        else if (day === yestKey) label = `YESTERDAY · ${wd}`;
        else label = wd;
        return { day, label, events };
      });
  }, [filteredEvents, calTab]);

  const fetchS = useCallback(async (k, url, set) => {
    setLd((s) => ({ ...s, [k]: true })); setEr((s) => ({ ...s, [k]: null }));
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      set(j);
    } catch (e) {
      setEr((s) => ({ ...s, [k]: e.message }));
    } finally {
      setLd((s) => ({ ...s, [k]: false }));
    }
  }, []);

  // Initial fetches
  useEffect(() => {
    fetchS('yields', '/data_pages/macro/yields', setYields);
    fetchS('banks', '/data_pages/macro/centralbanks', setBanks);
    fetchS('calendar', '/data_pages/macro/calendar', setCalendar);
    fetchS('commodities', '/data_pages/macro/commodities', setCommodities);
    fetchS('fx', '/data_pages/macro/fx', setFx);
    fetchS('flows', '/data_pages/macro/flows', setFlows);
    fetchS('geo', '/data_pages/macro/geopolitical?view=risk', (d) => setGeoData(d.data));
    fetchS('oil', '/data_pages/macro/geopolitical?view=oil', (d) => setOilData(d.data));
    // FearGreed last (depends on others, server-side aggregator)
    setTimeout(() => fetchS('fg', '/data_pages/macro/feargreed', setFeargreed), 1500);
  }, [fetchS]);

  // Auto-refresh. Commodities are Yahoo-first now (no rate cap), so we can poll
  // at 30s to match the server cache TTL and feel live.
  useEffect(() => {
    const f = setInterval(() => fetchS('fx', '/data_pages/macro/fx', setFx), 30 * 60_000);
    const c = setInterval(() => fetchS('commodities', '/data_pages/macro/commodities', setCommodities), 30_000);
    return () => { clearInterval(f); clearInterval(c); };
  }, [fetchS]);

  // ?focus=<panel> from the command palette: switch the world-map tab if
  // needed, then scroll to the matching section once the page has settled.
  useEffect(() => {
    const focus = searchParams.get('focus');
    if (!focus || !FOCUS_TO_ID[focus]) return;
    const el = document.getElementById(FOCUS_TO_ID[focus]);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
  }, [searchParams]);

  // World Map render
  useEffect(() => {
    if (!plotlyReady || !mapRef.current) return;
    let trace, colorbar;
    if (mapTab === 'geo' && geoData) {
      trace = {
        type: 'choropleth', locationmode: 'ISO-3',
        locations: geoData.map((d) => d.iso3),
        z: geoData.map((d) => d.score),
        text: geoData.map((d) => `${d.country}<br>Risk: ${d.score}/10<br>${(d.factors || []).join(', ')}`),
        hovertemplate: '%{text}<extra></extra>',
        colorscale: [
          [0, '#0a1530'], [0.25, '#1a2a5e'], [0.5, '#aa3300'],
          [0.75, '#ff5522'], [1, '#ff0033'],
        ],
        zmin: 0, zmax: 10,
        marker: { line: { color: '#1e1e28', width: 0.4 } },
        colorbar: { title: { text: 'Risk', font: CHART_FONT }, tickfont: CHART_FONT, len: 0.6, thickness: 10, x: 0.99, bgcolor: 'rgba(0,0,0,0)' },
      };
    } else if (mapTab === 'oil' && oilData) {
      trace = {
        type: 'choropleth', locationmode: 'ISO-3',
        locations: oilData.map((d) => d.iso3),
        z: oilData.map((d) => d.reserves),
        text: oilData.map((d) => `${d.country}<br>Reserves: ${d.reserves} Bbbl`),
        hovertemplate: '%{text}<extra></extra>',
        colorscale: [
          [0, '#001515'], [0.2, '#003a3a'], [0.5, '#00d4ff'],
          [0.8, '#00f59b'], [1, '#ffff00'],
        ],
        zmin: 0, zmax: 310,
        marker: { line: { color: '#1e1e28', width: 0.4 } },
        colorbar: { title: { text: 'Bbbl', font: CHART_FONT }, tickfont: CHART_FONT, len: 0.6, thickness: 10, x: 0.99, bgcolor: 'rgba(0,0,0,0)' },
      };
    } else {
      return;
    }
    window.Plotly.react(mapRef.current, [trace], GEO_LAYOUT, { displayModeBar: false, responsive: true });
  }, [plotlyReady, mapTab, geoData, oilData]);

  // Yield curve render
  useEffect(() => {
    if (!plotlyReady || !ycRef.current || !yields?.current) return;
    const labels = yields.current.map((p) => p.label);
    const cur = yields.current.map((p) => p.yield);
    const traces = [{
      type: 'scatter', mode: 'lines+markers', x: labels, y: cur,
      line: { color: '#00d4ff', width: 2.5, shape: 'spline' },
      marker: { size: 6, color: '#00d4ff', line: { width: 1, color: '#050508' } },
      name: 'Current', fill: 'tozeroy', fillcolor: 'rgba(0,212,255,0.05)',
      hovertemplate: '%{x}: %{y:.2f}%<extra></extra>',
    }];
    if (yieldTab !== 'current' && yields.historical?.[yieldTab]) {
      const h = yields.historical[yieldTab];
      traces.push({
        type: 'scatter', mode: 'lines', x: labels,
        y: labels.map((l) => h.find((p) => p.label === l)?.yield ?? null),
        line: { color: '#9955ff', width: 1.5, dash: 'dot', shape: 'spline' },
        name: yieldTab.toUpperCase() + ' Ago', hovertemplate: '%{x}: %{y:.2f}%<extra></extra>',
      });
    }
    window.Plotly.newPlot(ycRef.current, traces, {
      paper_bgcolor: '#0b0b10', plot_bgcolor: '#0b0b10',
      xaxis: { color: '#7a7a90', gridcolor: '#1e1e28', linecolor: '#3a3a4d', tickfont: CHART_FONT, title: { text: 'MATURITY', font: { ...CHART_FONT, size: 9 }, standoff: 10 } },
      yaxis: { color: '#7a7a90', gridcolor: '#1e1e28', linecolor: '#3a3a4d', tickfont: CHART_FONT, ticksuffix: '%', title: { text: 'YIELD', font: { ...CHART_FONT, size: 9 }, standoff: 10 } },
      margin: { l: 50, r: 20, t: 14, b: 40 },
      legend: { orientation: 'h', x: 0, y: 1.12, font: CHART_FONT },
      hovermode: 'x unified', font: CHART_FONT,
      shapes: yields.inversion ? [{ type: 'rect', xref: 'x', yref: 'paper', x0: '2Y', x1: '10Y', y0: 0, y1: 1, fillcolor: 'rgba(255,51,85,0.06)', line: { width: 0 } }] : [],
    }, { displayModeBar: false, responsive: true });
  }, [plotlyReady, yields, yieldTab]);

  // Flow choropleth
  useEffect(() => {
    if (!plotlyReady || !flowMapRef.current || !flows?.reserveHolders) return;
    const top = flows.reserveHolders.slice(0, 50);
    window.Plotly.newPlot(flowMapRef.current, [{
      type: 'choropleth', locationmode: 'ISO-3',
      locations: top.map((d) => d.iso3),
      z: top.map((d) => d.reserves),
      text: top.map((d) => `${d.country}<br>Reserves: $${d.reserves} Bn`),
      hovertemplate: '%{text}<extra></extra>',
      colorscale: [[0, '#0a0a18'], [0.3, '#1a3a6a'], [0.6, '#3377ff'], [1, '#00d4ff']],
      marker: { line: { color: '#1e1e28', width: 0.4 } },
      colorbar: { title: { text: 'USD Bn', font: CHART_FONT }, tickfont: CHART_FONT, len: 0.6, thickness: 10, x: 0.99, bgcolor: 'rgba(0,0,0,0)' },
    }], GEO_LAYOUT, { displayModeBar: false, responsive: true });
  }, [plotlyReady, flows]);

  // Sankey/pie for reserve composition
  useEffect(() => {
    if (!plotlyReady || !flowSankeyRef.current || !flows?.reserveComposition) return;
    const comp = flows.reserveComposition;
    window.Plotly.newPlot(flowSankeyRef.current, [{
      type: 'pie', hole: 0.55,
      labels: comp.map((c) => c.currency),
      values: comp.map((c) => c.share),
      marker: { colors: comp.map((c) => c.color), line: { color: '#050508', width: 2 } },
      textinfo: 'label+percent', textfont: { ...CHART_FONT, size: 11, color: '#eeeef4' },
      hovertemplate: '%{label}: %{value}%<extra></extra>',
    }], {
      paper_bgcolor: '#111117', plot_bgcolor: '#111117',
      margin: { l: 10, r: 10, t: 30, b: 10 },
      showlegend: false, font: CHART_FONT,
      annotations: [{ text: 'GLOBAL FX<br>RESERVES', x: 0.5, y: 0.5, font: { ...CHART_FONT, size: 11, color: '#cccce0' }, showarrow: false }],
    }, { displayModeBar: false, responsive: true });
  }, [plotlyReady, flows]);

  return (
    <>
      <header className="topbar">
        <div className="topbar-l">
          <span className="brand">Quantum Macro<span className="brand-dot" /></span>
          <span className="topbar-date">{fmtDate()} · {clock}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--smoke)' }}>
          <span className="ld" /><span className="ll">LIVE FEED</span>
        </div>
      </header>

      <div className="warn">⚠ Free-tier macro feeds · Cached 5–60min · For research only · Not investment advice</div>

      <main className="macro-dash">
        <div className="macro-hero fi">
          <div>
            <h1 className="macro-title">Global <span>Macro Intelligence</span></h1>
            <div className="macro-sub">Real-time signals · Central banks · Yield curves · FX · Commodities · Geopolitics</div>
          </div>
          <div className="macro-strip">
            <div className="macro-strip-i">
              <div className="macro-strip-l">Fed Funds</div>
              <div className="macro-strip-v">{yields?.fedFundsRate != null ? yields.fedFundsRate.toFixed(2) + '%' : '—'}</div>
            </div>
            <div className="macro-strip-i">
              <div className="macro-strip-l">10Y-2Y</div>
              <div className="macro-strip-v" style={{ color: yields?.spread_10_2 < 0 ? '#ff3355' : '#00f59b' }}>
                {yields?.spread_10_2 != null ? (yields.spread_10_2 > 0 ? '+' : '') + yields.spread_10_2.toFixed(2) : '—'}
              </div>
            </div>
            <div className="macro-strip-i">
              <div className="macro-strip-l">DXY</div>
              <div className="macro-strip-v">{fx?.dxy != null ? fx.dxy.toFixed(2) : '—'}</div>
            </div>
            <div className="macro-strip-i">
              <div className="macro-strip-l">WTI</div>
              <div className="macro-strip-v">${commodities?.commodities?.find((c) => c.name === 'WTI Crude')?.price?.toFixed(2) ?? '—'}</div>
            </div>
            <div className="macro-strip-i">
              <div className="macro-strip-l">Gold</div>
              <div className="macro-strip-v">${commodities?.commodities?.find((c) => c.name === 'Gold')?.price?.toFixed(0) ?? '—'}</div>
            </div>
          </div>
        </div>

        {/* ──────────── 0. FEAR & GREED ──────────── */}
        <section className="msec fi">
          <div className="msec-h">
            <div className="msec-t"><span className="msec-t-num">00</span>Fear vs Greed · Macro Composite</div>
            {feargreed && <span className="badge b-c">Score {feargreed.score}</span>}
          </div>
          <div className="msec-b">
            {ld.fg && !feargreed && <Load t="Computing macro composite…" />}
            {er.fg && <Err m={er.fg} />}
            {feargreed && (
              <div className="fg-wrap">
                <div className="fg-gauge">
                  <FearGreedGauge score={feargreed.score} label={feargreed.label} color={feargreed.color} />
                </div>
                <div className="fg-cmp">
                  {feargreed.components.map((c) => {
                    const barColor = c.score < 40 ? '#ff3355' : c.score > 60 ? '#00f59b' : '#ffc700';
                    return (
                      <div key={c.name} className="fg-row">
                        <div>
                          <div className="fg-row-n">{c.name}</div>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--smoke)', marginTop: 2 }}>{c.desc}</div>
                        </div>
                        <div className="fg-row-bar"><div className="fg-row-bar-f" style={{ width: c.score + '%', background: barColor }} /></div>
                        <div className="fg-row-s" style={{ color: barColor }}>{c.score.toFixed(0)}</div>
                        <div className="fg-row-w">W: {(c.weight * 100).toFixed(0)}%</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ──────────── 1. WORLD MAP ──────────── */}
        <section id="sec-worldmap" className="msec fi">
          <div className="msec-h">
            <div className="msec-t"><span className="msec-t-num">01</span>World Map · Geopolitics & Satellite</div>
            <div className="wmap-tabs">
              <button className={`mt ${mapTab === 'geo' ? 'a' : ''}`} onClick={() => setMapTab('geo')}>Geopolitical Risk</button>
              <button className={`mt ${mapTab === 'oil' ? 'a' : ''}`} onClick={() => setMapTab('oil')} style={{ marginLeft: 6 }}>Oil Reserves</button>
            </div>
          </div>
          <div className="wmap-box" ref={mapRef} />
          <div className="wmap-stats">
            {mapTab === 'geo' && geoData && (
              <>
                <span>HIGH RISK COUNTRIES (≥7): <b>{geoData.filter((d) => d.score >= 7).length}</b></span>
                <span>ACTIVE CONFLICTS: <b>{geoData.filter((d) => d.factors.some((f) => /war|conflict/i.test(f))).length}</b></span>
                <span>UPDATED: <b>QUARTERLY</b></span>
              </>
            )}
            {mapTab === 'oil' && oilData && (
              <>
                <span>TOP HOLDER: <b>{oilData[0].country} · {oilData[0].reserves} Bbbl</b></span>
                <span>OPEC SHARE: <b>~80%</b></span>
                <span>SOURCE: <b>BP STATISTICAL REVIEW</b></span>
              </>
            )}
          </div>
        </section>

        {/* ──────────── 2-3. CENTRAL BANKS + CALENDAR ──────────── */}
        <div className="macro-g3">
          <section id="sec-banks" className="msec fi">
            <div className="msec-h"><div className="msec-t"><span className="msec-t-num">02</span>Central Bank Monitor · The Engine Room</div></div>
            <div className="msec-b">
              {ld.banks && !banks && <Load />}
              {er.banks && <Err m={er.banks} />}
              {banks?.banks && (
                <div className="cb-grid">
                  {banks.banks.map((b) => (
                    <div key={b.abbr} className="cb-card">
                      <div className="cb-row">
                        <span className="cb-name">{b.flag} {b.abbr} · {b.currency}</span>
                        <span className={`cb-trend ${b.trend}`}>{b.trend}</span>
                      </div>
                      <div className="cb-rate">{b.rate.toFixed(2)}<span style={{ fontSize: 14, color: 'var(--smoke)', marginLeft: 4 }}>%</span></div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--ash)' }}>{b.name}</div>
                      <div className="cb-meet">
                        <span>NEXT MEETING</span>
                        <b>{b.nextMeeting || 'TBD'}</b>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section id="sec-cal" className="msec fi">
            <div className="msec-h">
              <div className="msec-t"><span className="msec-t-num">03</span>Economic Calendar · Surprise Index</div>
              <div className="wmap-tabs">
                <button className={`mt ${calTab === 'upcoming' ? 'a' : ''}`} onClick={() => setCalTab('upcoming')}>Upcoming</button>
                <button className={`mt ${calTab === 'recent' ? 'a' : ''}`} onClick={() => setCalTab('recent')} style={{ marginLeft: 6 }}>Recent Surprises</button>
              </div>
            </div>
            <div className="msec-b">
              {ld.calendar && !calendar && <Load />}
              {er.calendar && <Err m={er.calendar} />}
              {calendar && (
                <>
                  {nextHighImpact && (() => {
                    const ms = new Date(nextHighImpact.date).getTime() - now;
                    const past = ms < 0;
                    const abs = Math.abs(ms);
                    const d = Math.floor(abs / 86400000);
                    const h = Math.floor((abs % 86400000) / 3600000);
                    const m = Math.floor((abs % 3600000) / 60000);
                    const s = Math.floor((abs % 60000) / 1000);
                    return (
                      <div className="ec-next">
                        <div className="ec-next-l">{past ? 'JUST RELEASED' : 'NEXT HIGH-IMPACT'}</div>
                        <div className="ec-next-event">{nextHighImpact.flag} {nextHighImpact.event}</div>
                        <div className="ec-next-cd">{d > 0 ? `${d}D ` : ''}{String(h).padStart(2, '0')}H {String(m).padStart(2, '0')}M {String(s).padStart(2, '0')}S</div>
                      </div>
                    );
                  })()}
                  <div className="ec-summary">
                    <div>
                      <div className="ec-summary-l">USD Surprise Index (Citi-style proxy)</div>
                      <div className="ec-summary-v" style={{ color: calendar.citiProxy >= 0 ? '#00f59b' : '#ff3355' }}>
                        {calendar.citiProxy >= 0 ? '+' : ''}{calendar.citiProxy}
                      </div>
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--smoke)', textAlign: 'right' }}>
                      <div>BEAT: <span style={{ color: '#00f59b' }}>{calendar.counts.beat}</span></div>
                      <div>MISS: <span style={{ color: '#ff3355' }}>{calendar.counts.miss}</span></div>
                      <div>INLINE: <span style={{ color: 'var(--fog)' }}>{calendar.counts.inline}</span></div>
                    </div>
                  </div>
                  <div className="ec-filters">
                    <div className="ec-filter-row">
                      <span className="ec-filter-l">IMPACT</span>
                      {['ALL', 'High', 'Medium'].map((i) => (
                        <button key={i} className={`mt ${calFilter.impact === i ? 'a' : ''}`} onClick={() => setCalFilter((f) => ({ ...f, impact: i }))}>{i}</button>
                      ))}
                    </div>
                    <div className="ec-filter-row">
                      <span className="ec-filter-l">CCY</span>
                      {['ALL', 'USD', 'EUR', 'JPY', 'GBP', 'CNY', 'CAD', 'AUD', 'CHF'].map((c) => (
                        <button key={c} className={`mt ${calFilter.currency === c ? 'a' : ''}`} onClick={() => setCalFilter((f) => ({ ...f, currency: c }))}>{c}</button>
                      ))}
                    </div>
                  </div>
                  <div className="ec-list">
                    {groupedEvents.length === 0 && <div className="loading" style={{ padding: 16 }}>No events match these filters.</div>}
                    {groupedEvents.map(({ day, label, events }) => (
                      <div key={day}>
                        <div className="ec-day-h">
                          <span>{label}</span>
                          <span>{events.length} EVENT{events.length !== 1 ? 'S' : ''}</span>
                        </div>
                        {events.map((e, i) => (
                          <div key={`${day}-${i}`} className="ec-row">
                            <span className="ec-date">{(e.date || '').slice(11, 16) || '—'}</span>
                            <div>
                              <div className="ec-event">{e.flag} {e.event}</div>
                              <div className="ec-event-c">{e.currency} · {e.impact}</div>
                            </div>
                            <div className="ec-vals">
                              <span>EST {e.estimate ?? '—'}</span>
                              {e.actual != null ? <span style={{ color: '#cccce0', fontSize: 11 }}>ACT {e.actual}</span> : <span>PRV {e.previous ?? '—'}</span>}
                            </div>
                            <span className={`ec-pill ${e.direction === 'beat' ? 'beat' : e.direction === 'miss' ? 'miss' : e.direction === 'inline' ? 'inline' : 'upcoming'}`}>
                              {e.direction === 'pending' ? 'pending' : e.surprisePct != null ? (e.surprisePct >= 0 ? '+' : '') + e.surprisePct.toFixed(0) + '%' : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        {/* ──────────── 4-5. YIELD CURVE + FX MATRIX ──────────── */}
        <div className="macro-g2">
          <section id="sec-yields" className="msec fi">
            <div className="msec-h">
              <div className="msec-t"><span className="msec-t-num">04</span>Yield Curve · The Crystal Ball</div>
              <div>
                {['current', '1y', '2y', '5y'].map((t) => (
                  <button key={t} className={`mt ${yieldTab === t ? 'a' : ''}`} onClick={() => setYieldTab(t)} style={{ marginLeft: 4 }}>
                    {t === 'current' ? 'NOW' : t.toUpperCase() + ' AGO'}
                  </button>
                ))}
              </div>
            </div>
            <div className="yc-pills">
              {yields && (
                <>
                  <span className={`yc-pill${yields.inversion ? ' inv' : ''}`}>10Y-2Y <b>{yields.spread_10_2 != null ? (yields.spread_10_2 > 0 ? '+' : '') + yields.spread_10_2.toFixed(2) : '—'}</b></span>
                  <span className="yc-pill">30Y-5Y <b>{yields.spread_30_5 != null ? (yields.spread_30_5 > 0 ? '+' : '') + yields.spread_30_5.toFixed(2) : '—'}</b></span>
                  <span className="yc-pill">FED FUNDS <b>{yields.fedFundsRate != null ? yields.fedFundsRate.toFixed(2) + '%' : '—'}</b></span>
                  {yields.inversion && <span className="yc-pill inv"><b>⚠ INVERTED</b></span>}
                </>
              )}
            </div>
            <div className="yc-box" ref={ycRef} />
            {er.yields && <Err m={er.yields} />}
            {ld.yields && !yields && <Load t="Loading FRED yield data…" />}
          </section>

          <section id="sec-fx" className="msec fi">
            <div className="msec-h"><div className="msec-t"><span className="msec-t-num">05</span>FX Strength Matrix</div></div>
            <div className="msec-b">
              {ld.fx && !fx && <Load />}
              {er.fx && <Err m={er.fx} />}
              {fx && <FXMatrix fx={fx} tf={fxTf} onTfChange={setFxTf} />}
            </div>
          </section>
        </div>

        {/* ──────────── 6. COMMODITY PULSE ──────────── */}
        <section id="sec-comm" className="msec fi">
          <div className="msec-h">
            <div className="msec-t"><span className="msec-t-num">06</span>Commodity & Energy Pulse</div>
            {commodities?.lastUpdated && (() => {
              const ageS = Math.max(0, Math.floor((now - new Date(commodities.lastUpdated).getTime()) / 1000));
              const fresh = ageS < 60;
              const c = fresh ? 'var(--neon-green)' : 'var(--neon-yellow)';
              return (
                <span className="live-pill" title="Yahoo Finance · futures lag ~10 min">
                  <span className="live-pill-dot" style={{ background: c }} />
                  <span className="live-pill-label" style={{ color: c }}>LIVE · {ageS}s ago</span>
                </span>
              );
            })()}
          </div>
          <div className="msec-b">
            {ld.commodities && !commodities && <Load />}
            {er.commodities && <Err m={er.commodities} />}
            {commodities?.commodities && (
              <div className="comm-grid">
                {commodities.commodities.map((c) => (
                  <CommodityCard key={c.symbol} c={c} plotlyReady={plotlyReady} onExpand={setExpandedComm} />
                ))}
              </div>
            )}
          </div>
        </section>

        {expandedComm && (
          <CommodityModal commodity={expandedComm} plotlyReady={plotlyReady} onClose={() => setExpandedComm(null)} />
        )}

        {/* ──────────── 7. GLOBAL FLOWS ──────────── */}
        <section className="msec fi">
          <div className="msec-h"><div className="msec-t"><span className="msec-t-num">07</span>Global Flows · The Multipolar Map</div></div>
          <div className="msec-b">
            {ld.flows && !flows && <Load />}
            {er.flows && <Err m={er.flows} />}
            {flows && (
              <div className="flow-grid">
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ash)', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>FX Reserves by Country (US$ Bn)</div>
                  <div className="flow-map" ref={flowMapRef} />
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ash)', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>Reserve Currency Composition (IMF COFER)</div>
                  <div className="flow-sankey" ref={flowSankeyRef} />
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ──────────── 8. SENTIMENT HEATMAP (FinBERT) ──────────── */}
        <section className="msec fi">
          <div className="msec-h"><div className="msec-t"><span className="msec-t-num">08</span>Sector Sentiment · FinBERT on AMD MI300X</div></div>
          <div className="msec-b">
            <SentimentHeatmap />
          </div>
        </section>

        <div className="footer">
          DATA · FRED (Federal Reserve) · FMP · OpenSky Network · World Bank · EIA · IMF COFER · BP Statistical Review<br />
          Quantum Macro Terminal · AMD Hackathon Championship Edition · Built for retail traders
        </div>
      </main>
    </>
  );
}