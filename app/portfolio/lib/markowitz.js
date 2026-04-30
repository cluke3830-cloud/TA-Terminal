// Markowitz mean-variance solver. Hand-rolled to avoid native deps on Vercel.
// Inputs are ANNUALIZED mu (n) and Sigma (n×n). All weights are long-only by
// default (lower box bound = 0); supply per-asset bounds to override.

export function logReturns(closes) {
  const r = new Array(closes.length - 1);
  for (let i = 1; i < closes.length; i++) r[i - 1] = Math.log(closes[i] / closes[i - 1]);
  return r;
}

export function meanCov(returnsByAsset, annualize = 252) {
  const tickers = Object.keys(returnsByAsset);
  const n = tickers.length;
  const T = returnsByAsset[tickers[0]].length;
  const mu = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let t = 0; t < T; t++) s += returnsByAsset[tickers[i]][t];
    mu[i] = (s / T) * annualize;
  }
  const Sigma = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      const mi = mu[i] / annualize, mj = mu[j] / annualize;
      for (let t = 0; t < T; t++) {
        s += (returnsByAsset[tickers[i]][t] - mi) * (returnsByAsset[tickers[j]][t] - mj);
      }
      const c = (s / (T - 1)) * annualize;
      Sigma[i][j] = c;
      Sigma[j][i] = c;
    }
  }
  return { tickers, mu, Sigma };
}

// Numeric helpers ----------------------------------------------------------

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

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

// Project vector onto { w : sum(w)=1, low_i <= w_i <= high_i }. Wang &
// Carreira-Perpiñán (2013) bisection on the dual variable lambda.
function projectBox(v, low, high) {
  const n = v.length;
  // Edge case: bounds infeasible (sum(low)>1 or sum(high)<1).
  let sl = 0, sh = 0;
  for (let i = 0; i < n; i++) { sl += low[i]; sh += high[i]; }
  if (sl > 1 + 1e-9 || sh < 1 - 1e-9) return null;

  const f = (lam) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.min(high[i], Math.max(low[i], v[i] - lam));
      s += w;
    }
    return s - 1;
  };
  let lo = -1e3, hi = 1e3;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const val = f(mid);
    if (Math.abs(val) < 1e-9) { lo = hi = mid; break; }
    if (val > 0) lo = mid; else hi = mid;
  }
  const lam = (lo + hi) / 2;
  const w = new Array(n);
  for (let i = 0; i < n; i++) w[i] = Math.min(high[i], Math.max(low[i], v[i] - lam));
  // Renormalize tiny float drift.
  let s = 0; for (let i = 0; i < n; i++) s += w[i];
  for (let i = 0; i < n; i++) w[i] /= s;
  return w;
}

// Projected gradient on L(w) = 0.5 wᵀΣw − q·μᵀw, w in box ∩ simplex.
// Returns {w, vol, ret} or null if infeasible.
function solveQ(mu, Sigma, low, high, q, w0) {
  const n = mu.length;
  // Lipschitz estimate from largest diagonal of Sigma.
  let L = 0;
  for (let i = 0; i < n; i++) L = Math.max(L, Sigma[i][i]);
  L = Math.max(L * n, 1e-3);
  const step = 1 / L;

  let w = w0 ? [...w0] : projectBox(new Array(n).fill(1 / n), low, high);
  if (!w) return null;
  for (let it = 0; it < 600; it++) {
    const grad = matVec(Sigma, w);
    const v = new Array(n);
    for (let i = 0; i < n; i++) v[i] = w[i] - step * (grad[i] - q * mu[i]);
    const wNew = projectBox(v, low, high);
    if (!wNew) return null;
    let dmax = 0;
    for (let i = 0; i < n; i++) dmax = Math.max(dmax, Math.abs(wNew[i] - w[i]));
    w = wNew;
    if (dmax < 1e-7) break;
  }
  const ret = dot(mu, w);
  const vol = Math.sqrt(Math.max(0, dot(w, matVec(Sigma, w))));
  return { w, ret, vol };
}

// Normalize a single ticker's bounds entry. Accepts whatever shape the UI
// sent (missing, half-filled, reversed, out of range) and returns a sane
// [lo, hi] pair within [0, 1].
function normBound(b) {
  if (!Array.isArray(b) || b.length < 2) return [0, 1];
  let lo = Number(b[0]);
  let hi = Number(b[1]);
  if (!isFinite(lo)) lo = 0;
  if (!isFinite(hi)) hi = 1;
  lo = Math.max(0, Math.min(1, lo));
  hi = Math.max(0, Math.min(1, hi));
  if (lo > hi) [lo, hi] = [hi, lo];
  return [lo, hi];
}

// Public: build a 30-point efficient frontier and pick the optimal portfolio
// for the requested objective.
export function solveFrontier({ mu, Sigma, tickers, bounds, rf = 0.04, objective = 'max_sharpe', target = null }) {
  const n = mu.length;
  // Add tiny ridge for numerical stability when assets are highly correlated.
  const ridge = 1e-6;
  const S = Sigma.map((row, i) => row.map((v, j) => i === j ? v + ridge : v));

  const pairs = tickers.map((t) => normBound(bounds && bounds[t]));
  const low = pairs.map((p) => p[0]);
  const high = pairs.map((p) => p[1]);
  const sl = low.reduce((a, b) => a + b, 0);
  const sh = high.reduce((a, b) => a + b, 0);
  // Use 1e-6 tolerance so floating-point rounding (e.g. five 0.2's) doesn't
  // false-positive. Report the actual sums so the UI can show what's wrong.
  if (sl > 1 + 1e-6) {
    return { error: `Lower bounds sum to ${sl.toFixed(3)} (must be ≤ 1). Reduce one or more minimum weights.`, sumLow: +sl.toFixed(4), sumHigh: +sh.toFixed(4) };
  }
  if (sh < 1 - 1e-6) {
    return { error: `Upper bounds sum to ${sh.toFixed(3)} (must be ≥ 1 so weights can total 100%). Raise one or more maximum weights.`, sumLow: +sl.toFixed(4), sumHigh: +sh.toFixed(4) };
  }

  // Sweep q from negative (inefficient half — minimize return at each vol) to
  // positive (efficient half — maximize return at each vol). q=0 sits at the
  // min-variance apex. Use power-law spacing so we get many points near the
  // curving apex and few at the corners, which avoids the curve degenerating
  // into a single line.
  const qs = [0];
  const N = 30;
  const Q_MAX = 8;
  for (let i = 1; i <= N; i++) {
    const t = i / N;            // (0, 1]
    const q = Q_MAX * Math.pow(t, 2.5);
    qs.push(q);
    qs.push(-q);
  }
  qs.sort((a, b) => a - b);

  const points = [];
  // Solve from q=0 outward in both directions so each warm-start is close to
  // the previous solution.
  const center = qs.findIndex((q) => q === 0);
  const right = qs.slice(center);
  const left = qs.slice(0, center).reverse();
  let prev = null;
  for (const q of right) {
    const r = solveQ(mu, S, low, high, q, prev);
    if (r) { prev = r.w; points.push({ q, ...r }); }
  }
  prev = null;
  for (const q of left) {
    const r = solveQ(mu, S, low, high, q, prev);
    if (r) { prev = r.w; points.push({ q, ...r }); }
  }
  if (!points.length) return { error: 'optimization failed' };

  // Sort by q so the curve traces from inefficient (low q) → min-vol → efficient (high q).
  points.sort((a, b) => a.q - b.q);

  // Dedupe consecutive points that landed on the same (vol, ret) — common at
  // the corners where bounds bind.
  const curve = [];
  points.forEach((p) => {
    const last = curve[curve.length - 1];
    if (!last || Math.abs(p.vol - last.vol) > 1e-4 || Math.abs(p.ret - last.ret) > 1e-4) curve.push(p);
  });

  // For optimal selection use only the efficient half (q ≥ 0): points where
  // ret is the MAXIMUM achievable at that vol.
  const efficient = curve.filter((p) => p.q >= 0);

  let optimal;
  if (objective === 'min_vol') {
    optimal = efficient.reduce((best, p) => (!best || p.vol < best.vol) ? p : best, null);
  } else if (objective === 'target_return' && target != null) {
    optimal = efficient.reduce((a, b) => Math.abs(b.ret - target) < Math.abs(a.ret - target) ? b : a);
  } else {
    // max_sharpe = tangency portfolio: where the CAL from (0, rf) touches the
    // efficient frontier.
    optimal = efficient.reduce((best, p) => {
      const sh = (p.ret - rf) / Math.max(p.vol, 1e-6);
      const bestSh = best ? (best.ret - rf) / Math.max(best.vol, 1e-6) : -Infinity;
      return sh > bestSh ? p : best;
    }, null);
  }

  const sharpe = (optimal.ret - rf) / Math.max(optimal.vol, 1e-6);
  const weights = {};
  tickers.forEach((t, i) => { weights[t] = +optimal.w[i].toFixed(4); });
  const assets = tickers.map((t, i) => ({
    ticker: t,
    mu: +mu[i].toFixed(4),
    sigma: +Math.sqrt(Sigma[i][i]).toFixed(4),
    weight: weights[t],
  }));

  // Always compute the tangency portfolio for the CAL line, even when the
  // user picked a different objective.
  const tangency = efficient.reduce((best, p) => {
    const sh = (p.ret - rf) / Math.max(p.vol, 1e-6);
    const bestSh = best ? (best.ret - rf) / Math.max(best.vol, 1e-6) : -Infinity;
    return sh > bestSh ? p : best;
  }, null);

  return {
    frontier: curve.map((p) => ({ vol: +p.vol.toFixed(4), ret: +p.ret.toFixed(4), q: +p.q.toFixed(2) })),
    optimal: {
      weights,
      vol: +optimal.vol.toFixed(4),
      ret: +optimal.ret.toFixed(4),
      sharpe: +sharpe.toFixed(3),
    },
    tangency: tangency ? {
      vol: +tangency.vol.toFixed(4),
      ret: +tangency.ret.toFixed(4),
      sharpe: +((tangency.ret - rf) / Math.max(tangency.vol, 1e-6)).toFixed(3),
    } : null,
    assets,
  };
}