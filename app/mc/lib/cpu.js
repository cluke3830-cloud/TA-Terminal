// CPU Monte Carlo pricers in pure JS — the "no acceleration" baseline that
// makes the MI300X comparison meaningful. Runs in chunks via async yields so
// the UI can keep ticking the runtime counter and stay responsive.

const TWO = 2;

// Marsaglia polar method — ~2× faster than Box–Muller because it avoids the
// trig calls. Returns one standard normal sample per call.
function gauss() {
  let u, v, s;
  do {
    u = TWO * Math.random() - 1;
    v = TWO * Math.random() - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  return u * Math.sqrt(-2 * Math.log(s) / s);
}

// Solve a 3×3 linear system Ax = b via Cramer's rule. Used by Longstaff–Schwartz
// for the polynomial regression of continuation values onto S, S². Returns the
// zero vector if the matrix is singular (degenerate fit — discount and skip).
function solve3x3(m11, m12, m13, b1, m21, m22, m23, b2, m31, m32, m33, b3) {
  const det = m11 * (m22 * m33 - m23 * m32) - m12 * (m21 * m33 - m23 * m31) + m13 * (m21 * m32 - m22 * m31);
  if (Math.abs(det) < 1e-12) return [0, 0, 0];
  const d1 = b1 * (m22 * m33 - m23 * m32) - m12 * (b2 * m33 - m23 * b3) + m13 * (b2 * m32 - m22 * b3);
  const d2 = m11 * (b2 * m33 - m23 * b3) - b1 * (m21 * m33 - m23 * m31) + m13 * (m21 * b3 - b2 * m31);
  const d3 = m11 * (m22 * b3 - b2 * m32) - m12 * (m21 * b3 - b2 * m31) + b1 * (m21 * m32 - m22 * m31);
  return [d1 / det, d2 / det, d3 / det];
}

// Single GBM path → payoff. For path-dependent options we walk every step.
// `optionType`: 'asian' | 'lookback' | 'barrier' | 'european'.
function pathPayoff(optionType, S0, K, drift, diff, steps, barrier, isCall) {
  let logS = Math.log(S0);
  if (optionType === 'asian') {
    let sum = 0;
    for (let i = 0; i < steps; i++) { logS += drift + diff * gauss(); sum += Math.exp(logS); }
    const avg = sum / steps;
    return isCall ? Math.max(avg - K, 0) : Math.max(K - avg, 0);
  }
  if (optionType === 'lookback') {
    let extreme = isCall ? -Infinity : Infinity;
    for (let i = 0; i < steps; i++) {
      logS += drift + diff * gauss();
      const S = Math.exp(logS);
      extreme = isCall ? Math.max(extreme, S) : Math.min(extreme, S);
    }
    return isCall ? Math.max(extreme - K, 0) : Math.max(K - extreme, 0);
  }
  if (optionType === 'barrier') {
    // Knock-out call (up-and-out) / put (down-and-out)
    let breached = false;
    let S = S0;
    for (let i = 0; i < steps; i++) {
      logS += drift + diff * gauss();
      S = Math.exp(logS);
      if (isCall && barrier != null && S >= barrier) breached = true;
      if (!isCall && barrier != null && S <= barrier) breached = true;
    }
    if (breached) return 0;
    return isCall ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  // 'european'
  for (let i = 0; i < steps; i++) logS += drift + diff * gauss();
  const S = Math.exp(logS);
  return isCall ? Math.max(S - K, 0) : Math.max(K - S, 0);
}

// Longstaff–Schwartz American option pricing on CPU. Stores the full price grid
// to apply backward induction with polynomial regression on ITM paths. Caps
// path count at 100k since memory is paths × steps × 4B (10M × 252 ≈ 10GB → no).
async function priceAmerican({ S0, K, T, r, sigma, paths, steps, isCall, onProgress }) {
  const usePaths = Math.min(paths, 100_000);
  const dt = T / steps;
  const drift = (r - 0.5 * sigma * sigma) * dt;
  const diff = sigma * Math.sqrt(dt);
  const disc = Math.exp(-r * dt);

  // Column-major: S[t * usePaths + p] = price at time t on path p
  const S = new Float32Array(usePaths * steps);
  const CHUNK = 2_000;
  for (let start = 0; start < usePaths; start += CHUNK) {
    const end = Math.min(start + CHUNK, usePaths);
    for (let p = start; p < end; p++) {
      let logS = Math.log(S0);
      for (let t = 0; t < steps; t++) {
        logS += drift + diff * gauss();
        S[t * usePaths + p] = Math.exp(logS);
      }
    }
    if (onProgress) onProgress(0.5 * end / usePaths);
    await yieldFrame();
  }

  // Cashflow at terminal
  const cashflow = new Float64Array(usePaths);
  for (let p = 0; p < usePaths; p++) {
    const sT = S[(steps - 1) * usePaths + p];
    cashflow[p] = isCall ? Math.max(sT - K, 0) : Math.max(K - sT, 0);
  }

  // Backward induction with polynomial (degree-2) regression
  for (let t = steps - 2; t >= 0; t--) {
    for (let p = 0; p < usePaths; p++) cashflow[p] *= disc;

    // Collect ITM paths and their continuation targets
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, y0 = 0, y1 = 0, y2 = 0;
    const itmIdx = [];
    const itmS = [];
    for (let p = 0; p < usePaths; p++) {
      const s = S[t * usePaths + p];
      const intrinsic = isCall ? Math.max(s - K, 0) : Math.max(K - s, 0);
      if (intrinsic > 0) {
        itmIdx.push(p);
        itmS.push(s);
        const xx = s * s;
        const y = cashflow[p];
        s0 += 1; s1 += s; s2 += xx; s3 += xx * s; s4 += xx * xx;
        y0 += y; y1 += s * y; y2 += xx * y;
      }
    }
    if (itmIdx.length < 4) continue;

    const a = solve3x3(s0, s1, s2, y0, s1, s2, s3, y1, s2, s3, s4, y2);
    for (let i = 0; i < itmIdx.length; i++) {
      const p = itmIdx[i];
      const s = itmS[i];
      const cont = a[0] + a[1] * s + a[2] * s * s;
      const intrinsic = isCall ? Math.max(s - K, 0) : Math.max(K - s, 0);
      if (intrinsic > cont) cashflow[p] = intrinsic;
    }
    if (t % 32 === 0) {
      if (onProgress) onProgress(0.5 + 0.5 * (1 - t / steps));
      await yieldFrame();
    }
  }

  let sum = 0, sum2 = 0;
  for (let p = 0; p < usePaths; p++) { sum += cashflow[p]; sum2 += cashflow[p] * cashflow[p]; }
  const mean = sum / usePaths;
  const variance = Math.max(0, sum2 / usePaths - mean * mean);
  return { price: mean, stderr: Math.sqrt(variance / usePaths), pathsUsed: usePaths };
}

// Yield to the event loop so React can re-render and the runtime counter ticks.
function yieldFrame() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Generate a small (default 100) set of full GBM trajectories purely for the
// path-fan visualization. Returns a column-major Float32Array indexed as
// grid[t * samples + p] — one column per timestep — so per-timestep slices
// for percentile calc are cache-friendly.
export function sampleVizPaths({ S0, T, r, sigma, steps = 252, samples = 100 }) {
  const T0 = performance.now();
  const dt = T / steps;
  const drift = (r - 0.5 * sigma * sigma) * dt;
  const diff = sigma * Math.sqrt(dt);
  const cols = steps + 1;
  // Row-major: grid[p * cols + t] — easier to think about, fast enough for 100x252.
  const grid = new Float32Array(samples * cols);
  for (let p = 0; p < samples; p++) {
    grid[p * cols] = S0;
    let logS = Math.log(S0);
    for (let t = 1; t <= steps; t++) {
      logS += drift + diff * gauss();
      grid[p * cols + t] = Math.exp(logS);
    }
  }
  return { grid, samples, cols, runtimeMs: performance.now() - T0 };
}

// Per-timestep 5th / 50th / 95th percentile across all sampled paths. Returns
// three arrays of length `cols` so they can be plotted directly against the
// time axis. Sorts in-place into a scratch array.
export function vizQuantiles(grid, samples, cols) {
  const p05 = new Float64Array(cols);
  const p50 = new Float64Array(cols);
  const p95 = new Float64Array(cols);
  const slice = new Float64Array(samples);
  const i05 = Math.max(0, Math.floor(samples * 0.05));
  const i50 = Math.floor(samples * 0.50);
  const i95 = Math.min(samples - 1, Math.ceil(samples * 0.95) - 1);
  for (let t = 0; t < cols; t++) {
    for (let p = 0; p < samples; p++) slice[p] = grid[p * cols + t];
    slice.sort();
    p05[t] = slice[i05];
    p50[t] = slice[i50];
    p95[t] = slice[i95];
  }
  return { p05, p50, p95 };
}

// Public entry point. Returns { price, stderr, runtimeMs, pathsPerSec, source }.
// `onProgress(fraction, elapsedMs)` is called periodically.
export async function runMCCpu({
  optionType = 'asian',
  S0, K, T, r, sigma,
  paths = 1_000_000,
  steps = 252,
  barrier = null,
  isCall = true,
  onProgress = null,
} = {}) {
  const t0 = performance.now();

  if (optionType === 'american') {
    const res = await priceAmerican({ S0, K, T, r, sigma, paths, steps, isCall, onProgress });
    const ms = performance.now() - t0;
    return {
      price: res.price, stderr: res.stderr,
      runtimeMs: ms, pathsPerSec: res.pathsUsed * steps / (ms / 1000),
      pathsUsed: res.pathsUsed, source: 'cpu',
    };
  }

  const dt = T / steps;
  const drift = (r - 0.5 * sigma * sigma) * dt;
  const diff = sigma * Math.sqrt(dt);
  const disc = Math.exp(-r * T);

  let sum = 0, sum2 = 0, count = 0;
  // Tune chunk by total path count so progress feels smooth even at 10M paths.
  const CHUNK = Math.max(1_000, Math.min(20_000, Math.floor(paths / 80) || 1_000));
  for (let start = 0; start < paths; start += CHUNK) {
    const end = Math.min(start + CHUNK, paths);
    for (let p = start; p < end; p++) {
      const payoff = pathPayoff(optionType, S0, K, drift, diff, steps, barrier, isCall);
      sum += payoff; sum2 += payoff * payoff; count++;
    }
    if (onProgress) onProgress(count / paths, performance.now() - t0);
    await yieldFrame();
  }

  const meanRaw = sum / count;
  const varianceRaw = Math.max(0, sum2 / count - meanRaw * meanRaw);
  const price = meanRaw * disc;
  const stderr = Math.sqrt(varianceRaw / count) * disc;
  const ms = performance.now() - t0;
  return {
    price, stderr,
    runtimeMs: ms,
    pathsPerSec: count * steps / (ms / 1000),
    pathsUsed: count,
    source: 'cpu',
  };
}
