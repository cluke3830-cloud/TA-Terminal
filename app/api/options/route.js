export const dynamic = 'force-dynamic';

const TRADING = 'https://paper-api.alpaca.markets/v2';
const OPTDATA = 'https://data.alpaca.markets/v1beta1';
const STKDATA = 'https://data.alpaca.markets/v2';
const R = 0.043;

// ── Black-Scholes (ported from Session_5.py) ─────────────────────────────────

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

function dateStr(d) { return d.toISOString().split('T')[0]; }

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'NVDA').toUpperCase();
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) return Response.json({ error: 'Alpaca keys not set' }, { status: 500 });

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

    // 3) Options chain
    const today = new Date();
    const minE = new Date(today.getTime() + 7 * 864e5);
    const maxE = new Date(today.getTime() + 90 * 864e5);
    const cp = new URLSearchParams({
      underlying_symbols: symbol, status: 'active',
      expiration_date_gte: dateStr(minE), expiration_date_lte: dateStr(maxE),
      strike_price_gte: (spot * 0.80).toFixed(2),
      strike_price_lte: (spot * 1.20).toFixed(2),
      limit: '1000',
    });

    const cr = await fetch(`${TRADING}/options/contracts?${cp}`, { headers: H });
    if (!cr.ok) return Response.json({ spot, rv, surface: [], msg: `Contracts ${cr.status}` });
    const contracts = (await cr.json()).option_contracts || [];
    if (!contracts.length) return Response.json({ spot, rv, surface: [] });

    // 4) Batch quotes
    const quotes = {};
    const syms = contracts.map(c => c.symbol);
    for (let i = 0; i < syms.length; i += 50) {
      const batch = syms.slice(i, i + 50);
      const qp = new URLSearchParams();
      batch.forEach(s => qp.append('symbols', s));
      qp.append('feed', 'indicative');
      try {
        const r = await fetch(`${OPTDATA}/options/quotes/latest?${qp}`, { headers: H });
        if (r.ok) Object.assign(quotes, (await r.json()).quotes || {});
      } catch {}
    }

    // 5) Solve IV
    const surface = [];
    for (const c of contracts) {
      const q = quotes[c.symbol];
      if (!q) continue;
      const bid = q.bp || 0, ask = q.ap || 0, mid = (bid + ask) / 2;
      if (mid <= 0 || bid <= 0) continue;
      if ((ask - bid) / mid > 0.50) continue;
      const oi = c.open_interest || 0;
      if (oi < 20) continue;
      const exp = new Date(c.expiration_date);
      const dte = Math.round((exp - today) / 864e5);
      const T = dte / 365;
      const K = parseFloat(c.strike_price);
      const iv = solveIV(mid, spot, K, T, R, c.type);
      if (!iv || iv < 0.05 || iv > 2) continue;
      surface.push({
        strike: K, type: c.type, dte, T, mid,
        moneyness: K / spot, iv: iv * 100, oi, exp: dateStr(exp),
      });
    }

    return Response.json({ spot, rv, surface, ts: new Date().toISOString() });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
