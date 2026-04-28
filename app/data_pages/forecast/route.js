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

  const cacheKey = `fc:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  try {
    const [targetSummary, grades, news] = await Promise.all([
      fmpGet(`${FMP}/price-target-summary?symbol=${symbol}&apikey=${key}`),
      fmpGet(`${FMP}/grades-consensus?symbol=${symbol}&apikey=${key}`),
      fmpGet(`${FMP}/stock-news?tickers=${symbol}&limit=5&apikey=${key}`),
    ]);

    const first = d => (Array.isArray(d) ? d[0] || null : d || null);

    // Build targets from price-target-summary (free tier compatible)
    let targets = null;
    const summary = first(targetSummary);

    if (summary) {
      targets = {
        targetHigh: summary.lastMonthAvgPriceTarget || null,
        targetLow: summary.allTimeAvgPriceTarget || null,
        targetMedian: summary.lastQuarterAvgPriceTarget || null,
        targetMean: summary.lastYearAvgPriceTarget || null,
        numberOfAnalysts: summary.lastYearCount || null,
      };
    }

    // Map grades-consensus
    const gradesData = first(grades);
    const upgrades = gradesData ? {
      strongBuy: gradesData.strongBuy || 0,
      buy: gradesData.buy || 0,
      hold: gradesData.hold || 0,
      sell: gradesData.sell || 0,
      strongSell: gradesData.strongSell || 0,
      consensus: gradesData.consensus || null,
    } : null;

    // Use stock-news, or empty if not available on free tier
    const newsData = Array.isArray(news) && news.length > 0 ? news : [];

    const result = { targets, upgrades, news: newsData.slice(0, 5) };
    setCache(cacheKey, result);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
