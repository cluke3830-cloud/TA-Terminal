'use client';
import { useEffect, useRef, useMemo } from 'react';

export default function TermStructure({ sym, opts, plotlyReady }) {
  const ref = useRef(null);

  const { points, regime } = useMemo(() => {
    if (!opts?.surface || !opts?.spot) return { points: [], regime: null };
    // Group by expiry, find the strike closest to spot per expiry, take its IV (avg call+put if both).
    const byExp = {};
    opts.surface.forEach((p) => {
      const exp = p.exp || `dte-${p.dte}`;
      (byExp[exp] = byExp[exp] || []).push(p);
    });
    const pts = Object.entries(byExp).map(([exp, rows]) => {
      const dte = rows[0].dte;
      const calls = rows.filter((r) => r.type === 'call');
      const puts = rows.filter((r) => r.type === 'put');
      const atmFrom = (arr) => {
        if (!arr.length) return null;
        let best = arr[0], bd = Math.abs(arr[0].strike - opts.spot);
        arr.forEach((r) => { const d = Math.abs(r.strike - opts.spot); if (d < bd) { best = r; bd = d; } });
        return best.iv;
      };
      const ic = atmFrom(calls), ip = atmFrom(puts);
      const iv = ic != null && ip != null ? (ic + ip) / 2 : (ic ?? ip);
      return { exp, dte, iv };
    }).filter((p) => p.iv != null && p.dte > 0).sort((a, b) => a.dte - b.dte);

    if (pts.length < 2) return { points: pts, regime: null };
    const front = pts[0].iv, back = pts[pts.length - 1].iv;
    const reg = back > front ? 'contango' : 'backwardation';
    return { points: pts, regime: reg };
  }, [opts]);

  useEffect(() => {
    if (!plotlyReady || !ref.current || points.length < 2) return;
    window.Plotly.newPlot(ref.current, [{
      x: points.map((p) => p.dte), y: points.map((p) => p.iv),
      type: 'scatter', mode: 'lines+markers',
      line: { color: '#9955ff', width: 3, shape: 'spline' }, marker: { size: 8, color: '#cceeFF' },
      hovertemplate: 'DTE: %{x}d<br>ATM IV: %{y:.2f}%<extra></extra>',
    }], {
      paper_bgcolor: '#111117', plot_bgcolor: '#111117',
      font: { color: '#a0a0b4', family: 'Geist Mono', size: 10 },
      margin: { l: 50, r: 20, t: 32, b: 40 },
      title: { text: `${sym} ATM IV Term Structure`, font: { size: 12, color: '#a0a0b4' } },
      xaxis: { title: 'Days to Expiry', gridcolor: '#282835' },
      yaxis: { title: 'ATM IV (%)', gridcolor: '#282835' },
    }, { responsive: true, displayModeBar: false });
  }, [points, plotlyReady, sym]);

  return (
    <>
      <div ref={ref} style={{ height: 320 }} />
      <div style={{ padding: '6px 14px 12px', fontSize: 11, fontFamily: 'var(--mono)' }}>
        Regime:&nbsp;
        <b className={regime === 'contango' ? 'vg' : regime === 'backwardation' ? 'vr' : ''}>
          {regime ? regime.toUpperCase() : '—'}
        </b>
        {points.length >= 2 && (
          <span style={{ color: 'var(--ash)', marginLeft: 12 }}>
            front {points[0].iv.toFixed(1)}% · back {points[points.length - 1].iv.toFixed(1)}%
          </span>
        )}
      </div>
    </>
  );
}