'use client';

import { useEffect, useRef, useState, useMemo } from 'react';

export default function OptTermWidget({ params }) {
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

  const { points, regime } = useMemo(() => {
    if (!opts?.surface || !opts?.spot) return { points: [], regime: null };
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
      title: { text: `${symbol} ATM IV Term Structure`, font: { size: 12, color: '#a0a0b4' } },
      xaxis: { title: 'Days to Expiry', gridcolor: '#282835' },
      yaxis: { title: 'ATM IV (%)', gridcolor: '#282835' },
    }, { responsive: true, displayModeBar: false });
  }, [points, plotlyReady, symbol]);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!opts) return <div className="loading"><div className="spinner" />Loading term structure…</div>;

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
