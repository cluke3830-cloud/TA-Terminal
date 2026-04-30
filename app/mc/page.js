'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { runMCCpu, sampleVizPaths, vizQuantiles } from './lib/cpu';

// Plain-English copy for retail. Each option type gets a one-line "what it
// pays" so a non-quant can pick the right one.
const OPTION_TYPES = [
  { id: 'asian',     label: 'Asian',     blurb: 'Pays on the average price over the period (less volatile)' },
  { id: 'barrier',   label: 'Barrier',   blurb: 'Knocks out (worth $0) if the price crosses your barrier' },
  { id: 'lookback',  label: 'Lookback',  blurb: 'Pays based on the best (call) or worst (put) price seen' },
  { id: 'american',  label: 'American',  blurb: 'Can be exercised any day before expiry (early-exercise)' },
  { id: 'european',  label: 'European',  blurb: 'Standard option — pays at expiry only' },
];
const OPTION_BLURB = Object.fromEntries(OPTION_TYPES.map((t) => [t.id, t.blurb]));

// ── Helpers ────────────────────────────────────────────────────────────────
const fmtNum = (n, d = 2) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
const fmtInt = (n) => (n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('en-US'));
const fmtMs = (ms) => {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
};
const fmtThroughput = (pps) => {
  if (pps == null) return '—';
  if (pps >= 1e9) return `${(pps / 1e9).toFixed(2)} B paths/s`;
  if (pps >= 1e6) return `${(pps / 1e6).toFixed(2)} M paths/s`;
  if (pps >= 1e3) return `${(pps / 1e3).toFixed(0)} K paths/s`;
  return `${pps.toFixed(0)} paths/s`;
};

// Map slider value (3.0–7.0, log10 of paths) → integer path count, snapped to
// nice round numbers so the readout looks clean while dragging.
function sliderToPaths(s) {
  const raw = Math.pow(10, s);
  if (raw < 1e4) return Math.round(raw / 100) * 100;
  if (raw < 1e5) return Math.round(raw / 1000) * 1000;
  if (raw < 1e6) return Math.round(raw / 10_000) * 10_000;
  if (raw < 1e7) return Math.round(raw / 100_000) * 100_000;
  return Math.round(raw / 1_000_000) * 1_000_000;
}
function pathsToSlider(p) { return Math.log10(Math.max(1000, p)); }

// Stable hash of the current parameter set so we know when CPU and GPU runs
// match (and the speedup banner is honest). Any input change → new key → banner
// hides until both engines re-run.
function paramsKey(p) {
  return [p.optionType, p.S0, p.K, p.T, p.sigma, p.r, p.paths, p.steps, p.barrier ?? 'x', p.isCall ? 'C' : 'P'].join('|');
}

// ── Page wrapper ───────────────────────────────────────────────────────────
export default function MCPricerPage() {
  return (
    <Suspense fallback={<div className="loading"><div className="spinner" />Loading MC pricer…</div>}>
      <MCPricerInner />
    </Suspense>
  );
}

function MCPricerInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialSym = (searchParams.get('sym') || 'NVDA').toUpperCase();
  const initialType = (searchParams.get('type') || 'asian').toLowerCase();
  const initialK = parseFloat(searchParams.get('K')) || 100;
  const initialDays = parseInt((searchParams.get('T') || '30D').replace(/[^0-9]/g, ''), 10) || 30;
  const initialPaths = parseInt(searchParams.get('paths'), 10) || 1_000_000;
  const embed = searchParams.get('embed') === '1';

  const [sym, setSym] = useState(initialSym);
  const [optionType, setOptionType] = useState(initialType);
  const [isCall, setIsCall] = useState(true);
  const [S0, setS0] = useState(100);
  const [K, setK] = useState(initialK);
  const [days, setDays] = useState(initialDays);
  const [sigma, setSigma] = useState(0.30);
  const [r, setR] = useState(0.045);
  const [barrier, setBarrier] = useState(null);
  const [paths, setPaths] = useState(initialPaths);
  const [steps, setSteps] = useState(252);

  const [engine, setEngine] = useState('cpu');
  const [running, setRunning] = useState(null); // 'cpu' | 'gpu' | null
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null); // last run, used for the result panel
  const [history, setHistory] = useState({ cpu: null, gpu: null }); // keyed by current paramsKey
  const [historyKey, setHistoryKey] = useState(null);
  const [gpuOffline, setGpuOffline] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [viz, setViz] = useState(null); // { grid, samples, cols, p05, p50, p95 }

  const elapsedTimerRef = useRef(null);
  const fanRef = useRef(null);
  const [plotlyReady, setPlotlyReady] = useState(false);

  const T = useMemo(() => days / 365, [days]);
  const params = useMemo(() => ({ optionType, S0, K, T, r, sigma, paths, steps, barrier, isCall }), [optionType, S0, K, T, r, sigma, paths, steps, barrier, isCall]);
  const key = useMemo(() => paramsKey(params), [params]);

  // Fresh params → invalidate history (so the speedup banner only fires when
  // both engines have run against *these* numbers) and the visualization.
  useEffect(() => {
    if (key !== historyKey) {
      setHistoryKey(key);
      setHistory({ cpu: null, gpu: null });
      setViz(null);
    }
  }, [key, historyKey]);

  // Build the 100-path fan + quantile bands for the chart. Uses the same GBM
  // mechanics as the pricer (so the median lines up with what the engines
  // converge to). Fast — 100×252 random walks finish in <100ms.
  const refreshViz = useCallback(() => {
    const sampled = sampleVizPaths({ S0, T, r, sigma, steps, samples: 100 });
    const q = vizQuantiles(sampled.grid, sampled.samples, sampled.cols);
    setViz({ ...sampled, ...q });
  }, [S0, T, r, sigma, steps]);

  // Sync ticker from URL (so the global Nav search and ⌘K palette can land us
  // on /mc?sym=AAPL and have the page pick that ticker up).
  useEffect(() => {
    const urlSym = searchParams.get('sym')?.toUpperCase();
    if (urlSym && urlSym !== sym) setSym(urlSym);
  }, [searchParams, sym]);

  // Auto-fill spot price + at-the-money strike from the existing /data_pages/stock
  // route whenever the ticker changes. User can override anything; we only
  // pre-fill when fields look untouched (still at the default 100).
  useEffect(() => {
    if (!sym) return;
    let cancelled = false;
    fetch(`/data_pages/stock?symbol=${sym}&timeframe=1Day&tradingDays=2`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (cancelled || !j?.bars?.length) return;
        const last = j.bars[j.bars.length - 1];
        if (!last?.c) return;
        const px = +last.c.toFixed(2);
        setS0(px);
        // Snap strike to ATM if the user hasn't moved it off the default
        setK((cur) => (cur === 100 || cur === 0 ? px : cur));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sym]);

  // When user picks a new ticker (search dropdown), keep the URL in sync.
  const pickTicker = useCallback((nextSym) => {
    const t = (nextSym || '').trim().toUpperCase();
    if (!t || t === sym) return;
    setSym(t);
    // Preserve the rest of the params, just update sym
    const next = new URLSearchParams(searchParams.toString());
    next.set('sym', t);
    router.replace(`/mc?${next.toString()}`);
  }, [sym, router, searchParams]);

  // Preset scenarios — tap-to-fill common option setups.
  const applyPreset = useCallback((preset) => {
    if (preset === 'atm-call-30') { setOptionType('european'); setIsCall(true); setK(+S0.toFixed(2)); setDays(30); setBarrier(null); }
    else if (preset === 'otm-put-60') { setOptionType('european'); setIsCall(false); setK(+(S0 * 0.9).toFixed(2)); setDays(60); setBarrier(null); }
    else if (preset === 'asian-30') { setOptionType('asian'); setIsCall(true); setK(+S0.toFixed(2)); setDays(30); setBarrier(null); }
    else if (preset === 'knockout-call') { setOptionType('barrier'); setIsCall(true); setK(+S0.toFixed(2)); setDays(45); setBarrier(+(S0 * 1.15).toFixed(2)); }
  }, [S0]);

  // When user picks the Barrier option type from the buttons (not a preset),
  // auto-suggest a sensible barrier (15% above spot for calls, 15% below for
  // puts) so the simulation actually exercises the knock-out logic. Without
  // this, an unset barrier silently degrades to a vanilla European option,
  // which made earlier results look "wrong" to a retail user.
  const pickOptionType = useCallback((next) => {
    setOptionType(next);
    if (next === 'barrier' && (barrier == null || barrier === '')) {
      setBarrier(+(S0 * (isCall ? 1.15 : 0.85)).toFixed(2));
    }
  }, [S0, isCall, barrier]);

  // Plotly readiness (CDN-loaded by app/layout.js).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.Plotly) { setPlotlyReady(true); return; }
    const t = setInterval(() => { if (window.Plotly) { setPlotlyReady(true); clearInterval(t); } }, 100);
    return () => clearInterval(t);
  }, []);

  // ── Run handlers ─────────────────────────────────────────────────────────
  const runCpu = useCallback(async () => {
    setRunning('cpu'); setErrorMsg(null); setProgress(0); setElapsed(0); setResult(null);
    const t0 = performance.now();
    elapsedTimerRef.current = setInterval(() => setElapsed(performance.now() - t0), 50);
    try {
      const res = await runMCCpu({
        ...params,
        onProgress: (frac) => setProgress(frac),
      });
      setResult(res);
      setHistory((h) => ({ ...h, cpu: res }));
      refreshViz();
    } catch (e) {
      setErrorMsg(e?.message || 'CPU run failed');
    } finally {
      clearInterval(elapsedTimerRef.current);
      setRunning(null); setProgress(1);
    }
  }, [params, refreshViz]);

  const runGpu = useCallback(async () => {
    setRunning('gpu'); setErrorMsg(null); setProgress(0); setElapsed(0); setResult(null);
    const t0 = performance.now();
    elapsedTimerRef.current = setInterval(() => setElapsed(performance.now() - t0), 50);
    try {
      const r = await fetch('/data_pages/mc/gpu', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
      });
      const j = await r.json();
      if (!r.ok || j.error) {
        setGpuOffline(!!j.offline);
        throw new Error(j.detail || j.error || `HTTP ${r.status}`);
      }
      setGpuOffline(false);
      const res = { ...j, source: j.source || 'mi300x' };
      setResult(res);
      setHistory((h) => ({ ...h, gpu: res }));
      refreshViz();
    } catch (e) {
      setErrorMsg(e?.message || 'GPU run failed');
    } finally {
      clearInterval(elapsedTimerRef.current);
      setRunning(null); setProgress(1);
    }
  }, [params, refreshViz]);

  const onRun = useCallback(() => {
    if (running) return;
    // Validate retail-relevant input combinations before kicking off a
    // multi-second simulation that might silently degrade.
    if (optionType === 'barrier' && (barrier == null || barrier === '' || isNaN(+barrier))) {
      setErrorMsg('Set a knock-out barrier price for Barrier options.');
      return;
    }
    if (S0 <= 0 || K <= 0 || sigma <= 0 || days <= 0 || steps <= 0 || paths < 1000) {
      setErrorMsg('Inputs look off — make sure stock price, strike, days, vol, and simulations are all positive.');
      return;
    }
    if (engine === 'cpu') runCpu();
    else runGpu();
  }, [engine, running, runCpu, runGpu, optionType, barrier, S0, K, sigma, days, steps, paths]);

  // Probe the GPU service once on mount so we can disable the radio gracefully
  // when the ROCm box isn't configured.
  useEffect(() => {
    fetch('/data_pages/mc/gpu', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ probe: true }),
    }).then((r) => r.json()).then((j) => { if (j?.offline) setGpuOffline(true); }).catch(() => setGpuOffline(true));
  }, []);

  // Path-fan chart: 100 sample equity trajectories drawn faintly, with the
  // 5th / median / 95th percentile bands overlaid. Same GBM that the pricer
  // integrates against — visually validates that the engine is doing what
  // the math says it should.
  useEffect(() => {
    if (!plotlyReady || !fanRef.current) return;
    if (!viz?.grid || !viz.cols) {
      window.Plotly.purge(fanRef.current);
      return;
    }
    const { grid, samples, cols, p05, p50, p95 } = viz;
    const dt = T / steps;
    const xAxis = new Array(cols);
    for (let i = 0; i < cols; i++) xAxis[i] = +(i * dt * 365).toFixed(2); // x in days

    // 100 paths in one trace, separated by null breaks (much faster than 100
    // individual traces in Plotly).
    const xPaths = new Array(samples * (cols + 1));
    const yPaths = new Array(samples * (cols + 1));
    let ptr = 0;
    for (let p = 0; p < samples; p++) {
      for (let i = 0; i < cols; i++) {
        xPaths[ptr] = xAxis[i];
        yPaths[ptr] = grid[p * cols + i];
        ptr++;
      }
      xPaths[ptr] = null; yPaths[ptr] = null; ptr++;
    }

    const pathsTrace = {
      type: 'scatter', mode: 'lines',
      x: xPaths, y: yPaths,
      line: { color: 'rgba(122,122,144,0.20)', width: 1 },
      hoverinfo: 'skip', showlegend: false, name: '100 paths',
    };
    const p05Trace = {
      type: 'scatter', mode: 'lines',
      x: xAxis, y: Array.from(p05),
      line: { color: 'rgba(0,212,255,0.55)', width: 1 },
      name: '5%',
      hovertemplate: 'd=%{x}<br>5%: $%{y:.2f}<extra></extra>',
    };
    const p95Trace = {
      type: 'scatter', mode: 'lines',
      x: xAxis, y: Array.from(p95),
      line: { color: 'rgba(0,212,255,0.55)', width: 1 },
      fill: 'tonexty', fillcolor: 'rgba(0,212,255,0.10)',
      name: '95%',
      hovertemplate: 'd=%{x}<br>95%: $%{y:.2f}<extra></extra>',
    };
    const p50Trace = {
      type: 'scatter', mode: 'lines',
      x: xAxis, y: Array.from(p50),
      line: { color: '#00f59b', width: 2.5 },
      name: 'Median (50%)',
      hovertemplate: 'd=%{x}<br>median: $%{y:.2f}<extra></extra>',
    };

    const shapes = [
      { type: 'line', xref: 'x', x0: xAxis[0], x1: xAxis[cols - 1], yref: 'y', y0: K, y1: K,
        line: { color: 'rgba(153,85,255,0.7)', width: 1, dash: 'dash' } },
    ];
    const annotations = [
      { x: xAxis[cols - 1], y: K, xref: 'x', yref: 'y', text: `K = $${K}`,
        showarrow: false, font: { color: '#9955ff', size: 10, family: 'Geist Mono' },
        xanchor: 'right', yanchor: 'bottom', bgcolor: 'rgba(11,11,16,0.7)' },
    ];
    if (optionType === 'barrier' && barrier != null) {
      shapes.push({ type: 'line', xref: 'x', x0: xAxis[0], x1: xAxis[cols - 1], yref: 'y', y0: barrier, y1: barrier,
        line: { color: 'rgba(255,51,85,0.7)', width: 1, dash: 'dot' } });
      annotations.push({ x: xAxis[cols - 1], y: barrier, xref: 'x', yref: 'y', text: `barrier = $${barrier}`,
        showarrow: false, font: { color: '#ff3355', size: 10, family: 'Geist Mono' },
        xanchor: 'right', yanchor: 'top', bgcolor: 'rgba(11,11,16,0.7)' });
    }

    window.Plotly.react(fanRef.current, [pathsTrace, p05Trace, p95Trace, p50Trace], {
      paper_bgcolor: '#0b0b10', plot_bgcolor: '#0b0b10',
      xaxis: { color: '#7a7a90', gridcolor: '#1e1e28', linecolor: '#3a3a4d',
        title: { text: 'Days from now', font: { color: '#7a7a90', size: 9 }, standoff: 8 },
        tickfont: { color: '#7a7a90', size: 9 }, zeroline: false },
      yaxis: { color: '#7a7a90', gridcolor: '#1e1e28', linecolor: '#3a3a4d',
        title: { text: 'Price ($)', font: { color: '#7a7a90', size: 9 }, standoff: 8 },
        tickfont: { color: '#7a7a90', size: 9 }, zeroline: false },
      margin: { l: 56, r: 18, t: 18, b: 40 },
      legend: { orientation: 'h', x: 0, y: 1.14, font: { color: '#7a7a90', size: 9 } },
      font: { family: 'Geist Mono', size: 9, color: '#7a7a90' },
      shapes, annotations,
      hovermode: 'x unified',
    }, { displayModeBar: false, responsive: true });
  }, [plotlyReady, viz, T, steps, K, barrier, optionType]);

  // ── Speedup banner ───────────────────────────────────────────────────────
  const speedup = useMemo(() => {
    if (!history.cpu || !history.gpu) return null;
    if (!history.cpu.runtimeMs || !history.gpu.runtimeMs) return null;
    return history.cpu.runtimeMs / history.gpu.runtimeMs;
  }, [history]);

  return (
    <main className={`mc-dash ${embed ? 'mc-dash-embed' : ''}`}>
      {embed && (
        <style>{`
          .app-nav { display: none !important; }
          body { padding-top: 0 !important; }
          .mc-dash-embed { padding-top: 12px; }
        `}</style>
      )}
      {!embed && <MCSearchBar value={sym} onPick={pickTicker} />}

      {!embed && (
        <div className="mc-head fi">
          <div>
            <span className="mc-head-tag">OPTION PRICER · MONTE CARLO</span>
            <h1 className="mc-head-title">
              <span className="mc-head-sym">{sym}</span>
              <span className="mc-head-divider">·</span>
              <span>{optionType.toUpperCase()} {isCall ? 'CALL' : 'PUT'}</span>
            </h1>
            <div className="mc-head-blurb">{OPTION_BLURB[optionType] || 'Pick a strike and expiry, then hit Run.'}</div>
          </div>
          <div className="mc-head-tag mc-head-tag-r">Quick (browser) vs <span style={{ color: '#00f59b' }}>Fast (AMD MI300X)</span></div>
        </div>
      )}

      {!embed && (
        <div className="mc-intro">
          Pick a stock, choose an option type, set the strike + expiry, and hit Run. We simulate thousands of price paths and average the payoff to estimate a fair price. New here? Tap a preset below to start.
        </div>
      )}

      <div className="mc-presets fi">
        <span className="mc-presets-l">Presets</span>
        <button className="mc-preset" onClick={() => applyPreset('atm-call-30')}>ATM Call · 30 days</button>
        <button className="mc-preset" onClick={() => applyPreset('otm-put-60')}>OTM Put 10% · 60 days</button>
        <button className="mc-preset" onClick={() => applyPreset('asian-30')}>Asian Avg · 30 days</button>
        <button className="mc-preset" onClick={() => applyPreset('knockout-call')}>Knock-out Call</button>
      </div>

      {/* ── PARAMS ── */}
      <section className="mc-card fi fi1">
        <div className="card-h"><span className="card-t">Option setup</span></div>
        <div className="mc-params">
          <div className="mc-row">
            <span className="mc-row-l">Type</span>
            <div className="mc-types">
              {OPTION_TYPES.map((t) => (
                <button key={t.id} className={`tf ${optionType === t.id ? 'a' : ''}`} onClick={() => pickOptionType(t.id)} title={t.blurb}>{t.label}</button>
              ))}
              <span className="cb-sep">|</span>
              <button className={`tf ${isCall ? 'a' : ''}`} onClick={() => setIsCall(true)} title="Call: profits if price goes up">Call</button>
              <button className={`tf ${!isCall ? 'a' : ''}`} onClick={() => setIsCall(false)} title="Put: profits if price goes down">Put</button>
            </div>
          </div>
          <div className="mc-row mc-row-grid">
            <Field label="Stock price (today)" hint="Auto-filled from market data" value={S0} onChange={setS0} step={0.5} />
            <Field label="Strike price" hint="Where the option pays off (vs current price)" value={K} onChange={setK} step={0.5} />
            <Field label="Days to expiry" hint="How long until the option expires" value={days} onChange={setDays} step={1} />
            <Field label="Volatility (annual)" hint="Expected % swing per year — typical equities 25–60%" value={sigma} onChange={setSigma} step={0.01} fmt="pct" />
            <Field label="Risk-free rate" hint="Roughly the Treasury yield — 4–5% lately" value={r} onChange={setR} step={0.0025} fmt="pct" />
            <Field
              label={optionType === 'barrier' ? 'Knock-out barrier' : 'Barrier (off)'}
              hint={optionType === 'barrier' ? 'Option becomes worthless if price crosses this level' : 'Only used for Barrier options'}
              value={barrier ?? ''}
              onChange={(v) => setBarrier(v === '' || v == null ? null : v)}
              step={0.5}
              disabled={optionType !== 'barrier'}
            />
            <Field label="Time steps" hint="Granularity of the price simulation (daily = 252)" value={steps} onChange={setSteps} step={1} />
          </div>
          <div className="mc-row mc-paths-row">
            <span className="mc-row-l">Simulations</span>
            <input
              type="range"
              min="3" max="7" step="0.1"
              value={pathsToSlider(paths)}
              onChange={(e) => setPaths(sliderToPaths(parseFloat(e.target.value)))}
              className="mc-slider"
            />
            <span className="mc-paths-readout">{paths.toLocaleString()} simulated paths</span>
          </div>
        </div>
      </section>

      {/* ── ENGINE + RUN ── */}
      <section className="mc-card fi fi2">
        <div className="card-h"><span className="card-t">Where to run</span></div>
        <div className="mc-engine">
          <label className={`mc-radio ${engine === 'cpu' ? 'a' : ''}`}>
            <input type="radio" name="engine" checked={engine === 'cpu'} onChange={() => setEngine('cpu')} />
            <div>
              <div className="mc-radio-t">Quick · in your browser</div>
              <div className="mc-radio-s">Pure JavaScript · works on any laptop · slower at large simulation counts</div>
            </div>
          </label>
          <label className={`mc-radio ${engine === 'gpu' ? 'a' : ''} ${gpuOffline ? 'off' : ''}`}>
            <input type="radio" name="engine" checked={engine === 'gpu'} onChange={() => setEngine('gpu')} disabled={gpuOffline} />
            <div>
              <div className="mc-radio-t">Fast · AMD MI300X GPU {gpuOffline && <span className="mc-offline-tag">offline</span>}</div>
              <div className="mc-radio-s">PyTorch on ROCm · 192&nbsp;GB HBM3 memory · ~70× faster than CPU</div>
            </div>
          </label>
          <button className="mc-run" onClick={onRun} disabled={!!running}>
            {running ? '▶ Running…' : '▶ Run'}
          </button>
        </div>
        {running && (
          <div className="mc-progress">
            <div className="mc-progress-bar"><div className="mc-progress-fill" style={{ width: `${(progress * 100).toFixed(1)}%` }} /></div>
            <div className="mc-progress-meta">
              <span>{Math.round(progress * 100)}% · {(running === 'cpu' ? 'CPU' : 'MI300X')}</span>
              <span>{fmtMs(elapsed)}</span>
            </div>
          </div>
        )}
        {errorMsg && <div className="err">⚠ {errorMsg}</div>}
      </section>

      {/* ── RESULT ── */}
      <section className="mc-card mc-result fi fi3">
        <div className="card-h">
          <span className="card-t">{result ? (result.source === 'mi300x' ? 'Result · AMD MI300X' : 'Result · browser') : 'Result'}</span>
          <span className="badge b-c">{paths.toLocaleString()} simulations · {steps} steps</span>
        </div>
        {!result && !running && <div className="loading" style={{ padding: 28 }}>Set up the option above and hit Run.</div>}
        {result && (
          <div className="mc-result-grid">
            <ResultCell label="Estimated fair price" value={`$${fmtNum(result.price, 4)}`} hint={`± $${fmtNum(result.stderr, 4)} (95% confidence)`} accent="#00f59b" />
            <ResultCell label="How long it took" value={fmtMs(result.runtimeMs)} hint={`${(paths * steps).toLocaleString()} random walks`} accent="#00d4ff" />
            <ResultCell label="Speed" value={fmtThroughput(result.pathsPerSec)} hint="simulated steps per second" accent="#00d4ff" />
            <ResultCell label="Engine" value={result.source === 'mi300x' ? 'AMD MI300X' : 'Browser'} hint={result.source === 'mi300x' ? 'PyTorch · ROCm · 192 GB HBM3' : 'JavaScript · single core'} accent="#9955ff" />
          </div>
        )}
        {speedup != null && (
          <div className="mc-speedup" title={`Last CPU: ${fmtMs(history.cpu.runtimeMs)} · Last GPU: ${fmtMs(history.gpu.runtimeMs)}`}>
            <span className="mc-speedup-bolt">⚡</span>
            <span className="mc-speedup-text">
              MI300X is <b className="mc-speedup-x">{speedup.toFixed(1)}×</b> faster than CPU
              <span className="mc-speedup-sub">(CPU {fmtMs(history.cpu.runtimeMs)} → MI300X {fmtMs(history.gpu.runtimeMs)})</span>
            </span>
          </div>
        )}
      </section>

      {/* ── PATH FAN ── */}
      <section className="mc-card fi fi4">
        <div className="card-h">
          <span className="card-t">100-Path Sample · Median + 5/95 Percentile Bands</span>
          <span className="badge b-p">{viz ? `${viz.samples} paths · ${steps} steps` : 'awaiting run'}</span>
        </div>
        {!viz ? (
          <div className="loading" style={{ padding: 24, fontSize: 11 }}>Run the pricer to render the equity-path fan with 5/50/95 percentile bands.</div>
        ) : (
          <div ref={fanRef} className="mc-conv" />
        )}
      </section>
    </main>
  );
}

// ── Field ──────────────────────────────────────────────────────────────────
function Field({ label, hint, value, onChange, step = 1, fmt = null, disabled = false }) {
  const display = fmt === 'pct' ? `${(value * 100).toFixed(2)}%` : value;
  return (
    <label className={`mc-field ${disabled ? 'd' : ''}`} title={hint || ''}>
      <span className="mc-field-l">
        {label}
        {hint && <span className="mc-field-help" aria-hidden="true">ⓘ</span>}
      </span>
      <div className="mc-field-row">
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
          className="mc-field-i"
        />
        {fmt === 'pct' && <span className="mc-field-pct">{display}</span>}
      </div>
    </label>
  );
}

// ── MCSearchBar ────────────────────────────────────────────────────────────
// Always-visible ticker search at the top of the MC page. Showing the current
// ticker as the placeholder makes it obvious that users CAN switch — the
// click-to-edit badge we tried first wasn't discoverable enough for retail.
function MCSearchBar({ value, onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!q) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/data_pages/search?q=${encodeURIComponent(q)}`);
        const d = await r.json();
        setResults(Array.isArray(d?.results) ? d.results : []);
        setOpen(true);
      } catch { setResults([]); }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const choose = (sym) => { onPick(sym); setQ(''); setResults([]); setOpen(false); };

  return (
    <div className="mc-search" ref={wrapRef}>
      <span className="mc-search-icon">⌕</span>
      <input
        className="mc-search-input"
        value={q}
        placeholder={`Search ticker for the option · currently ${value}`}
        onChange={(e) => setQ(e.target.value.toUpperCase())}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && q.trim()) { e.preventDefault(); choose(q.trim()); }
          else if (e.key === 'Escape') { setQ(''); setOpen(false); }
        }}
        spellCheck={false}
      />
      <span className="mc-search-current">{value}</span>
      {open && results.length > 0 && (
        <div className="mc-search-dd">
          {results.slice(0, 10).map((r) => (
            <div key={r.symbol} className="mc-search-i" onMouseDown={() => choose(r.symbol)}>
              <span className="mc-search-i-sym">{r.symbol}</span>
              <span className="mc-search-i-name">{r.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultCell({ label, value, hint, accent }) {
  return (
    <div className="mc-rc">
      <div className="mc-rc-l">{label}</div>
      <div className="mc-rc-v" style={{ color: accent }}>{value}</div>
      <div className="mc-rc-h">{hint}</div>
    </div>
  );
}
