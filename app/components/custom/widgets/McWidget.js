'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { runMCCpu, sampleVizPaths, vizQuantiles } from '../../../mc/lib/cpu';

const OPTION_TYPES = [
  { id: 'asian',    label: 'Asian' },
  { id: 'barrier',  label: 'Barrier' },
  { id: 'lookback', label: 'Lookback' },
  { id: 'american', label: 'American' },
  { id: 'european', label: 'European' },
];

const fmtNum = (n, d = 2) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
const fmtMs = (ms) => { if (ms == null) return '—'; if (ms < 1000) return `${ms.toFixed(0)} ms`; return `${(ms / 1000).toFixed(2)} s`; };
const fmtThroughput = (pps) => {
  if (pps == null) return '—';
  if (pps >= 1e9) return `${(pps / 1e9).toFixed(2)} B/s`;
  if (pps >= 1e6) return `${(pps / 1e6).toFixed(2)} M/s`;
  return `${(pps / 1e3).toFixed(0)} K/s`;
};

function sliderToPaths(s) {
  const raw = Math.pow(10, s);
  if (raw < 1e4) return Math.round(raw / 100) * 100;
  if (raw < 1e5) return Math.round(raw / 1000) * 1000;
  if (raw < 1e6) return Math.round(raw / 10_000) * 10_000;
  if (raw < 1e7) return Math.round(raw / 100_000) * 100_000;
  return Math.round(raw / 1_000_000) * 1_000_000;
}
function pathsToSlider(p) { return Math.log10(Math.max(1000, p)); }

function paramsKey(p) {
  return [p.optionType, p.S0, p.K, p.T, p.sigma, p.r, p.paths, p.steps, p.barrier ?? 'x', p.isCall ? 'C' : 'P'].join('|');
}

export default function McWidget({ params: widgetParams }) {
  const symbol = (widgetParams?.symbol || 'NVDA').toUpperCase();
  const initialType = (widgetParams?.mcType || 'asian').toLowerCase();
  const initialK = parseFloat(widgetParams?.K) || 100;

  const [optionType, setOptionType] = useState(initialType);
  const [isCall, setIsCall] = useState(true);
  const [S0, setS0] = useState(100);
  const [K, setK] = useState(initialK);
  const [days, setDays] = useState(30);
  const [sigma, setSigma] = useState(0.30);
  const [r, setR] = useState(0.045);
  const [barrier, setBarrier] = useState(null);
  const [paths, setPaths] = useState(1_000_000);
  const [steps, setSteps] = useState(252);
  const [engine, setEngine] = useState('cpu');
  const [running, setRunning] = useState(null);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState({ cpu: null, gpu: null });
  const [historyKey, setHistoryKey] = useState(null);
  const [gpuOffline, setGpuOffline] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [viz, setViz] = useState(null);
  const [plotlyReady, setPlotlyReady] = useState(false);

  const elapsedTimerRef = useRef(null);
  const fanRef = useRef(null);

  const T = useMemo(() => days / 365, [days]);
  const mcParams = useMemo(() => ({ optionType, S0, K, T, r, sigma, paths, steps, barrier, isCall }), [optionType, S0, K, T, r, sigma, paths, steps, barrier, isCall]);
  const key = useMemo(() => paramsKey(mcParams), [mcParams]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.Plotly) { setPlotlyReady(true); return; }
    const t = setInterval(() => { if (window.Plotly) { setPlotlyReady(true); clearInterval(t); } }, 100);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (key !== historyKey) {
      setHistoryKey(key);
      setHistory({ cpu: null, gpu: null });
      setViz(null);
    }
  }, [key, historyKey]);

  // Auto-fill spot price from market data.
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    fetch(`/data_pages/stock?symbol=${symbol}&timeframe=1Day&tradingDays=2`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (cancelled || !j?.bars?.length) return;
        const last = j.bars[j.bars.length - 1];
        if (!last?.c) return;
        const px = +last.c.toFixed(2);
        setS0(px);
        setK((cur) => (cur === 100 || cur === 0 ? px : cur));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [symbol]);

  // Probe GPU service on mount.
  useEffect(() => {
    fetch('/data_pages/mc/gpu', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ probe: true }),
    }).then((r) => r.json()).then((j) => { if (j?.offline) setGpuOffline(true); }).catch(() => setGpuOffline(true));
  }, []);

  const refreshViz = useCallback(() => {
    const sampled = sampleVizPaths({ S0, T, r, sigma, steps, samples: 100 });
    const q = vizQuantiles(sampled.grid, sampled.samples, sampled.cols);
    setViz({ ...sampled, ...q });
  }, [S0, T, r, sigma, steps]);

  const runCpu = useCallback(async () => {
    setRunning('cpu'); setErrorMsg(null); setProgress(0); setElapsed(0); setResult(null);
    const t0 = performance.now();
    elapsedTimerRef.current = setInterval(() => setElapsed(performance.now() - t0), 50);
    try {
      const res = await runMCCpu({ ...mcParams, onProgress: (frac) => setProgress(frac) });
      setResult(res);
      setHistory((h) => ({ ...h, cpu: res }));
      refreshViz();
    } catch (e) {
      setErrorMsg(e?.message || 'CPU run failed');
    } finally {
      clearInterval(elapsedTimerRef.current);
      setRunning(null); setProgress(1);
    }
  }, [mcParams, refreshViz]);

  const runGpu = useCallback(async () => {
    setRunning('gpu'); setErrorMsg(null); setProgress(0); setElapsed(0); setResult(null);
    const t0 = performance.now();
    elapsedTimerRef.current = setInterval(() => setElapsed(performance.now() - t0), 50);
    try {
      const res = await fetch('/data_pages/mc/gpu', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mcParams),
      });
      const j = await res.json();
      if (!res.ok || j.error) { setGpuOffline(!!j.offline); throw new Error(j.detail || j.error || `HTTP ${res.status}`); }
      setGpuOffline(false);
      const r2 = { ...j, source: j.source || 'mi300x' };
      setResult(r2);
      setHistory((h) => ({ ...h, gpu: r2 }));
      refreshViz();
    } catch (e) {
      setErrorMsg(e?.message || 'GPU run failed');
    } finally {
      clearInterval(elapsedTimerRef.current);
      setRunning(null); setProgress(1);
    }
  }, [mcParams, refreshViz]);

  const onRun = useCallback(() => {
    if (running) return;
    if (optionType === 'barrier' && (barrier == null || barrier === '' || isNaN(+barrier))) {
      setErrorMsg('Set a knock-out barrier price for Barrier options.'); return;
    }
    if (S0 <= 0 || K <= 0 || sigma <= 0 || days <= 0 || steps <= 0 || paths < 1000) {
      setErrorMsg('Inputs look off — check stock price, strike, days, vol, and simulations.'); return;
    }
    if (engine === 'cpu') runCpu(); else runGpu();
  }, [engine, running, runCpu, runGpu, optionType, barrier, S0, K, sigma, days, steps, paths]);

  const pickOptionType = useCallback((next) => {
    setOptionType(next);
    if (next === 'barrier' && (barrier == null || barrier === '')) {
      setBarrier(+(S0 * (isCall ? 1.15 : 0.85)).toFixed(2));
    }
  }, [S0, isCall, barrier]);

  // Path fan chart.
  useEffect(() => {
    if (!plotlyReady || !fanRef.current) return;
    if (!viz?.grid || !viz.cols) { window.Plotly.purge(fanRef.current); return; }
    const { grid, samples, cols, p05, p50, p95 } = viz;
    const dt = T / steps;
    const xAxis = Array.from({ length: cols }, (_, i) => +(i * dt * 365).toFixed(2));
    const xPaths = new Array(samples * (cols + 1));
    const yPaths = new Array(samples * (cols + 1));
    let ptr = 0;
    for (let p = 0; p < samples; p++) {
      for (let i = 0; i < cols; i++) { xPaths[ptr] = xAxis[i]; yPaths[ptr] = grid[p * cols + i]; ptr++; }
      xPaths[ptr] = null; yPaths[ptr] = null; ptr++;
    }
    window.Plotly.react(fanRef.current, [
      { type: 'scatter', mode: 'lines', x: xPaths, y: yPaths, line: { color: 'rgba(122,122,144,0.20)', width: 1 }, hoverinfo: 'skip', showlegend: false },
      { type: 'scatter', mode: 'lines', x: xAxis, y: Array.from(p05), line: { color: 'rgba(0,212,255,0.55)', width: 1 }, name: '5%' },
      { type: 'scatter', mode: 'lines', x: xAxis, y: Array.from(p95), line: { color: 'rgba(0,212,255,0.55)', width: 1 }, fill: 'tonexty', fillcolor: 'rgba(0,212,255,0.10)', name: '95%' },
      { type: 'scatter', mode: 'lines', x: xAxis, y: Array.from(p50), line: { color: '#00f59b', width: 2.5 }, name: 'Median' },
    ], {
      paper_bgcolor: '#0b0b10', plot_bgcolor: '#0b0b10',
      xaxis: { color: '#7a7a90', gridcolor: '#1e1e28', title: { text: 'Days from now', font: { color: '#7a7a90', size: 9 } }, tickfont: { color: '#7a7a90', size: 9 }, zeroline: false },
      yaxis: { color: '#7a7a90', gridcolor: '#1e1e28', title: { text: 'Price ($)', font: { color: '#7a7a90', size: 9 } }, tickfont: { color: '#7a7a90', size: 9 }, zeroline: false },
      margin: { l: 56, r: 18, t: 18, b: 40 },
      legend: { orientation: 'h', x: 0, y: 1.14, font: { color: '#7a7a90', size: 9 } },
      font: { family: 'Geist Mono', size: 9, color: '#7a7a90' },
      shapes: [{ type: 'line', xref: 'x', x0: xAxis[0], x1: xAxis[cols - 1], yref: 'y', y0: K, y1: K, line: { color: 'rgba(153,85,255,0.7)', width: 1, dash: 'dash' } }],
      hovermode: 'x unified',
    }, { displayModeBar: false, responsive: true });
  }, [plotlyReady, viz, T, steps, K]);

  const speedup = useMemo(() => {
    if (!history.cpu?.runtimeMs || !history.gpu?.runtimeMs) return null;
    return history.cpu.runtimeMs / history.gpu.runtimeMs;
  }, [history]);

  return (
    <div style={{ padding: '8px 4px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Option type + call/put */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {OPTION_TYPES.map((t) => (
          <button key={t.id} className={`tf ${optionType === t.id ? 'a' : ''}`} onClick={() => pickOptionType(t.id)}>{t.label}</button>
        ))}
        <span style={{ color: 'var(--ash)', margin: '0 4px' }}>|</span>
        <button className={`tf ${isCall ? 'a' : ''}`} onClick={() => setIsCall(true)}>Call</button>
        <button className={`tf ${!isCall ? 'a' : ''}`} onClick={() => setIsCall(false)}>Put</button>
      </div>

      {/* Params grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
        <MiniField label="Spot ($)" value={S0} onChange={setS0} step={0.5} />
        <MiniField label="Strike ($)" value={K} onChange={setK} step={0.5} />
        <MiniField label="Days to expiry" value={days} onChange={setDays} step={1} />
        <MiniField label="Vol (annual)" value={sigma} onChange={setSigma} step={0.01} fmt="pct" />
        <MiniField label="Risk-free rate" value={r} onChange={setR} step={0.0025} fmt="pct" />
        <MiniField label={optionType === 'barrier' ? 'Barrier ($)' : 'Barrier (off)'} value={barrier ?? ''} onChange={(v) => setBarrier(v === '' ? null : v)} step={0.5} disabled={optionType !== 'barrier'} />
      </div>

      {/* Paths slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, color: 'var(--ash)', minWidth: 80 }}>Simulations</span>
        <input type="range" min="3" max="7" step="0.1" value={pathsToSlider(paths)} onChange={(e) => setPaths(sliderToPaths(parseFloat(e.target.value)))} style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--neon-cyan)', minWidth: 100, textAlign: 'right' }}>{paths.toLocaleString()} paths</span>
      </div>

      {/* Engine + run */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
          <input type="radio" name={`mc-engine-${symbol}`} checked={engine === 'cpu'} onChange={() => setEngine('cpu')} />
          <span style={{ color: engine === 'cpu' ? 'var(--neon-cyan)' : 'var(--ash)' }}>Browser CPU</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: gpuOffline ? 'not-allowed' : 'pointer', opacity: gpuOffline ? 0.4 : 1 }}>
          <input type="radio" name={`mc-engine-${symbol}`} checked={engine === 'gpu'} onChange={() => setEngine('gpu')} disabled={gpuOffline} />
          <span style={{ color: engine === 'gpu' ? '#00f59b' : 'var(--ash)' }}>AMD MI300X{gpuOffline ? ' (offline)' : ''}</span>
        </label>
        <button className="mc-run" onClick={onRun} disabled={!!running} style={{ marginLeft: 'auto' }}>
          {running ? '▶ Running…' : '▶ Run'}
        </button>
      </div>

      {/* Progress */}
      {running && (
        <div className="mc-progress">
          <div className="mc-progress-bar"><div className="mc-progress-fill" style={{ width: `${(progress * 100).toFixed(1)}%` }} /></div>
          <div className="mc-progress-meta">
            <span>{Math.round(progress * 100)}% · {running === 'cpu' ? 'CPU' : 'MI300X'}</span>
            <span>{fmtMs(elapsed)}</span>
          </div>
        </div>
      )}
      {errorMsg && <div className="err">⚠ {errorMsg}</div>}

      {/* Result */}
      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
          <ResultCell label="Fair price" value={`$${fmtNum(result.price, 4)}`} accent="#00f59b" hint={`± $${fmtNum(result.stderr, 4)}`} />
          <ResultCell label="Runtime" value={fmtMs(result.runtimeMs)} accent="#00d4ff" hint={fmtThroughput(result.pathsPerSec)} />
          {speedup != null && (
            <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#00f59b', padding: '4px 0' }}>
              ⚡ MI300X is <b>{speedup.toFixed(1)}×</b> faster than CPU
            </div>
          )}
        </div>
      )}

      {/* Path fan chart */}
      {viz && <div ref={fanRef} style={{ height: 220 }} />}
      {!result && !running && !viz && (
        <div style={{ fontSize: 11, color: 'var(--ash)', padding: '8px 0' }}>
          Set up the option above and hit ▶ Run.
          <a href={`/mc?sym=${symbol}`} style={{ color: 'var(--neon-cyan)', marginLeft: 8 }}>Open full pricer →</a>
        </div>
      )}
    </div>
  );
}

function MiniField({ label, value, onChange, step = 1, fmt = null, disabled = false }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: disabled ? 0.4 : 1 }}>
      <span style={{ fontSize: 9, color: 'var(--ash)' }}>{label}</span>
      <input
        type="number"
        step={step}
        value={value === '' || value == null ? '' : value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '') { onChange(''); return; }
          const n = parseFloat(v);
          onChange(isNaN(n) ? '' : n);
        }}
        disabled={disabled}
        style={{ background: '#18181f', border: '1px solid #282835', color: '#cfcfdc', padding: '4px 6px', fontFamily: 'var(--mono)', borderRadius: 4, fontSize: 11, width: '100%' }}
      />
      {fmt === 'pct' && value !== '' && value != null && (
        <span style={{ fontSize: 9, color: 'var(--neon-cyan)' }}>{(value * 100).toFixed(2)}%</span>
      )}
    </label>
  );
}

function ResultCell({ label, value, hint, accent }) {
  return (
    <div style={{ background: '#18181f', border: '1px solid #282835', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ fontSize: 9, color: 'var(--ash)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, color: accent, fontFamily: 'var(--mono)', fontWeight: 700 }}>{value}</div>
      {hint && <div style={{ fontSize: 9, color: 'var(--ash)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}
