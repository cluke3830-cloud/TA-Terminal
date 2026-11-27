// Option chain -> implied-volatility surface, shared by the /options and
// /options/greeks routes (they used to call each other over HTTP).
//
// The discount rate is not a constant: each contract is priced with today's
// Treasury yield at its own maturity (see rates.js). When no live rate or no
// live quotes are available the surface comes back empty with a reason. It is
// never filled in from a formula.

import { getCached, setCache } from '../_cache';
import { getDiscountCurve, interpolateYield } from './rates';

const TRADING = 'https://paper-api.alpaca.markets/v2';
const OPTDATA = 'https://data.alpaca.markets/v1beta1';
const STKDATA = 'https://data.alpaca.markets/v2';

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
        moneyness: 0, iv: +iv.toFixed(2), oi: 0, exp: '', interpolated: true,
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
      found.moneyness = p.moneyness; found.interpolated = false;
    }
  });

  return result;
}

function dateStr(d) { return d.toISOString().split('T')[0]; }

// Returns { status, body }. body.surface is [] with body.msg when there is
// nothing real to show.
export async function loadOptionSurface(symbolRaw) {
  const symbol = (symbolRaw || 'NVDA').toUpperCase();
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) return { status: 500, body: { error: 'Alpaca keys not set' } };

  const cacheKey = `opts:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return { status: 200, body: cached };

  const curve = await getDiscountCurve();
  if (!curve) {
    return {
      status: 503,
      body: { error: 'No live Treasury rate is available, so implied volatility cannot be solved right now', surface: [] },
    };
  }
  const r3m = interpolateYield(curve.points, 0.25);
  const rateInfo = {
    r: r3m != null ? +(r3m / 100).toFixed(6) : null,
    rAsOf: curve.asOf,
    rSource: curve.source,
    rTermMatched: !curve.flat,
  };

  const H = { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret };

  try {
    // 1) Spot
    const qr = await fetch(`${STKDATA}/stocks/${symbol}/quotes/latest?feed=iex`, { headers: H });
    if (!qr.ok) throw new Error(`Quote ${qr.status}`);
    const qd = await qr.json();
    const bp = qd?.quote?.bp || 0, ap = qd?.quote?.ap || 0;
    let spot = bp > 0 && ap > 0 ? (ap + bp) / 2 : null;
    // Outside market hours one side of the IEX quote is often empty or far
    // away. A midpoint of that is not a price, so use the last trade instead.
    if (spot == null || (ap - bp) / spot > 0.02) {
      const tr = await fetch(`${STKDATA}/stocks/${symbol}/trades/latest?feed=iex`, { headers: H });
      const td = tr.ok ? await tr.json() : null;
      if (td?.trade?.p > 0) spot = td.trade.p;
    }
    if (!(spot > 0)) throw new Error(`No usable price for ${symbol}`);

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
    if (!cr.ok) return { status: 200, body: { spot, rv, surface: [], ...rateInfo, msg: `Option contract list unavailable (HTTP ${cr.status})` } };
    const contracts = (await cr.json()).option_contracts || [];
    if (!contracts.length) return { status: 200, body: { spot, rv, surface: [], ...rateInfo, msg: `No listed options found for ${symbol}` } };

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
      const r = curve.rateFor(T);
      if (r == null) continue;
      const iv = solveIV(mid, spot, K, T, r, c.type);
      if (!iv || iv < 0.03 || iv > 4) continue;
      const oi = rawOI != null ? parseInt(rawOI) : 0;
      rawSurface.push({
        strike: K, type: c.type, dte, T, mid,
        moneyness: K / spot, iv: +(iv * 100).toFixed(2), oi, exp: dateStr(exp),
      });
    }

    // 6) Interpolate + smooth for a complete, silky surface
    const callsFilled = interpolateAndSmooth(rawSurface, 'call');
    const putsFilled = interpolateAndSmooth(rawSurface, 'put');

    const surface = [...callsFilled, ...putsFilled];

    const result = {
      spot, rv, surface, ...rateInfo,
      quoted: rawSurface.length,
      msg: surface.length ? undefined : 'No usable option quotes right now (market closed, or quotes too wide to trust)',
      ts: new Date().toISOString(),
    };
    // An empty answer is retried after a minute; a real one is kept 10 minutes.
    setCache(cacheKey, result, surface.length ? undefined : 60 * 1000);
    return { status: 200, body: result };
  } catch (e) {
    return { status: 500, body: { error: e.message } };
  }
}
