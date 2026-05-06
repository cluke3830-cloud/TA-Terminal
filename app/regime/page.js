'use client';

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { fmtDate, fmtTime, Load, Err } from '../components/ui';

// ═══════════════════════════════════════════════════════════════════════════════
//  QUANTUM TERMINAL — MARKET REGIME ENGINE
//  Front-end for regime_dashboard.py (HMM + LSTM + Attention + TransDet)
// ═══════════════════════════════════════════════════════════════════════════════

const PLOT_CONFIG = { displayModeBar: false, responsive: true };

// Override the engine's dark theme to match the rest of the terminal so
// the page doesn't look like a transplanted iframe. We only touch chrome
// (bg, font), never trace styling.
function patchLayout(layout) {
  if (!layout) return layout;
  return {
    ...layout,
    paper_bgcolor: '#0b0b10',
    plot_bgcolor: '#0b0b10',
    font: { color: '#7a7a90', family: 'Geist Mono', size: 11, ...(layout.font || {}) },
    margin: { l: 55, r: 25, t: 36, b: 40, ...(layout.margin || {}) },
  };
}

function Plot({ fig, height = 360, plotlyReady }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!plotlyReady || !ref.current || !fig) return;
    const layout = patchLayout(fig.layout);
    if (height) layout.height = height;
    window.Plotly.react(ref.current, fig.data || [], layout, PLOT_CONFIG);
  }, [plotlyReady, fig, height]);

  return <div ref={ref} className="rg-plot" style={{ height: height ? `${height}px` : '360px' }} />;
}

function confidenceMeta(conf) {
  if (conf == null || !isFinite(conf)) return { color: '#666', label: 'n/a' };
  if (conf < 0.50) return { color: '#ff6633', label: 'low' };
  if (conf < 0.70) return { color: '#ffaa33', label: 'moderate' };
  return { color: '#00f59b', label: 'high' };
}

function allocationText(r, tdir, meta) {
  if (!meta) return '—';
  const a = meta.regimeAlloc?.[r];
  if (a !== null && a !== undefined) {
    const sign = a >= 0 ? '+' : '';
    return `Target exposure: ${sign}${(a * 100).toFixed(0)}%`;
  }
  // Volatile Trend — dynamic
  const up = meta.voltrdUp, dn = meta.voltrdDown, thr = meta.voltrdThresh;
  if (tdir == null || !isFinite(tdir)) {
    return `Target exposure: dynamic (+${(dn * 100).toFixed(0)}% ↔ +${(up * 100).toFixed(0)}%)`;
  }
  if (tdir >= thr) return `Target exposure: +${(up * 100).toFixed(0)}% (uptrend, tdir=${tdir.toFixed(2)})`;
  return `Target exposure: +${(dn * 100).toFixed(0)}% (downtrend, tdir=${tdir.toFixed(2)})`;
}

function modelTag(info) {
  const parts = ['Rules'];
  if (info.has_hmm) parts.push('HMM');
  if (info.has_lstm) parts.push('LSTM+Attn');
  if (info.has_trans) parts.push('TransDet');
  return parts.join(' + ');
}

function HeroPanel({ ticker, info, meta }) {
  if (!info || !meta) return null;
  const r = info.cur;
  const name = meta.regimeNames?.[r] ?? `Regime ${r}`;
  const rcol = meta.regimeColors?.[r] ?? '#888';
  const desc = meta.regimeDescriptions?.[r] ?? '';
  const action = meta.regimeActions?.[r] ?? '';

  const conf = info.conf ?? 0;
  const cm = confidenceMeta(conf);

  const fcast1 = info.fcast?.[1] || info.fcast?.['1'];
  const fcast5 = info.fcast?.[5] || info.fcast?.['5'];

  const argmax = (arr) => {
    let best = 0, v = -Infinity;
    (arr || []).forEach((x, i) => { if (x != null && x > v) { v = x; best = i; } });
    return [best, v];
  };
  const [n1, p1] = fcast1 ? argmax(fcast1) : [r, 0];
  const [n5, p5] = fcast5 ? argmax(fcast5) : [r, 0];

  const sharpe = info.sm?.sharpe;
  const sharpeText = sharpe != null && isFinite(sharpe) ? sharpe.toFixed(2) : 'n/a';
  const sharpeCol = sharpe == null || !isFinite(sharpe)
    ? '#666'
    : sharpe >= 0.8 ? '#00f59b'
    : sharpe >= 0.4 ? '#ffaa33' : '#ff6633';

  const calib = info.calibration || {};
  const hasCal = calib.ece_cal_test != null;
  const calText = hasCal
    ? `ECE ${calib.ece_cal_test.toFixed(3)} (raw ${calib.ece_raw_test?.toFixed(3) ?? '—'})`
    : 'n/a';
  const calCol = !hasCal ? '#666'
    : calib.ece_cal_test <= calib.ece_raw_test ? '#00f59b' : '#ffaa33';

  const tm = info.trans_metrics || {};
  const m5 = tm['thr_0.5'];
  const tdText = m5
    ? `F1 ${m5.f1.toFixed(2)} (P ${(m5.precision * 100).toFixed(0)}% / R ${(m5.recall * 100).toFixed(0)}%)`
    : 'n/a';
  const tdCol = !m5 ? '#666'
    : m5.f1 >= 0.55 ? '#00f59b'
    : m5.f1 >= 0.40 ? '#ffaa33' : '#ff6633';

  const durText = info.exp_remain != null && isFinite(info.exp_remain)
    ? `~${info.exp_remain.toFixed(0)}d remaining` : 'n/a';

  return (
    <div className="rg-hero">
      <div className="rg-hero-l" style={{ borderLeftColor: rcol }}>
        <div className="rg-hero-tag">{ticker} · {info.last_date || ''}</div>
        <div className="rg-hero-name" style={{ color: rcol }}>{name}</div>
        <div className="rg-hero-desc">{desc}</div>

        <div className="rg-hero-conf">
          <div className="rg-hero-conf-row">
            <span className="rg-lbl">Confidence</span>
            <span style={{ color: cm.color, fontWeight: 700, fontSize: 13 }}>{(conf * 100).toFixed(0)}%</span>
            <span className="rg-fog" style={{ fontSize: 11, marginLeft: 4 }}>({cm.label})</span>
          </div>
          <div className="rg-bar"><div className="rg-bar-f" style={{ width: `${Math.max(0, Math.min(1, conf)) * 100}%`, background: cm.color }} /></div>
        </div>

        <div className="rg-hero-action">
          <div className="rg-lbl">Recommended action</div>
          <div className="rg-hero-action-t">{action}</div>
          <div className="rg-hero-action-a">{allocationText(r, info.tdir_n, meta)}</div>
        </div>

        <div className="rg-hero-meta">
          <div><span className="rg-fog">Days in regime: </span><b>{info.days_in ?? 0}</b></div>
          <div><span className="rg-fog">Expected: </span><b>{durText}</b></div>
          <div><span className="rg-fog">Models: </span><b>{modelTag(info)}</b></div>
          <div style={{ marginTop: 6 }}>
            <span style={{ background: 'rgba(237,28,36,0.1)', color: '#ED1C24', border: '1px solid rgba(237,28,36,0.25)', borderRadius: 4, padding: '2px 8px', fontSize: 9, fontWeight: 700, letterSpacing: '.6px', fontFamily: 'var(--mono)' }}>AMD MI300X · ROCm 7.1</span>
          </div>
        </div>
      </div>

      <div className="rg-hero-r">
        <Stat label="Next-Bar Forecast" value={`${meta.regimeNames?.[n1] ?? '—'}  (${(p1 * 100).toFixed(0)}%)`} color={meta.regimeColors?.[n1]} />
        <Stat label="5-Bar Forecast" value={`${meta.regimeNames?.[n5] ?? '—'}  (${(p5 * 100).toFixed(0)}%)`} color={meta.regimeColors?.[n5]} />
        <Stat label="Ensemble Sharpe" value={sharpeText} color={sharpeCol} />
        <Stat label="Calibration (OOS)" value={calText} color={calCol} />
        <Stat label="Transition Detector" value={tdText} color={tdCol} span={2} />
      </div>
    </div>
  );
}

function Stat({ label, value, color = '#e8ecf1', span = 1 }) {
  return (
    <div className="rg-stat" style={span === 2 ? { gridColumn: '1 / span 2' } : undefined}>
      <div className="rg-lbl">{label}</div>
      <div className="rg-stat-v" style={{ color }}>{value}</div>
    </div>
  );
}

function ProgressNote({ elapsed }) {
  const phase = elapsed < 5
    ? 'Fetching data from Yahoo + FRED…'
    : elapsed < 25
    ? 'Computing 21-feature matrix + cross-asset correlations…'
    : elapsed < 70
    ? 'Fitting walk-forward HMM (4 regimes, diag covariance)…'
    : elapsed < 150
    ? 'Training LSTM + multi-head attention (30-bar sequences)…'
    : 'Calibrating ensemble + transition detector…';
  return (
    <div className="rg-loading">
      <div className="spinner" />
      <div className="rg-loading-t">
        <div style={{ fontSize: 14, color: 'var(--cloud)', fontFamily: 'var(--mono)', letterSpacing: 0.4 }}>{phase}</div>
        <div style={{ fontSize: 11, color: 'var(--smoke)', marginTop: 4, fontFamily: 'var(--mono)' }}>
          Elapsed {elapsed.toFixed(0)}s · First run on a new ticker takes 2-3 min · subsequent runs are cached.
        </div>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ background: 'rgba(237,28,36,0.12)', color: '#ED1C24', border: '1px solid rgba(237,28,36,0.25)', borderRadius: 4, padding: '2px 8px', fontSize: 9, fontWeight: 700, letterSpacing: '.8px', fontFamily: 'var(--mono)' }}>AMD INSTINCT MI300X</span>
          <span style={{ fontSize: 10, color: 'var(--smoke)', fontFamily: 'var(--mono)' }}>192GB HBM3 · ROCm 7.1 · BF16 inference</span>
        </div>
      </div>
    </div>
  );
}

export default function RegimePage() {
  return (
    <Suspense fallback={<div className="loading"><div className="spinner" />Loading regime engine…</div>}>
      <RegimePageInner />
    </Suspense>
  );
}

function RegimePageInner() {
  const searchParams = useSearchParams();
  const initialSym = (searchParams.get('sym') || searchParams.get('ticker') || 'SPY').toUpperCase();

  const [ticker, setTicker] = useState(initialSym);
  const [input, setInput] = useState(initialSym);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [offline, setOffline] = useState(false);
  const [plotlyReady, setPlotlyReady] = useState(false);
  const [clock, setClock] = useState('');
  const [startedAt, setStartedAt] = useState(null);
  const [now, setNow] = useState(Date.now());

  // Plotly readiness
  useEffect(() => {
    if (typeof window !== 'undefined' && window.Plotly) { setPlotlyReady(true); return; }
    const t = setInterval(() => {
      if (typeof window !== 'undefined' && window.Plotly) { setPlotlyReady(true); clearInterval(t); }
    }, 100);
    return () => clearInterval(t);
  }, []);

  // Live clock + elapsed timer
  useEffect(() => {
    setClock(fmtTime());
    const t = setInterval(() => { setClock(fmtTime()); setNow(Date.now()); }, 1000);
    return () => clearInterval(t);
  }, []);

  const fetchRegime = useCallback(async (sym, force = false) => {
    setLoading(true); setError(null); setOffline(false); setStartedAt(Date.now());
    try {
      const url = `/data_pages/regime/run?ticker=${encodeURIComponent(sym)}${force ? '&force=1' : ''}`;
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) {
        if (j?.offline) setOffline(true);
        throw new Error(j?.error || j?.detail || `HTTP ${r.status}`);
      }
      setData(j);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false); setStartedAt(null);
    }
  }, []);

  useEffect(() => { fetchRegime(ticker); }, [ticker, fetchRegime]);

  const onLoad = () => {
    const next = (input || '').toUpperCase().trim();
    if (!next) return;
    if (next === ticker) fetchRegime(next, true);
    else setTicker(next);
  };

  const elapsed = startedAt ? (now - startedAt) / 1000 : 0;

  const figs = data?.figs || {};
  const info = data?.info;
  const meta = data?.meta;

  return (
    <>
      <header className="topbar">
        <div className="topbar-l">
          <span className="brand">Regime Engine<span className="brand-dot" /></span>
          <span className="topbar-date">{fmtDate()} · {clock}</span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--smoke)' }}>
          <span className="ld" /><span className="ll">HMM + LSTM + Attention</span>
          <span style={{ background: 'rgba(237,28,36,0.12)', color: '#ED1C24', border: '1px solid rgba(237,28,36,0.3)', borderRadius: 4, padding: '2px 8px', fontSize: 9, fontWeight: 700, letterSpacing: '.8px' }}>AMD MI300X · ROCm 7.1</span>
        </div>
      </header>

      <div className="warn">⚠ Yahoo + FRED data · 4-regime classifier · 3-way ensemble · Research only · Not investment advice</div>

      <main className="regime-dash">
        <div className="rg-hero-strip fi">
          <div>
            <h1 className="rg-title">Market <span>Regime Intelligence</span></h1>
            <div className="rg-sub">21-feature classifier · HMM + LSTM ensemble · Survival-based duration · Transition detection</div>
          </div>
          <div className="rg-input-box">
            <input
              className="rg-input"
              placeholder="Ticker"
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter') onLoad(); }}
              disabled={loading}
            />
            <button className="rg-btn rg-btn-load" onClick={onLoad} disabled={loading}>
              {loading ? 'Loading…' : 'Load'}
            </button>
            <button className="rg-btn rg-btn-refresh" onClick={() => fetchRegime(ticker, true)} disabled={loading}>↻ Force Refresh</button>
          </div>
        </div>

        {offline && (
          <div className="rg-offline fi">
            <div className="rg-offline-t">Regime engine offline</div>
            <div className="rg-offline-d">
              Set <code>REGIME_API_URL</code> (or <code>MC_GPU_URL</code>) to the FastAPI service running <code>gpu-service/main.py</code>.
              From the repo: <code>cd gpu-service && uvicorn main:app --port 8000</code>, then add <code>REGIME_API_URL=http://localhost:8000</code> to <code>.env.local</code>.
            </div>
          </div>
        )}

        {error && !offline && <Err m={error} />}

        {loading && !data && <ProgressNote elapsed={elapsed} />}

        {info && meta && <HeroPanel ticker={data.ticker} info={info} meta={meta} />}

        {figs.time && (
          <section className="rg-section fi">
            <div className="rg-section-h"><span className="rg-section-num">01</span>Regime Timeline · {data?.ticker}</div>
            <Plot fig={figs.time} height={420} plotlyReady={plotlyReady} />
          </section>
        )}

        {figs.probs && (
          <section className="rg-section fi">
            <div className="rg-section-h"><span className="rg-section-num">02</span>Regime Probabilities · Stacked</div>
            <Plot fig={figs.probs} height={320} plotlyReady={plotlyReady} />
          </section>
        )}

        {(figs.phase || figs.graph || figs.heat) && (
          <div className="rg-grid3">
            {figs.phase && (
              <section className="rg-section fi">
                <div className="rg-section-h"><span className="rg-section-num">03</span>Phase Space (PCA)</div>
                <Plot fig={figs.phase} height={380} plotlyReady={plotlyReady} />
              </section>
            )}
            {figs.graph && (
              <section className="rg-section fi">
                <div className="rg-section-h"><span className="rg-section-num">04</span>Transition Graph</div>
                <Plot fig={figs.graph} height={380} plotlyReady={plotlyReady} />
              </section>
            )}
            {figs.heat && (
              <section className="rg-section fi">
                <div className="rg-section-h"><span className="rg-section-num">05</span>Transition Heatmap (T)</div>
                <Plot fig={figs.heat} height={380} plotlyReady={plotlyReady} />
              </section>
            )}
          </div>
        )}

        {figs.perf && (
          <section className="rg-section fi">
            <div className="rg-section-h"><span className="rg-section-num">06</span>Performance · Ensemble vs Rules vs Benchmark</div>
            <Plot fig={figs.perf} height={420} plotlyReady={plotlyReady} />
          </section>
        )}

        <div className="footer">
          DATA · yfinance (daily OHLCV) · FRED (10Y, BAA-AAA, Initial Claims) · CBOE VIX<br />
          ENGINE · regime_dashboard.py v9.4 · 4-regime classifier · 3-way ensemble (Rules + HMM + LSTM)<br />
          <span style={{ color: '#ED1C24', fontWeight: 700 }}>COMPUTE · AMD Instinct MI300X · 192GB HBM3 · ROCm 7.1 · BF16</span><br />
          Research only · Not investment advice
        </div>
      </main>
    </>
  );
}
