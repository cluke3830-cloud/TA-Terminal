'use client';

import { useEffect, useRef, useState, useMemo } from 'react';

function interp(points, target) {
  if (!points.length) return null;
  if (target <= points[0].x) return points[0].y;
  if (target >= points[points.length - 1].x) return points[points.length - 1].y;
  for (let i = 1; i < points.length; i++) {
    if (points[i].x >= target) {
      const a = points[i - 1], b = points[i];
      const t = (target - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return null;
}

export default function OptSmileWidget({ params }) {
  const symbol = (params?.symbol || 'NVDA').toUpperCase();
  const ref = useRef(null);
  const [opts, setOpts] = useState(null);
  const [exp, setExp] = useState(null);
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
    setOpts(null); setErr(''); setExp(null);
    fetch(`/data_pages/options?symbol=${symbol}`)
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((j) => { if (!cancelled) setOpts(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [symbol]);

  const expiries = useMemo(() => {
    if (!opts?.surface) return [];
    return [...new Set(opts.surface.map((d) => d.exp).filter(Boolean))].sort();
  }, [opts]);

  useEffect(() => {
    if (!exp && expiries.length) setExp(expiries[Math.floor(expiries.length / 2)]);
  }, [expiries, exp]);

  const stats = useMemo(() => {
    if (!opts?.surface || !exp || !opts.spot) return null;
    const rows = opts.surface.filter((d) => d.exp === exp);
    if (rows.length < 4) return null;
    const calls = rows.filter((r) => r.type === 'call').map((r) => ({ x: r.strike / opts.spot, y: r.iv }))
      .sort((a, b) => a.x - b.x);
    const puts = rows.filter((r) => r.type === 'put').map((r) => ({ x: r.strike / opts.spot, y: r.iv }))
      .sort((a, b) => a.x - b.x);
    if (!calls.length || !puts.length) return { calls, puts, atm: null, rr25: null, bf25: null };
    const atmCall = interp(calls, 1.0);
    const atmPut = interp(puts, 1.0);
    const atm = atmCall != null && atmPut != null ? (atmCall + atmPut) / 2 : (atmCall ?? atmPut);
    const c25 = interp(calls, 1.10);
    const p25 = interp(puts, 0.90);
    const rr25 = c25 != null && p25 != null ? +(c25 - p25).toFixed(2) : null;
    const bf25 = c25 != null && p25 != null && atm != null ? +(((c25 + p25) / 2) - atm).toFixed(2) : null;
    return { calls, puts, atm, rr25, bf25 };
  }, [opts, exp]);

  useEffect(() => {
    if (!plotlyReady || !ref.current || !stats) return;
    const traces = [];
    if (stats.calls.length) traces.push({
      x: stats.calls.map((p) => p.x), y: stats.calls.map((p) => p.y),
      type: 'scatter', mode: 'lines+markers', name: 'Calls',
      line: { color: '#00d4ff', width: 2 }, marker: { size: 6 },
    });
    if (stats.puts.length) traces.push({
      x: stats.puts.map((p) => p.x), y: stats.puts.map((p) => p.y),
      type: 'scatter', mode: 'lines+markers', name: 'Puts',
      line: { color: '#ff8833', width: 2 }, marker: { size: 6 },
    });
    if (stats.atm != null) traces.push({
      x: [1.0], y: [stats.atm],
      type: 'scatter', mode: 'markers', name: 'ATM',
      marker: { size: 12, color: '#00f59b', symbol: 'star' },
    });
    window.Plotly.newPlot(ref.current, traces, {
      paper_bgcolor: '#111117', plot_bgcolor: '#111117',
      font: { color: '#a0a0b4', family: 'Geist Mono', size: 10 },
      margin: { l: 50, r: 20, t: 32, b: 40 },
      title: { text: `${symbol} Vol Smile · ${exp || ''}`, font: { size: 12, color: '#a0a0b4' } },
      xaxis: { title: 'Moneyness (K/S)', gridcolor: '#282835', zerolinecolor: '#282835' },
      yaxis: { title: 'IV (%)', gridcolor: '#282835', zerolinecolor: '#282835' },
      legend: { font: { size: 10, color: '#a0a0b4' }, orientation: 'h', y: -0.2 },
      shapes: [{ type: 'line', x0: 1, x1: 1, yref: 'paper', y0: 0, y1: 1, line: { color: 'rgba(255,255,255,0.15)', dash: 'dot' } }],
    }, { responsive: true, displayModeBar: false });
  }, [stats, plotlyReady, exp, symbol]);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!opts) return <div className="loading"><div className="spinner" />Loading vol smile…</div>;

  return (
    <>
      <div className="tabs" style={{ marginBottom: 8, padding: '8px 14px 0' }}>
        <span style={{ fontSize: 10, color: 'var(--ash)', marginRight: 6 }}>Expiry:</span>
        {expiries.slice(0, 8).map((e) => (
          <button key={e} className={`tf ${exp === e ? 'a' : ''}`} onClick={() => setExp(e)}>{e}</button>
        ))}
      </div>
      <div ref={ref} style={{ height: 320 }} />
      <div style={{ padding: '6px 14px 12px', display: 'flex', gap: 16, fontSize: 11, fontFamily: 'var(--mono)' }}>
        <span>ATM IV: <b className="vc">{stats?.atm != null ? stats.atm.toFixed(2) + '%' : '—'}</b></span>
        <span>Risk Reversal (25Δ): <b className={(stats?.rr25 ?? 0) >= 0 ? 'vg' : 'vr'}>{stats?.rr25 != null ? `${stats.rr25 >= 0 ? '+' : ''}${stats.rr25}%` : '—'}</b></span>
        <span>Butterfly (25Δ): <b className="vp">{stats?.bf25 != null ? `${stats.bf25 >= 0 ? '+' : ''}${stats.bf25}%` : '—'}</b></span>
      </div>
    </>
  );
}
