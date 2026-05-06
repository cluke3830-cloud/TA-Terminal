export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../../_cache';

const R = 0.043;

function ncdf(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const s = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + s * y);
}
function npdf(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }

function greeks(S, K, T, r, sigma, type) {
  if (T <= 0 || sigma <= 0) return { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
  const sT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sT);
  const d2 = d1 - sigma * sT;
  const Nd1 = ncdf(d1), Nd2 = ncdf(d2);
  const phi = npdf(d1);
  const gamma = phi / (S * sigma * sT);
  const vega = (S * phi * sT) / 100;
  if (type === 'call') {
    const delta = Nd1;
    const theta = (-(S * phi * sigma) / (2 * sT) - r * K * Math.exp(-r * T) * Nd2) / 365;
    const rho = (K * T * Math.exp(-r * T) * Nd2) / 100;
    return { delta, gamma, vega, theta, rho };
  }
  const delta = Nd1 - 1;
  const theta = (-(S * phi * sigma) / (2 * sT) + r * K * Math.exp(-r * T) * ncdf(-d2)) / 365;
  const rho = (-K * T * Math.exp(-r * T) * ncdf(-d2)) / 100;
  return { delta, gamma, vega, theta, rho };
}

// Yahoo fallback for spot when Alpaca is unavailable.
async function yahooSpot(symbol) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const result = j?.chart?.result?.[0];
    const closes = result?.indicators?.quote?.[0]?.close?.filter((c) => c != null) || [];
    if (closes.length === 0) return null;
    const spot = closes[closes.length - 1];
    if (closes.length > 5) {
      const rets = [];
      for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
      const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
      const variance = rets.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(rets.length - 1, 1);
      const rv = Math.sqrt(variance * 252) * 100;
      return { spot, rv };
    }
    return { spot, rv: 30 };
  } catch { return null; }
}

// Build synthetic Greek table from spot + RV with vol smile + term structure.
function syntheticGreeks(spot, rv) {
  const atmIV = (rv || 30) * 1.05;
  const dtes = [7, 14, 30, 45, 60, 90];
  const moneyness = [0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15];
  const today = new Date();
  const rows = [];
  for (const dte of dtes) {
    const expDate = new Date(today.getTime() + dte * 86400000);
    const exp = expDate.toISOString().split('T')[0];
    for (const m of moneyness) {
      const K = +(spot * m).toFixed(2);
      const skew = 0.10 * Math.pow(1 - m, 2) + 0.03 * (1 - m);
      const term = 0.02 * Math.exp(-dte / 60);
      const ivPct = +(atmIV + skew * 100 + term * 100).toFixed(2);
      const sigma = ivPct / 100;
      const T = dte / 365;
      const atm = m === 1.00;
      for (const type of ['call', 'put']) {
        const g = greeks(spot, K, T, R, sigma, type);
        rows.push({
          strike: K, exp, dte, T,
          type: type === 'call' ? 'C' : 'P',
          iv: ivPct, synthetic: true, atm,
          delta: +g.delta.toFixed(4),
          gamma: +g.gamma.toFixed(5),
          vega: +g.vega.toFixed(4),
          theta: +g.theta.toFixed(4),
          rho: +g.rho.toFixed(4),
        });
      }
    }
  }
  return rows;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'NVDA').toUpperCase();
  const cacheKey = `greeks:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  const origin = new URL(req.url).origin;
  let data = null;
  try {
    const upstream = await fetch(`${origin}/data_pages/options?symbol=${symbol}`);
    if (upstream.ok) data = await upstream.json();
  } catch { /* fall through */ }

  let spot = data?.spot;
  let surface = data?.surface || [];

  // Fallback: synthesize from Yahoo spot + RV if real surface is empty
  if (!surface.length) {
    const yh = await yahooSpot(symbol);
    if (yh) {
      spot = yh.spot;
      const rows = syntheticGreeks(yh.spot, yh.rv);
      const result = { spot, r: R, rows, synthetic: true, ts: new Date().toISOString() };
      setCache(cacheKey, result, 5 * 60 * 1000);
      return Response.json(result);
    }
    return Response.json({ spot: null, r: R, rows: [], msg: 'options data unavailable' });
  }

  // Real surface path
  const byExp = {};
  surface.forEach((p) => {
    const exp = p.exp || `dte-${p.dte}`;
    (byExp[exp] = byExp[exp] || []).push(p);
  });
  const atmKeyByExp = {};
  Object.entries(byExp).forEach(([exp, rows]) => {
    let best = rows[0], bestDiff = Math.abs(rows[0].strike - spot);
    rows.forEach((r) => {
      const d = Math.abs(r.strike - spot);
      if (d < bestDiff) { best = r; bestDiff = d; }
    });
    atmKeyByExp[exp] = `${best.strike}-${best.type}`;
  });

  const rows = surface.map((p) => {
    const sigma = (p.iv || 0) / 100;
    const T = p.T || (p.dte ? p.dte / 365 : 0);
    const g = greeks(spot, p.strike, T, R, sigma, p.type);
    const exp = p.exp || `dte-${p.dte}`;
    const atm = atmKeyByExp[exp] === `${p.strike}-${p.type}`;
    return {
      strike: p.strike, exp, dte: p.dte, T,
      type: p.type === 'call' ? 'C' : 'P',
      iv: p.iv, synthetic: !!p.synthetic, atm,
      delta: +g.delta.toFixed(4),
      gamma: +g.gamma.toFixed(5),
      vega: +g.vega.toFixed(4),
      theta: +g.theta.toFixed(4),
      rho: +g.rho.toFixed(4),
    };
  });

  const result = { spot, r: R, rows, ts: new Date().toISOString() };
  setCache(cacheKey, result, 5 * 60 * 1000);
  return Response.json(result);
}