export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../_cache';

const FMP = 'https://financialmodelingprep.com/stable';

async function fmpGet(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'NVDA').toUpperCase();
  const key = process.env.FMP_API_KEY;
  if (!key) return Response.json({ error: 'FMP_API_KEY not set' }, { status: 500 });

  const cacheKey = `fin:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  const q = (endpoint, extra = '') => `${FMP}/${endpoint}?symbol=${symbol}${extra}&apikey=${key}`;

  try {
    const [profile, ratios, income, balance, cashflow] = await Promise.all([
      fmpGet(q('profile')),
      fmpGet(q('ratios-ttm')),
      fmpGet(q('income-statement', '&period=quarter&limit=5')),
      fmpGet(q('balance-sheet-statement', '&period=quarter&limit=4')),
      fmpGet(q('cash-flow-statement', '&period=quarter&limit=4')),
    ]);

    const arr = d => (Array.isArray(d) ? d : []);

    const result = {
      profile: arr(profile)[0] || {},
      ratios: arr(ratios)[0] || {},
      income: arr(income),
      balance: arr(balance),
      cashflow: arr(cashflow),
    };
    setCache(cacheKey, result);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
