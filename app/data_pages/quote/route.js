export const dynamic = 'force-dynamic';

import YahooFinance from 'yahoo-finance2';
import { getCached, setCache } from '../_cache';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('symbols') || '';
  const symbols = [...new Set(raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))];
  if (symbols.length === 0) return Response.json({ quotes: [] });

  const cacheKey = `quote:${symbols.sort().join(',')}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  try {
    const data = await yahoo.quote(symbols);
    const arr = Array.isArray(data) ? data : [data];
    const quotes = arr.map(q => ({
      symbol: q.symbol,
      name: q.shortName || q.longName || q.symbol,
      price: q.regularMarketPrice ?? null,
      change: q.regularMarketChange ?? null,
      changePct: q.regularMarketChangePercent ?? null,
      currency: q.currency || 'USD',
      marketState: q.marketState || null,
    }));
    const out = { quotes };
    setCache(cacheKey, out, 3 * 1000); // 3s — watchlist polls every 5s
    return Response.json(out);
  } catch (e) {
    return Response.json({ quotes: [], error: e.message }, { status: 200 });
  }
}