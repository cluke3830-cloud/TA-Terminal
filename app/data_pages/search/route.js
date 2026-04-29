export const dynamic = 'force-dynamic';

import YahooFinance from 'yahoo-finance2';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const ALLOWED_EX = new Set(['NMS', 'NYQ', 'PCX', 'ASE', 'NGM', 'NCM', 'BTS']);

async function fmpSearch(q, key) {
  if (!key) return null;
  try {
    const r = await fetch(`https://financialmodelingprep.com/stable/search-name?query=${encodeURIComponent(q)}&apikey=${key}`);
    if (!r.ok) return null;
    const j = await r.json();
    if (j?.['Error Message']) return null;
    const arr = Array.isArray(j) ? j : [];
    if (arr.length === 0) return null;
    return arr
      .filter((x) => ['NASDAQ', 'NYSE', 'AMEX'].includes(x.exchangeShortName))
      .slice(0, 8)
      .map((x) => ({ symbol: x.symbol, name: x.name || x.companyName || '' }));
  } catch { return null; }
}

async function yahooSearch(q) {
  try {
    const j = await yahoo.search(q, { newsCount: 0, quotesCount: 12 });
    const equities = (j?.quotes || []).filter((r) => r.symbol && (r.quoteType === 'EQUITY' || r.quoteType === 'ETF'));
    return equities
      .filter((r) => !r.exchange || ALLOWED_EX.has(r.exchange) || r.exchange.startsWith('N'))
      .slice(0, 8)
      .map((r) => ({ symbol: r.symbol, name: r.shortname || r.longname || r.symbol }));
  } catch { return []; }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') || '';
  if (!q) return Response.json({ results: [] });

  let results = await fmpSearch(q, process.env.FMP_API_KEY);
  if (!results || results.length === 0) {
    results = await yahooSearch(q);
  }
  return Response.json({ results: results || [] });
}