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
  const vega = (S * phi * sT) / 100; // per 1% vol move
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

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'NVDA').toUpperCase();
  const cacheKey = `greeks:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  const origin = new URL(req.url).origin;
  const upstream = await fetch(`${origin}/data_pages/options?symbol=${symbol}`);
  if (!upstream.ok) return Response.json({ error: `options upstream ${upstream.status}` }, { status: 502 });
  const data = await upstream.json();
  if (data.error) return Response.json({ error: data.error }, { status: 502 });
  const { spot, surface = [] } = data;
  if (!spot || !surface.length) return Response.json({ spot, r: R, rows: [], msg: 'no surface' });

  // ATM strike per expiry → row closest to spot.
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
      strike: p.strike,
      exp,
      dte: p.dte,
      T,
      type: p.type === 'call' ? 'C' : 'P',
      iv: p.iv,
      synthetic: !!p.synthetic,
      atm,
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