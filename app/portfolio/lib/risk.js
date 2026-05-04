// Portfolio risk decomposition: historical/parametric VaR, CVaR, max drawdown,
// beta vs benchmark, and marginal/component VaR per asset.
//
// All math is pure JS over daily simple-return arrays so it stays browser-safe
// if needed and adds no native deps. Inputs are aligned daily closes; we
// intentionally use simple returns (not log) so the additive
//   r_portfolio = Σ wᵢ rᵢ
// identity holds exactly — that's what makes marginal-VaR decomposition work.

const Z = { 90: 1.2816, 95: 1.6449, 99: 2.3263 };

function simpleRet(closes) {
  const r = new Array(closes.length - 1);
  for (let i = 1; i < closes.length; i++) r[i - 1] = closes[i] / closes[i - 1] - 1;
  return r;
}

function mean(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
function variance(a, m = null) {
  const mu = m == null ? mean(a) : m;
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - mu; s += d * d; }
  return s / Math.max(1, a.length - 1);
}
function stdev(a, m = null) { return Math.sqrt(variance(a, m)); }
function covariance(a, b) {
  const ma = mean(a), mb = mean(b);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / Math.max(1, a.length - 1);
}

// p in [0,1]. Linear-interpolated quantile, lower-tail.
function quantile(sortedAsc, p) {
  const n = sortedAsc.length;
  if (n === 0) return null;
  const idx = (n - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

// Build n×n covariance matrix from per-asset return arrays (already aligned).
function covMatrix(rets) {
  const n = rets.length;
  const S = Array.from({ length: n }, () => new Array(n).fill(0));
  const mus = rets.map(mean);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      const ri = rets[i], rj = rets[j], mi = mus[i], mj = mus[j];
      for (let t = 0; t < ri.length; t++) s += (ri[t] - mi) * (rj[t] - mj);
      const c = s / Math.max(1, ri.length - 1);
      S[i][j] = c; S[j][i] = c;
    }
  }
  return { Sigma: S, mu: mus };
}

function matVec(A, x) {
  const n = A.length;
  const y = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += A[i][j] * x[j];
    y[i] = s;
  }
  return y;
}

// Public: compute the full risk report.
//   tickers: ['AAPL', ...]
//   closes:  { AAPL: [...], MSFT: [...], SPY: [...] }  // SPY required for beta
//   weights: { AAPL: 0.4, ... }                         // must sum to 1
//   conf:    0.95 | 0.99
//   portRetSeries: optional realized daily returns (e.g. from backtest NAV).
//     When provided, Sharpe / Max DD / Hist & Param VaR are computed on this
//     series so they match the backtest section exactly. Decomposition still
//     uses the constant-weight covariance (which is what marginal-VaR theory
//     requires).
export function computeRisk({ tickers, closes, weights, benchmark = 'SPY', conf = 0.95, portRetSeries = null }) {
  const confPct = Math.round(conf * 100);
  if (!Z[confPct]) return { error: `unsupported confidence ${conf}` };

  const wArr = tickers.map((t) => Number(weights[t] ?? 0));
  const sumW = wArr.reduce((a, b) => a + b, 0);
  if (Math.abs(sumW - 1) > 0.01) return { error: `weights must sum to 1 (got ${sumW.toFixed(3)})` };

  for (const t of tickers) {
    if (!closes[t] || closes[t].length < 60) return { error: `not enough history for ${t}` };
  }
  const benchSeries = closes[benchmark];
  if (!benchSeries || benchSeries.length < 60) return { error: `benchmark ${benchmark} unavailable` };

  // Build aligned return arrays.
  const rets = tickers.map((t) => simpleRet(closes[t]));
  const benchR = simpleRet(benchSeries);

  // All series share the same length because /data_pages/history aligns to the
  // intersection of trading days before returning closes.
  // Use realized portfolio returns (e.g. from backtest NAV) when provided so
  // the headline stats match the backtest section. Otherwise fall back to the
  // theoretical constant-weight portfolio.
  let portRet;
  if (Array.isArray(portRetSeries) && portRetSeries.length > 0) {
    // Trim/pad to match the asset return length so all derived arrays align.
    const targetLen = rets[0].length;
    portRet = portRetSeries.slice(-targetLen);
    while (portRet.length < targetLen) portRet.unshift(0);
  } else {
    const T0 = rets[0].length;
    portRet = new Array(T0).fill(0);
    for (let i = 0; i < tickers.length; i++) {
      const r = rets[i], w = wArr[i];
      for (let t = 0; t < T0; t++) portRet[t] += w * r[t];
    }
  }
  const T = portRet.length;

  // ── Portfolio-level stats ────────────────────────────────────────────────
  const muP = mean(portRet);
  const sigP = stdev(portRet, muP);
  const z = Z[confPct];

  // Historical VaR/CVaR — losses are positive numbers (so we negate the lower
  // tail of returns).
  const sorted = [...portRet].sort((a, b) => a - b);
  const qLow = quantile(sorted, 1 - conf);          // e.g. 5th percentile
  const histVaR = -qLow;
  const tail = sorted.filter((r) => r <= qLow);
  const histCVaR = tail.length ? -mean(tail) : null;

  // Parametric (Gaussian) VaR/CVaR.
  // CVaR_param = -(μ - σ · φ(z) / (1 - conf))
  const phi = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  const paramVaR = -(muP - z * sigP);
  const paramCVaR = -(muP - sigP * phi / (1 - conf));

  // Max drawdown on cumulative-product NAV.
  let nav = 1, peak = 1, maxDD = 0;
  const ddSeries = new Array(T);
  for (let t = 0; t < T; t++) {
    nav *= 1 + portRet[t];
    if (nav > peak) peak = nav;
    const dd = nav / peak - 1;
    if (dd < maxDD) maxDD = dd;
    ddSeries[t] = dd;
  }

  // Beta vs benchmark (portfolio).
  const covPB = covariance(portRet, benchR);
  const varB = variance(benchR);
  const betaP = varB > 0 ? covPB / varB : null;

  // ── Decomposition (component VaR via parametric formula) ─────────────────
  // Marginal VaR_i = z * (Σ w)_i / σ_p − μ_i
  // Component VaR_i = w_i · Marginal VaR_i           Σ_i Component VaR = paramVaR
  // % contribution = Component VaR / paramVaR
  const { Sigma, mu: assetMu } = covMatrix(rets);
  const Sw = matVec(Sigma, wArr);
  const decomposition = tickers.map((t, i) => {
    const marginal = sigP > 0 ? (z * Sw[i] / sigP - assetMu[i]) : 0;
    const component = wArr[i] * marginal;
    const pct = paramVaR > 0 ? component / paramVaR : 0;
    const betaI = varB > 0 ? covariance(rets[i], benchR) / varB : null;
    const sigI = stdev(rets[i], assetMu[i]);
    return {
      ticker: t,
      weight: +wArr[i].toFixed(4),
      mu: +(assetMu[i] * 252).toFixed(4),
      sigma: +(sigI * Math.sqrt(252)).toFixed(4),
      beta: betaI != null ? +betaI.toFixed(3) : null,
      marginalVaR: +marginal.toFixed(5),
      componentVaR: +component.toFixed(5),
      pctContribution: +pct.toFixed(4),
    };
  });

  // Emit every daily point — ~1500 points × 20 bytes = fine for 6h cache.
  const ddOut = ddSeries.map((dd, t) => ({ i: t, dd: +dd.toFixed(4) }));

  // Histogram of portfolio returns for the VaR cone visualization.
  const HIST_BINS = 50;
  const lo = sorted[0], hi = sorted[sorted.length - 1];
  const w = (hi - lo) / HIST_BINS;
  const histogram = new Array(HIST_BINS).fill(0);
  for (let t = 0; t < T; t++) {
    const k = Math.min(HIST_BINS - 1, Math.max(0, Math.floor((portRet[t] - lo) / w)));
    histogram[k]++;
  }
  const hist = histogram.map((count, k) => ({
    x: +(lo + (k + 0.5) * w).toFixed(5),
    n: count,
  }));

  return {
    config: {
      tickers, weights: Object.fromEntries(tickers.map((t, i) => [t, +wArr[i].toFixed(4)])),
      benchmark, conf, days: T + 1,
    },
    portfolio: {
      muDaily: +muP.toFixed(6),
      sigmaDaily: +sigP.toFixed(6),
      annualReturn: +(muP * 252).toFixed(4),
      annualVol: +(sigP * Math.sqrt(252)).toFixed(4),
      // Sharpe: mean/sd × √252 (rf=0). Same formula as the backtest section so
      // numbers match when the realized return series is shared.
      sharpe: sigP > 0 ? +((muP / sigP) * Math.sqrt(252)).toFixed(3) : null,
      histVaR: +histVaR.toFixed(5),
      histCVaR: histCVaR != null ? +histCVaR.toFixed(5) : null,
      paramVaR: +paramVaR.toFixed(5),
      paramCVaR: +paramCVaR.toFixed(5),
      maxDD: +maxDD.toFixed(4),
      beta: betaP != null ? +betaP.toFixed(3) : null,
    },
    decomposition,
    histogram: hist,
    drawdown: ddOut,
  };
}
