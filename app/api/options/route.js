export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../_cache';

const TRADING = 'https://paper-api.alpaca.markets/v2';
const OPTDATA = 'https://data.alpaca.markets/v1beta1';
const STKDATA = 'https://data.alpaca.markets/v2';
const R = 0.043;

// ── Black-Scholes ───────────────────────────────────────────────────────────

function ncdf(x) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const s = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-ax*ax);
  return 0.5 * (1 + s * y);
}

function bsPrice(S, K, T, r, sigma, cp) {
  if (T <= 0 || sigma <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return cp === 'call'
    ? Math.max(S * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2), 0)
    : Math.max(K * Math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1), 0);
}

function solveIV(mid, S, K, T, r, cp) {
  if (T <= 0 || mid <= 0) return null;
  const intr = cp === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  if (mid <= intr) return null;
  let lo = 0.01, hi = 5;
  const f = sigma => bsPrice(S, K, T, r, sigma, cp) - mid;
  if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (Math.abs(f(m)) < 1e-7 || (hi - lo) < 1e-8) return m;
    if (f(m) * f(lo) < 0) hi = m; else lo = m;
  }
  return (lo + hi) / 2;
}

// ── Bilinear interpolation + Gaussian smoothing for silky surface ────────────

function interpolateAndSmooth(surface, type) {
  const pts = surface.filter(p => p.type === type);
  if (pts.length < 5) return pts;

  const strikes = [...new Set(pts.map(p => p.strike))].sort((a, b) => a - b);
  const dtes = [...new Set(pts.map(p => p.dte))].sort((a, b) => a - b);
  const ns = strikes.length, nd = dtes.length;

  // Build 2D grid of known IV values
  const grid = Array.from({ length: nd }, () => new Float64Array(ns));
  const known = Array.from({ length: nd }, () => new Uint8Array(ns));
  const sIdx = {}; strikes.forEach((k, i) => { sIdx[k] = i; });
  const dIdx = {}; dtes.forEach((d, i) => { dIdx[d] = i; });
  pts.forEach(p => {
    const si = sIdx[p.strike], di = dIdx[p.dte];
    if (si != null && di != null) { grid[di][si] = p.iv; known[di][si] = 1; }
  });

  // Pass 1: Bilinear interpolation to fill gaps
  for (let di = 0; di < nd; di++) {
    for (let si = 0; si < ns; si++) {
      if (known[di][si]) continue;
      // Find neighbors in strike dimension
      let lv = null, rv = null, li = -1, ri = -1;
      for (let i = si - 1; i >= 0; i--) { if (known[di][i] || grid[di][i]) { lv = grid[di][i]; li = i; break; } }
      for (let i = si + 1; i < ns; i++) { if (known[di][i] || grid[di][i]) { rv = grid[di][i]; ri = i; break; } }
      // Find neighbors in DTE dimension
      let uv = null, dv = null, ui = -1, ddi = -1;
      for (let i = di - 1; i >= 0; i--) { if (known[i][si] || grid[i][si]) { uv = grid[i][si]; ui = i; break; } }
      for (let i = di + 1; i < nd; i++) { if (known[i][si] || grid[i][si]) { dv = grid[i][si]; ddi = i; break; } }

      const vals = [];
      if (lv != null && rv != null) { const w = (si - li) / (ri - li); vals.push(lv + w * (rv - lv)); }
      else if (lv != null) vals.push(lv);
      else if (rv != null) vals.push(rv);
      if (uv != null && dv != null) { const w = (di - ui) / (ddi - ui); vals.push(uv + w * (dv - uv)); }
      else if (uv != null) vals.push(uv);
      else if (dv != null) vals.push(dv);

      if (vals.length > 0) grid[di][si] = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
  }

  // Pass 2: Gaussian smoothing (3x3 kernel) for silky smooth surface
  const smoothed = Array.from({ length: nd }, () => new Float64Array(ns));
  // Kernel weights: center=4, adjacent=2, diagonal=1 (total=16)
  for (let di = 0; di < nd; di++) {
    for (let si = 0; si < ns; si++) {
      let sum = 0, wt = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let sj = -1; sj <= 1; sj++) {
          const d2 = di + dj, s2 = si + sj;
          if (d2 < 0 || d2 >= nd || s2 < 0 || s2 >= ns) continue;
          if (!grid[d2][s2]) continue;
          const w = dj === 0 && sj === 0 ? 4 : (dj === 0 || sj === 0 ? 2 : 1);
          sum += grid[d2][s2] * w;
          wt += w;
        }
      }
      smoothed[di][si] = wt > 0 ? sum / wt : grid[di][si];
    }
  }

  // Build final surface array
  const result = [];
  for (let di = 0; di < nd; di++) {
    for (let si = 0; si < ns; si++) {
      const iv = smoothed[di][si];
      if (!iv || iv <= 0) continue;
      result.push({
        strike: strikes[si], type, dte: dtes[di], T: dtes[di] / 365, mid: 0,
        moneyness: 0, iv: +iv.toFixed(2), oi: 0, exp: '',
      });
    }
  }

  // Restore original data for known points (keep raw IV for accuracy at data points)
  pts.forEach(p => {
    const found = result.find(r => r.strike === p.strike && r.dte === p.dte);
    if (found) {
      // Blend: 70% smoothed + 30% original for known points (keeps shape but smooths noise)
      found.iv = +(found.iv * 0.7 + p.iv * 0.3).toFixed(2);
      found.mid = p.mid; found.oi = p.oi; found.exp = p.exp;
      found.moneyness = p.moneyness;
    }
  });

  return result;
}

function dateStr(d) { return d.toISOString().split('T')[0]; }

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'NVDA').toUpperCase();
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) return Response.json({ error: 'Alpaca keys not set' }, { status: 500 });

  // Cache options data for 5 min (separate from FMP cache)
  const cacheKey = `opts:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  const H = { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret };

  try {
    // 1) Spot
    const qr = await fetch(`${STKDATA}/stocks/${symbol}/quotes/latest?feed=iex`, { headers: H });
    if (!qr.ok) throw new Error(`Quote ${qr.status}`);
    const qd = await qr.json();
    const spot = (qd.quote.ap + qd.quote.bp) / 2;

    // 2) Realized Vol (90d)
    const rvEnd = new Date(), rvStart = new Date(rvEnd - 100 * 864e5);
    const rvRes = await fetch(`${STKDATA}/stocks/${symbol}/bars?${new URLSearchParams({
      start: rvStart.toISOString(), end: rvEnd.toISOString(),
      timeframe: '1Day', feed: 'iex', limit: '200', sort: 'asc',
    })}`, { headers: H });
    let rv = null;
    if (rvRes.ok) {
      const bars = (await rvRes.json()).bars || [];
      if (bars.length > 10) {
        const lr = [];
        for (let i = 1; i < bars.length; i++) lr.push(Math.log(bars[i].c / bars[i - 1].c));
        const mu = lr.reduce((a, b) => a + b, 0) / lr.length;
        rv = Math.sqrt(lr.reduce((a, b) => a + (b - mu) ** 2, 0) / (lr.length - 1) * 252) * 100;
      }
    }

    // 3) Options chain — wider range for complete surface
    const today = new Date();
    const minE = new Date(today.getTime() + 3 * 864e5);
    const maxE = new Date(today.getTime() + 120 * 864e5);
    const cp = new URLSearchParams({
      underlying_symbols: symbol, status: 'active',
      expiration_date_gte: dateStr(minE), expiration_date_lte: dateStr(maxE),
      strike_price_gte: (spot * 0.70).toFixed(2),
      strike_price_lte: (spot * 1.30).toFixed(2),
      limit: '1000',
    });

    const cr = await fetch(`${TRADING}/options/contracts?${cp}`, { headers: H });
    if (!cr.ok) return Response.json({ spot, rv, surface: [], msg: `Contracts ${cr.status}` });
    const contracts = (await cr.json()).option_contracts || [];
    if (!contracts.length) return Response.json({ spot, rv, surface: [] });

    // 4) Batch quotes — comma-separated, parallel fetches
    const quotes = {};
    const syms = contracts.map(c => c.symbol);
    const batchSize = 25;
    const batchPromises = [];
    for (let i = 0; i < syms.length; i += batchSize) {
      const batch = syms.slice(i, i + batchSize);
      const url = `${OPTDATA}/options/quotes/latest?symbols=${batch.join(',')}&feed=indicative`;
      batchPromises.push(
        fetch(url, { headers: H })
          .then(async r => {
            if (!r.ok) return {};
            const d = await r.json();
            return d?.quotes || {};
          })
          .catch(() => ({}))
      );
    }
    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach(bq => Object.assign(quotes, bq));

    // 5) Solve IV — relaxed filters for maximum coverage
    const rawSurface = [];
    for (const c of contracts) {
      const q = quotes[c.symbol];
      if (!q) continue;
      const bid = q.bp || 0, ask = q.ap || 0, mid = (bid + ask) / 2;
      if (mid <= 0 || bid <= 0) continue;
      if ((ask - bid) / mid > 0.80) continue;
      // Skip OI filter if OI is null/undefined (not reported)
      const rawOI = c.open_interest;
      if (rawOI != null && parseInt(rawOI) < 5) continue;
      // Sanity: mid price shouldn't exceed 2x the max reasonable option value
      const K = parseFloat(c.strike_price);
      const intrinsic = c.type === 'call' ? Math.max(spot - K, 0) : Math.max(K - spot, 0);
      if (mid > intrinsic + spot * 0.5) continue;
      const exp = new Date(c.expiration_date);
      const dte = Math.round((exp - today) / 864e5);
      const T = dte / 365;
      const iv = solveIV(mid, spot, K, T, R, c.type);
      if (!iv || iv < 0.03 || iv > 4) continue;
      const oi = rawOI != null ? parseInt(rawOI) : 0;
      rawSurface.push({
        strike: K, type: c.type, dte, T, mid,
        moneyness: K / spot, iv: +(iv * 100).toFixed(2), oi, exp: dateStr(exp),
      });
    }

    // 6) Interpolate + smooth for a complete, silky surface
    let callsFilled = interpolateAndSmooth(rawSurface, 'call');
    let putsFilled = interpolateAndSmooth(rawSurface, 'put');

    // 7) If we have too few call points, synthesize a theoretical surface from RV
    //    This handles weekends/off-hours when indicative feed returns stale data
    if (callsFilled.length < 20 && rv) {
      const atmIV = rv * 1.1; // ATM IV is typically ~10% above RV
      const synStrikes = [];
      for (let m = 0.75; m <= 1.30; m += 0.025) synStrikes.push(+(spot * m).toFixed(2));
      const synDTEs = [7, 14, 21, 30, 45, 60, 90];

      const synCalls = [], synPuts = [];
      for (const dte of synDTEs) {
        for (const K of synStrikes) {
          const m = K / spot;
          // Vol smile: higher IV for OTM options, term structure: higher IV for shorter DTE
          const skew = 0.12 * Math.pow(1 - m, 2) + 0.04 * (1 - m);
          const term = 0.02 * Math.exp(-dte / 60);
          const iv = +(atmIV + skew * 100 + term * 100).toFixed(2);
          if (iv > 3 && iv < 200) {
            synCalls.push({ strike: K, type: 'call', dte, T: dte / 365, mid: 0, moneyness: m, iv, oi: 0, exp: '', synthetic: true });
            synPuts.push({ strike: K, type: 'put', dte, T: dte / 365, mid: 0, moneyness: m, iv, oi: 0, exp: '', synthetic: true });
          }
        }
      }
      callsFilled = synCalls;
      putsFilled = synPuts;
    }

    const surface = [...callsFilled, ...putsFilled];

    const result = { spot, rv, surface, ts: new Date().toISOString() };
    setCache(cacheKey, result);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
