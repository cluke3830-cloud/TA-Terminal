'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { fmt, fmtPct, fmtDate, fmtTime, Load, Err } from '../components/ui';

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

function FXMatrix({ fx }) {
  if (!fx || !fx.matrix) return <div className="loading"><div className="spinner" />FX matrix loading…</div>;
  const cur = fx.currencies;
  const cell = (a, b) => {
    if (a === b) return { bg: 'var(--graphite)', text: '—' };
    const v = fx.matrix[a]?.[b];
    if (v == null) return { bg: 'var(--obsidian)', text: '—' };
    const intensity = Math.min(1, Math.abs(v) / 1.5);
    const bg = v > 0
      ? `rgba(0, 245, 155, ${0.10 + intensity * 0.45})`
      : v < 0
      ? `rgba(255, 51, 85, ${0.10 + intensity * 0.45})`
      : 'rgba(85,85,104,0.15)';
    const text = (v > 0 ? '+' : '') + v.toFixed(2);
    return { bg, text };
  };
  return (
    <>
      <div className="fx-dxy">
        <div>
          <div className="fx-dxy-l">DXY · USD Index (ICE)</div>
          <div className="fx-dxy-v">{fx.dxy != null ? fx.dxy.toFixed(2) : '—'}</div>
        </div>
        <div className={`fx-dxy-c ${fx.dxyChange24h >= 0 ? 'comm-chg up' : 'comm-chg dn'}`}>
          {fx.dxyChange24h != null ? fmtPct(fx.dxyChange24h) : '—'} 24h
        </div>
      </div>
      <div className="fx-matrix">
        <div className="fx-mh">·</div>
        {cur.map((c) => <div key={`h-${c}`} className="fx-mh">{c}</div>)}
        {cur.map((a) => (
          <div key={`row-${a}`} style={{ display: 'contents' }}>
            <div className="fx-mh">{a}</div>
            {cur.map((b) => {
              const c = cell(a, b);
              return (
                <div key={`${a}-${b}`} className={`fx-mc${a === b ? ' diag' : ''}`} style={{ background: c.bg }} title={`${a}/${b}: ${c.text}%`}>
                  {c.text}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--ash)', letterSpacing: 0.5 }}>
        ROW = base currency · COL = quote · % = 24h relative strength of row vs col
      </div>
    </>
  );
}

function CommodityCard({ c, plotlyReady }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!plotlyReady || !ref.current || !c.sparkline || c.sparkline.length < 2) return;
    const isUp = c.changePct == null ? true : c.changePct >= 0;
    const color = isUp ? '#00f59b' : '#ff3355';
    window.Plotly.newPlot(ref.current, [{
      type: 'scatter', mode: 'lines', x: c.sparkline.map((_, i) => i), y: c.sparkline,
      line: { color, width: 1.5, shape: 'spline' }, fill: 'tozeroy',
      fillcolor: isUp ? 'rgba(0,245,155,0.10)' : 'rgba(255,51,85,0.10)', hoverinfo: 'skip',
    }], {
      paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
      xaxis: { visible: false, fixedrange: true },
      yaxis: { visible: false, fixedrange: true, range: [Math.min(...c.sparkline) * 0.98, Math.max(...c.sparkline) * 1.02] },
      margin: { l: 0, r: 0, t: 0, b: 0 }, showlegend: false,
    }, { displayModeBar: false, responsive: true });
  }, [plotlyReady, c.sparkline, c.changePct]);
  return (
    <div className="comm-card">
      <div className="comm-name">{c.name}</div>
      <div className="comm-price">{c.price != null ? fmt(c.price, c.price < 10 ? 3 : 2) : '—'}</div>
      <div className={`comm-chg ${c.changePct == null ? '' : c.changePct >= 0 ? 'up' : 'dn'}`}>
        {c.changePct != null ? fmtPct(c.changePct) : '—'}
      </div>
      <div className="comm-unit">{c.unit}</div>
      <div ref={ref} className="comm-spark" />
    </div>
  );
}

export default function MacroDashboard() {
  const [yields, setYields] = useState(null);
  const [banks, setBanks] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [commodities, setCommodities] = useState(null);
  const [fx, setFx] = useState(null);
  const [flows, setFlows] = useState(null);
  const [flights, setFlights] = useState(null);
  const [feargreed, setFeargreed] = useState(null);
  const [geoData, setGeoData] = useState(null);
  const [oilData, setOilData] = useState(null);

  const [mapTab, setMapTab] = useState('geo');
  const [yieldTab, setYieldTab] = useState('current');
  const [calTab, setCalTab] = useState('upcoming');
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

  // Live clock
  useEffect(() => {
    setClock(fmtTime());
    const t = setInterval(() => setClock(fmtTime()), 1000);
    return () => clearInterval(t);
  }, []);

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
    fetchS('yields', '/api/macro/yields', setYields);
    fetchS('banks', '/api/macro/centralbanks', setBanks);
    fetchS('calendar', '/api/macro/calendar', setCalendar);
    fetchS('commodities', '/api/macro/commodities', setCommodities);
    fetchS('fx', '/api/macro/fx', setFx);
    fetchS('flows', '/api/macro/flows', setFlows);
    fetchS('flights', '/api/macro/flights', setFlights);
    fetchS('geo', '/api/macro/geopolitical?view=risk', (d) => setGeoData(d.data));
    fetchS('oil', '/api/macro/geopolitical?view=oil', (d) => setOilData(d.data));
    // FearGreed last (depends on others, server-side aggregator)
    setTimeout(() => fetchS('fg', '/api/macro/feargreed', setFeargreed), 1500);
  }, [fetchS]);

  // Auto-refresh
  useEffect(() => {
    const fl = setInterval(() => fetchS('flights', '/api/macro/flights', setFlights), 60_000);
    const f = setInterval(() => fetchS('fx', '/api/macro/fx', setFx), 5 * 60_000);
    const c = setInterval(() => fetchS('commodities', '/api/macro/commodities', setCommodities), 10 * 60_000);
    return () => { clearInterval(fl); clearInterval(f); clearInterval(c); };
  }, [fetchS]);

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
    } else if (mapTab === 'flights' && flights) {
      trace = {
        type: 'scattergeo', mode: 'markers',
        lon: flights.aircraft.map((a) => a.lon),
        lat: flights.aircraft.map((a) => a.lat),
        marker: {
          size: 3,
          color: flights.aircraft.map((a) => a.alt),
          colorscale: [[0, '#3377ff'], [0.5, '#00d4ff'], [1, '#00f59b']],
          opacity: 0.75, line: { width: 0 },
          colorbar: { title: { text: 'Alt (m)', font: CHART_FONT }, tickfont: CHART_FONT, len: 0.6, thickness: 10, x: 0.99, bgcolor: 'rgba(0,0,0,0)' },
        },
        text: flights.aircraft.map((a) => `${a.callsign || 'N/A'}<br>${a.country}<br>Alt: ${a.alt}m · ${a.vel || 0}m/s`),
        hovertemplate: '%{text}<extra></extra>',
      };
    } else {
      return;
    }
    window.Plotly.react(mapRef.current, [trace], GEO_LAYOUT, { displayModeBar: false, responsive: true });
  }, [plotlyReady, mapTab, geoData, oilData, flights]);

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
        <section className="msec fi">
          <div className="msec-h">
            <div className="msec-t"><span className="msec-t-num">01</span>World Map · Geopolitics & Satellite</div>
            <div className="wmap-tabs">
              <button className={`mt ${mapTab === 'geo' ? 'a' : ''}`} onClick={() => setMapTab('geo')}>Geopolitical Risk</button>
              <button className={`mt ${mapTab === 'oil' ? 'a' : ''}`} onClick={() => setMapTab('oil')} style={{ marginLeft: 6 }}>Oil Reserves</button>
              <button className={`mt ${mapTab === 'flights' ? 'a' : ''}`} onClick={() => setMapTab('flights')} style={{ marginLeft: 6 }}>Flight Tracker</button>
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
            {mapTab === 'flights' && flights && (
              <>
                <span>LIVE AIRCRAFT: <b>{flights.count.toLocaleString()}</b></span>
                <span>GLOBAL TOTAL: <b>{flights.total?.toLocaleString() ?? '—'}</b></span>
                <span>SOURCE: <b>OPENSKY NETWORK · 60s REFRESH</b></span>
              </>
            )}
          </div>
        </section>

        {/* ──────────── 2-3. CENTRAL BANKS + CALENDAR ──────────── */}
        <div className="macro-g3">
          <section className="msec fi">
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

          <section className="msec fi">
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
                  <div className="ec-list">
                    {(calTab === 'upcoming' ? calendar.upcoming : calendar.recent).slice(0, 25).map((e, i) => (
                      <div key={i} className="ec-row">
                        <span className="ec-date">{(e.date || '').slice(5, 16).replace('T', ' ')}</span>
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
                </>
              )}
            </div>
          </section>
        </div>

        {/* ──────────── 4-5. YIELD CURVE + FX MATRIX ──────────── */}
        <div className="macro-g2">
          <section className="msec fi">
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

          <section className="msec fi">
            <div className="msec-h"><div className="msec-t"><span className="msec-t-num">05</span>FX Strength Matrix</div></div>
            <div className="msec-b">
              {ld.fx && !fx && <Load />}
              {er.fx && <Err m={er.fx} />}
              {fx && <FXMatrix fx={fx} />}
            </div>
          </section>
        </div>

        {/* ──────────── 6. COMMODITY PULSE ──────────── */}
        <section className="msec fi">
          <div className="msec-h"><div className="msec-t"><span className="msec-t-num">06</span>Commodity & Energy Pulse</div></div>
          <div className="msec-b">
            {ld.commodities && !commodities && <Load />}
            {er.commodities && <Err m={er.commodities} />}
            {commodities?.commodities && (
              <div className="comm-grid">
                {commodities.commodities.map((c) => <CommodityCard key={c.symbol} c={c} plotlyReady={plotlyReady} />)}
              </div>
            )}
          </div>
        </section>

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

        <div className="footer">
          DATA · FRED (Federal Reserve) · FMP · OpenSky Network · World Bank · EIA · IMF COFER · BP Statistical Review<br />
          Quantum Macro Terminal · AMD Hackathon Championship Edition · Built for retail traders
        </div>
      </main>
    </>
  );
}