export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../_cache';

const FMP = 'https://financialmodelingprep.com/stable';

async function fmpFetch(endpoint, key) {
  const r = await fetch(`${FMP}/${endpoint}${endpoint.includes('?') ? '&' : '?'}apikey=${key}`);
  if (!r.ok) return null;
  try { return await r.json(); } catch { return null; }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'NVDA').toUpperCase();
  const key = process.env.FMP_API_KEY;
  if (!key) return Response.json({ error: 'FMP_API_KEY not set' }, { status: 500 });

  const cacheKey = `earn:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  try {
    const [calendar, income, history, surprises] = await Promise.all([
      fmpFetch(`earning-calendar?symbol=${symbol}`, key),
      fmpFetch(`income-statement?symbol=${symbol}&period=quarter&limit=5`, key),
      fmpFetch(`historical/earning_calendar?symbol=${symbol}&limit=5`, key),
      fmpFetch(`earnings-surprises?symbol=${symbol}&limit=5`, key),
    ]);

    let historyData = Array.isArray(history) && history.length > 0 ? history : [];
    if (historyData.length === 0 && Array.isArray(surprises) && surprises.length > 0) {
      historyData = surprises.map(s => ({
        date: s.date,
        eps: s.actualEarningResult,
        epsEstimated: s.estimatedEarning,
      }));
    }

    if (historyData.length === 0 && Array.isArray(income) && income.length > 0) {
      historyData = income.slice(0, 5).map(s => ({
        date: s.date,
        eps: s.eps,
        epsEstimated: s.epsdiluted || s.eps,
      }));
    }

    const result = {
      calendar: Array.isArray(calendar) ? calendar.filter(e => e.symbol === symbol).slice(0, 5) : [],
      history: historyData.slice(0, 12),
      quarterly_income: Array.isArray(income) ? income : [],
    };
    setCache(cacheKey, result);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
