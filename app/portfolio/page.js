'use client';
import { useState, useEffect, useRef, Suspense } from 'react';

const Load = ({ t = 'Loading...' }) => <div className="loading"><div className="spinner" />{t}</div>;
const Err = ({ m }) => <div className="err">⚠ {m}</div>;
const fmt2 = (n) => (n == null || isNaN(n) ? '—' : (n * 100).toFixed(2) + '%');
const fmtNum = (n, d = 3) => (n == null || isNaN(n) ? '—' : n.toFixed(d));

export default function PortfolioPage() {
  return (
    <Suspense fallback={<div className="loading"><div className="spinner" />Loading portfolio…</div>}>
      <PortfolioInner />
    </Suspense>
  );
}

function PortfolioInner() {
  const [plotlyReady, setPlotlyReady] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.Plotly) { setPlotlyReady(true); return; }
    const t = setInterval(() => { if (window.Plotly) { setPlotlyReady(true); clearInterval(t); } }, 100);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="dash">
      <header className="topbar">
        <div className="topbar-l">
          <span className="brand">PORTFOLIO<span className="brand-dot" /></span>
          <span className="topbar-date">Efficient Frontier · Walk-Forward Backtest</span>
        </div>
      </header>

      <div className="warn">⚠ Daily closes via Yahoo Finance · log-return Markowitz w/ box constraints · backtest assumes T+1 close fills · not advice</div>

      <FrontierSection plotlyReady={plotlyReady} />
      <BacktestSection plotlyReady={plotlyReady} />
    </main>
  );
}

// ── Section 1: Efficient Frontier ─────────────────────────────────────────

function FrontierSection({ plotlyReady }) {
  const [tickers, setTickers] = useState('AAPL,MSFT,NVDA,GLD,TLT');
  const [startYear, setStartYear] = useState(2018);
  const [endYear, setEndYear] = useState(new Date().getFullYear());
  const [objective, setObjective] = useState('max_sharpe');
  const [target, setTarget] = useState(0.10);
  const [bounds, setBounds] = useState({}); // { TICKER: [lo, hi] }
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const chartRef = useRef(null);

  const tickList = tickers.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);

  const setBound = (t, idx, val) => {
    setBounds((prev) => {
      const cur = prev[t] || [0, 1];
      const next = [...cur];
      next[idx] = isNaN(parseFloat(val)) ? next[idx] : parseFloat(val);
      return { ...prev, [t]: next };
    });
  };

  // Live feasibility: sum of mins must be ≤ 1, sum of maxes must be ≥ 1.
  const sumLow = tickList.reduce((s, t) => s + (bounds[t]?.[0] ?? 0), 0);
  const sumHigh = tickList.reduce((s, t) => s + (bounds[t]?.[1] ?? 1), 0);
  const feasible = sumLow <= 1 + 1e-6 && sumHigh >= 1 - 1e-6;

  const run = async () => {
    setLoading(true); setErr(null); setResult(null);
    try {
      const r = await fetch('/data_pages/portfolio/frontier', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tickers: tickList,
          start: `${startYear}-01-01`,
          end: `${endYear}-12-31`,
          objective,
          target: objective === 'target_return' ? target : null,
          bounds,
        }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
      setResult(d);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!plotlyReady || !chartRef.current || !result?.frontier) return;
    const fr = result.frontier;
    const opt = result.optimal;
    const tan = result.tangency;
    const rf = result.rf ?? 0.04;

    // Capital Allocation Line: y = rf + sharpe * x. Extend slightly past the
    // tangency portfolio to show that you can lever up the tangent.
    const maxVol = Math.max(...fr.map((p) => p.vol), ...result.assets.map((a) => a.sigma)) * 1.05;
    const calX = tan ? [0, maxVol] : null;
    const calY = tan ? [rf, rf + tan.sharpe * maxVol] : null;

    const traces = [
      // Full frontier (parabola, both halves)
      {
        x: fr.map((p) => p.vol), y: fr.map((p) => p.ret),
        type: 'scatter', mode: 'lines', name: 'Efficient Frontier',
        line: { color: '#00d4ff', width: 2.5, shape: 'spline' },
        hovertemplate: 'Vol: %{x:.1%}<br>Ret: %{y:.1%}<extra></extra>',
      },
    ];

    // Capital Allocation Line (tangent from rf through tangency portfolio)
    if (tan) traces.push({
      x: calX, y: calY,
      type: 'scatter', mode: 'lines', name: 'Best possible CAL',
      line: { color: '#88ccff', width: 1.5, dash: 'solid' },
      hovertemplate: 'CAL · slope = %{customdata:.3f}<extra></extra>',
      customdata: calX.map(() => tan.sharpe),
    });

    // Tangency portfolio (red dot, like the textbook)
    if (tan) traces.push({
      x: [tan.vol], y: [tan.ret],
      type: 'scatter', mode: 'markers+text',
      name: 'Tangency Portfolio',
      text: ['Tangency Portfolio'], textposition: 'top left',
      textfont: { size: 11, color: '#a0a0b4', family: 'Geist Mono' },
      marker: { size: 14, color: '#ff3355', line: { color: '#fff', width: 1.5 } },
      hovertemplate: `Tangency<br>Vol: %{x:.1%}<br>Ret: %{y:.1%}<br>Sharpe: ${tan.sharpe}<extra></extra>`,
    });

    // Selected portfolio (only show if user picked something other than max_sharpe)
    if (objective !== 'max_sharpe' && opt && (Math.abs(opt.vol - (tan?.vol ?? 0)) > 1e-4 || Math.abs(opt.ret - (tan?.ret ?? 0)) > 1e-4)) {
      traces.push({
        x: [opt.vol], y: [opt.ret],
        type: 'scatter', mode: 'markers', name: `Selected (${objective})`,
        marker: { size: 14, color: '#00f59b', symbol: 'star', line: { color: '#fff', width: 1 } },
        hovertemplate: `Selected<br>Vol: %{x:.1%}<br>Ret: %{y:.1%}<br>Sharpe: ${opt.sharpe}<extra></extra>`,
      });
    }

    // Individual assets (orange diamonds)
    traces.push({
      x: result.assets.map((a) => a.sigma), y: result.assets.map((a) => a.mu),
      text: result.assets.map((a) => a.ticker),
      type: 'scatter', mode: 'markers+text', name: 'Individual Assets',
      textposition: 'top right',
      textfont: { size: 10, color: '#a0a0b4', family: 'Geist Mono' },
      marker: { size: 11, color: '#ff8833', symbol: 'diamond', line: { color: '#fff', width: 0.5 } },
      hovertemplate: '%{text}<br>Vol: %{x:.1%}<br>Ret: %{y:.1%}<extra></extra>',
    });

    // Risk-free rate marker on the y-axis (x=0)
    traces.push({
      x: [0], y: [rf],
      type: 'scatter', mode: 'markers+text',
      name: 'risk free rate',
      text: ['risk-free rate'], textposition: 'middle right',
      textfont: { size: 10, color: '#a0a0b4', family: 'Geist Mono' },
      marker: { size: 8, color: '#9955ff', symbol: 'circle', line: { color: '#fff', width: 1 } },
      hovertemplate: `r_f = ${(rf * 100).toFixed(1)}%<extra></extra>`,
    });

    window.Plotly.newPlot(chartRef.current, traces, {
      paper_bgcolor: '#111117', plot_bgcolor: '#111117',
      font: { color: '#a0a0b4', family: 'Geist Mono', size: 10 },
      margin: { l: 70, r: 20, t: 32, b: 60 },
      title: { text: 'Efficient Frontier · annualized log-returns', font: { size: 12, color: '#a0a0b4' } },
      xaxis: {
        title: 'Standard Deviation (σ)',
        tickformat: '.0%',
        gridcolor: '#282835',
        zerolinecolor: '#3a3a4a',
        rangemode: 'tozero',
      },
      yaxis: {
        title: 'Expected Return (μ)',
        tickformat: '.0%',
        gridcolor: '#282835',
        zerolinecolor: '#3a3a4a',
      },
      legend: { font: { size: 10, color: '#a0a0b4' }, orientation: 'h', y: -0.22 },
      showlegend: true,
    }, { responsive: true, displayModeBar: false });
  }, [result, plotlyReady, objective]);

  return (
    <div className="fi fi1" style={{ padding: '0 18px 18px' }}>
      <div className="card">
        <div className="card-h"><span className="card-t">Section 1 · Efficient Frontier</span><span className="badge b-c">MARKOWITZ</span></div>
        <div className="card-b">
          {/* Inputs */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto', gap: 10, alignItems: 'end', marginBottom: 14 }}>
            <Field label="Tickers (comma-separated)">
              <input className="port-in" value={tickers} onChange={(e) => setTickers(e.target.value.toUpperCase())} />
            </Field>
            <Field label="Start year">
              <input type="number" className="port-in" value={startYear} onChange={(e) => setStartYear(parseInt(e.target.value, 10))} />
            </Field>
            <Field label="End year">
              <input type="number" className="port-in" value={endYear} onChange={(e) => setEndYear(parseInt(e.target.value, 10))} />
            </Field>
            <Field label="Objective">
              <select className="port-in" value={objective} onChange={(e) => setObjective(e.target.value)}>
                <option value="max_sharpe">Max Sharpe</option>
                <option value="min_vol">Min Volatility</option>
                <option value="target_return">Target Return</option>
              </select>
            </Field>
            <Field label="Target ret (if used)">
              <input type="number" step="0.01" className="port-in" value={target} onChange={(e) => setTarget(parseFloat(e.target.value))} disabled={objective !== 'target_return'} />
            </Field>
            <button className="tf a" onClick={run} disabled={loading || tickList.length < 2 || !feasible}>{loading ? 'Solving…' : 'Solve'}</button>
          </div>

          {/* Bounds + result table */}
          <table className="dt">
            <thead>
              <tr>
                <th>Asset</th>
                <th>μ (annual)</th>
                <th>σ (annual)</th>
                <th>Min Weight</th>
                <th>Max Weight</th>
                <th>Optimal Allocation</th>
              </tr>
            </thead>
            <tbody>
              {tickList.map((t) => {
                const a = result?.assets?.find((x) => x.ticker === t);
                const b = bounds[t] || [0, 1];
                return (
                  <tr key={t}>
                    <td><b>{t}</b></td>
                    <td className={a?.mu >= 0 ? 'vg' : 'vr'}>{a ? fmt2(a.mu) : '—'}</td>
                    <td className="vc">{a ? fmt2(a.sigma) : '—'}</td>
                    <td>
                      <input className="port-in port-in-sm" type="number" step="0.05" min="0" max="1"
                        value={b[0]} onChange={(e) => setBound(t, 0, e.target.value)} />
                    </td>
                    <td>
                      <input className="port-in port-in-sm" type="number" step="0.05" min="0" max="1"
                        value={b[1]} onChange={(e) => setBound(t, 1, e.target.value)} />
                    </td>
                    <td className="vp"><b>{a ? fmt2(a.weight) : '—'}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Live feasibility readout */}
          <div style={{ marginTop: 10, fontSize: 11, fontFamily: 'var(--mono)', display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <span>Σ min: <b className={sumLow <= 1 + 1e-6 ? 'vg' : 'vr'}>{sumLow.toFixed(3)}</b> <span style={{ color: 'var(--ash)' }}>(≤ 1)</span></span>
            <span>Σ max: <b className={sumHigh >= 1 - 1e-6 ? 'vg' : 'vr'}>{sumHigh.toFixed(3)}</b> <span style={{ color: 'var(--ash)' }}>(≥ 1)</span></span>
            {!feasible && <span className="vr">Bounds infeasible — adjust min/max so weights can sum to 1.0</span>}
          </div>

          {err && <div style={{ marginTop: 10 }}><Err m={err} /></div>}

          {result && (
            <div style={{ display: 'flex', gap: 18, fontSize: 11, fontFamily: 'var(--mono)', marginTop: 14, flexWrap: 'wrap' }}>
              <span>Vol: <b className="vc">{fmt2(result.optimal.vol)}</b></span>
              <span>Return: <b className={result.optimal.ret >= 0 ? 'vg' : 'vr'}>{fmt2(result.optimal.ret)}</b></span>
              <span>Sharpe: <b className="vp">{fmtNum(result.optimal.sharpe)}</b></span>
              <span style={{ color: 'var(--ash)' }}>Period: {result.period?.start} → {result.period?.end} ({result.period?.days}d)</span>
            </div>
          )}

          <div ref={chartRef} style={{ height: 720, marginTop: 14 }} />
        </div>
      </div>

      <style jsx>{`
        .port-in {
          background: #18181f; border: 1px solid #282835; color: #cfcfdc;
          padding: 6px 10px; font-family: var(--mono); font-size: 11px;
          border-radius: 6px; width: 100%; min-width: 0;
        }
        .port-in:focus { outline: none; border-color: var(--neon-cyan); }
        .port-in-sm { padding: 4px 6px; width: 80px; }
      `}</style>
    </div>
  );
}

// ── Section 2: Backtest ────────────────────────────────────────────────────

function BacktestSection({ plotlyReady }) {
  const [rows, setRows] = useState([
    { ticker: 'AAPL', weight: 0.4 },
    { ticker: 'MSFT', weight: 0.3 },
    { ticker: 'GLD', weight: 0.3 },
  ]);
  const [startYear, setStartYear] = useState(2018);
  const [endYear, setEndYear] = useState(new Date().getFullYear());
  const [costBps, setCostBps] = useState(5);
  const [t1, setT1] = useState(true);
  const [rebalance, setRebalance] = useState('monthly');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const chartRef = useRef(null);

  const setRow = (i, key, val) => {
    setRows((prev) => prev.map((r, k) => k === i ? { ...r, [key]: key === 'weight' ? parseFloat(val) || 0 : val.toUpperCase() } : r));
  };
  const addRow = () => setRows((p) => [...p, { ticker: '', weight: 0 }]);
  const delRow = (i) => setRows((p) => p.filter((_, k) => k !== i));

  const totalWeight = rows.reduce((s, r) => s + (r.weight || 0), 0);

  const run = async () => {
    setLoading(true); setErr(null); setResult(null);
    try {
      const tickers = rows.map((r) => r.ticker).filter(Boolean);
      const weights = {};
      rows.forEach((r) => { if (r.ticker) weights[r.ticker.toUpperCase()] = r.weight; });
      const r = await fetch('/data_pages/portfolio/backtest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tickers, weights,
          start: `${startYear}-01-01`,
          end: `${endYear}-12-31`,
          costBps, t1, rebalance,
        }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
      setResult(d);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!plotlyReady || !chartRef.current || !result?.equity) return;
    const eq = result.equity;
    // Drawdown trace.
    let peak = eq[0].v;
    const dd = eq.map((p) => { peak = Math.max(peak, p.v); return p.v / peak - 1; });
    window.Plotly.newPlot(chartRef.current, [
      {
        x: eq.map((p) => p.d), y: eq.map((p) => p.v),
        type: 'scatter', mode: 'lines', name: 'NAV',
        line: { color: '#00f59b', width: 2 },
        fill: 'tozeroy', fillcolor: 'rgba(0,245,155,0.08)',
        hovertemplate: '%{x}<br>NAV: %{y:.4f}x<extra></extra>',
      },
      {
        x: eq.map((p) => p.d), y: dd,
        type: 'scatter', mode: 'lines', name: 'Drawdown',
        yaxis: 'y2',
        line: { color: '#ff3355', width: 1 },
        hovertemplate: '%{x}<br>DD: %{y:.1%}<extra></extra>',
      },
    ], {
      paper_bgcolor: '#111117', plot_bgcolor: '#111117',
      font: { color: '#a0a0b4', family: 'Geist Mono', size: 10 },
      margin: { l: 60, r: 60, t: 32, b: 50 },
      title: { text: 'Walk-Forward Equity Curve · NAV (left) · Drawdown (right)', font: { size: 12, color: '#a0a0b4' } },
      xaxis: { gridcolor: '#282835' },
      yaxis: { title: 'NAV (×)', gridcolor: '#282835' },
      yaxis2: { title: 'Drawdown', overlaying: 'y', side: 'right', tickformat: '.0%', range: [Math.min(...dd) * 1.5, 0.02], gridcolor: 'transparent' },
      legend: { font: { size: 10, color: '#a0a0b4' }, orientation: 'h', y: -0.18 },
    }, { responsive: true, displayModeBar: false });
  }, [result, plotlyReady]);

  return (
    <div className="fi fi2" style={{ padding: '0 18px 24px' }}>
      <div className="card">
        <div className="card-h"><span className="card-t">Section 2 · Walk-Forward Backtest</span><span className="badge b-g">T+1 · COST DRAG</span></div>
        <div className="card-b">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr auto', gap: 10, alignItems: 'end', marginBottom: 14 }}>
            <Field label="Start year">
              <input type="number" className="port-in" value={startYear} onChange={(e) => setStartYear(parseInt(e.target.value, 10))} />
            </Field>
            <Field label="End year">
              <input type="number" className="port-in" value={endYear} onChange={(e) => setEndYear(parseInt(e.target.value, 10))} />
            </Field>
            <Field label="Cost (bps/trade)">
              <input type="number" className="port-in" value={costBps} onChange={(e) => setCostBps(parseFloat(e.target.value) || 0)} />
            </Field>
            <Field label="Rebalance">
              <select className="port-in" value={rebalance} onChange={(e) => setRebalance(e.target.value)}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </Field>
            <Field label="T+1 execution">
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, fontFamily: 'var(--mono)', color: '#cfcfdc' }}>
                <input type="checkbox" checked={t1} onChange={(e) => setT1(e.target.checked)} />
                Signals trade at next close
              </label>
            </Field>
            <button className="tf a" onClick={run} disabled={loading || rows.length < 1}>{loading ? 'Running…' : 'Backtest'}</button>
          </div>

          <table className="dt">
            <thead>
              <tr><th>Ticker</th><th>Weight</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><input className="port-in port-in-sm" value={r.ticker} onChange={(e) => setRow(i, 'ticker', e.target.value)} placeholder="AAPL" /></td>
                  <td><input className="port-in port-in-sm" type="number" step="0.05" value={r.weight} onChange={(e) => setRow(i, 'weight', e.target.value)} /></td>
                  <td><button className="tf" onClick={() => delRow(i)}>×</button></td>
                </tr>
              ))}
              <tr>
                <td colSpan={3}>
                  <button className="tf" onClick={addRow}>+ Add ticker</button>
                  <span style={{ marginLeft: 14, fontSize: 11, color: Math.abs(totalWeight - 1) > 0.01 ? 'var(--neon-red)' : 'var(--neon-green)' }}>
                    Σ weights = {totalWeight.toFixed(3)} {Math.abs(totalWeight - 1) > 0.01 ? '(must equal 1.0)' : '✓'}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          {err && <div style={{ marginTop: 10 }}><Err m={err} /></div>}

          {result?.stats && (
            <div className="rg" style={{ marginTop: 14 }}>
              <div className="rb"><div className="rb-l">Total Return</div><div className={`rb-v ${result.stats.totalReturn >= 0 ? 'vg' : 'vr'}`}>{fmt2(result.stats.totalReturn)}</div></div>
              <div className="rb"><div className="rb-l">Max DD</div><div className="rb-v vr">{fmt2(result.stats.maxDD)}</div></div>
              <div className="rb"><div className="rb-l">Sharpe</div><div className="rb-v vp">{fmtNum(result.stats.sharpe)}</div></div>
              <div className="rb"><div className="rb-l">Annual Vol</div><div className="rb-v vc">{fmt2(result.stats.vol)}</div></div>
              <div className="rb"><div className="rb-l">Final NAV</div><div className="rb-v">{fmtNum(result.stats.finalNav, 4)}×</div></div>
              <div className="rb"><div className="rb-l">Rebalances</div><div className="rb-v">{result.stats.nRebalances}</div></div>
            </div>
          )}

          <div ref={chartRef} style={{ height: 720, marginTop: 14 }} />
        </div>
      </div>

      <style jsx>{`
        .port-in {
          background: #18181f; border: 1px solid #282835; color: #cfcfdc;
          padding: 6px 10px; font-family: var(--mono); font-size: 11px;
          border-radius: 6px; width: 100%; min-width: 0;
        }
        .port-in:focus { outline: none; border-color: var(--neon-cyan); }
        .port-in-sm { padding: 4px 6px; width: 100px; }
      `}</style>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 9, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
      {children}
    </div>
  );
}