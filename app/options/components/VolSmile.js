'use client';
import { useState, useEffect, useRef, useMemo } from 'react';

// Linear interp helper: given sorted points by moneyness, return IV at target.
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

export default function VolSmile({ sym, opts, plotlyReady }) {
  const ref = useRef(null);
  const [exp, setExp] = useState(null);

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

    // ATM IV ≈ IV at moneyness 1.0 (avg of call+put if both reach).
    const atmCall = interp(calls, 1.0);
    const atmPut = interp(puts, 1.0);
    const atm = atmCall != null && atmPut != null ? (atmCall + atmPut) / 2 : (atmCall ?? atmPut);

    // 25-delta proxy: use 25Δ ≈ moneyness near 1.10 for OTM call, 0.90 for OTM put.
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
      title: { text: `${sym} Vol Smile · ${exp || ''}`, font: { size: 12, color: '#a0a0b4' } },
      xaxis: { title: 'Moneyness (K/S)', gridcolor: '#282835', zerolinecolor: '#282835' },
      yaxis: { title: 'IV (%)', gridcolor: '#282835', zerolinecolor: '#282835' },
      legend: { font: { size: 10, color: '#a0a0b4' }, orientation: 'h', y: -0.2 },
      shapes: [{ type: 'line', x0: 1, x1: 1, yref: 'paper', y0: 0, y1: 1, line: { color: 'rgba(255,255,255,0.15)', dash: 'dot' } }],
    }, { responsive: true, displayModeBar: false });
  }, [stats, plotlyReady, exp, sym]);

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