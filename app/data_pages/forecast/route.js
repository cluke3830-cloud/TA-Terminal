export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../_cache';
import YahooFinance from 'yahoo-finance2';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const FMP = 'https://financialmodelingprep.com/stable';

function num(v) { return v?.raw ?? (typeof v === 'number' ? v : null); }

async function fmpForecast(symbol, key) {
  if (!key) return null;
  const get = async (path) => {
    try {
      const r = await fetch(`${FMP}/${path}${path.includes('?') ? '&' : '?'}apikey=${key}`);
      if (!r.ok) return null;
      const j = await r.json();
      if (j?.['Error Message']) return null;
      return j;
    } catch { return null; }
  };
  const [targetSummary, grades, news, priceTargets] = await Promise.all([
    get(`price-target-summary?symbol=${symbol}`),
    get(`grades-consensus?symbol=${symbol}`),
    get(`stock-news?tickers=${symbol}&limit=5`),
    get(`price-target?symbol=${symbol}&limit=50`),
  ]);
  const first = (d) => (Array.isArray(d) ? d[0] || null : d || null);
  const summary = first(targetSummary);
  const gradesData = first(grades);
  if (!summary && !gradesData && !(Array.isArray(news) && news.length)) return null;

  // Compute monthly/quarterly averages from individual targets when summary fields are null
  const avgFromTargets = (daysBack) => {
    if (!Array.isArray(priceTargets) || !priceTargets.length) return null;
    const cutoff = Date.now() - daysBack * 86400000;
    const recent = priceTargets.filter((t) => t.priceTarget && new Date(t.publishedDate).getTime() > cutoff);
    if (!recent.length) return null;
    return recent.reduce((s, t) => s + t.priceTarget, 0) / recent.length;
  };

  const targets = summary ? {
    targetHigh: summary.lastMonthAvgPriceTarget || avgFromTargets(30) || null,
    targetLow: summary.allTimeAvgPriceTarget || null,
    targetMedian: summary.lastQuarterAvgPriceTarget || avgFromTargets(90) || null,
    targetMean: summary.lastYearAvgPriceTarget || avgFromTargets(365) || null,
    numberOfAnalysts: summary.lastYearCount || (Array.isArray(priceTargets) ? priceTargets.length : null),
  } : null;

  const upgrades = gradesData ? {
    strongBuy: gradesData.strongBuy || 0,
    buy: gradesData.buy || 0,
    hold: gradesData.hold || 0,
    sell: gradesData.sell || 0,
    strongSell: gradesData.strongSell || 0,
    consensus: gradesData.consensus || null,
  } : null;

  return { targets, upgrades, news: Array.isArray(news) ? news.slice(0, 5) : [] };
}

async function yahooForecast(symbol) {
  const m = await yahoo.quoteSummary(symbol, {
    modules: ['financialData', 'recommendationTrend', 'upgradeDowngradeHistory'],
  }).catch(() => null);

  const fd = m?.financialData;
  const targets = fd ? {
    targetHigh: num(fd.targetHighPrice),
    targetLow: num(fd.targetLowPrice),
    targetMedian: num(fd.targetMedianPrice),
    targetMean: num(fd.targetMeanPrice),
    numberOfAnalysts: num(fd.numberOfAnalystOpinions),
  } : null;

  const trend = m?.recommendationTrend?.trend?.[0];
  const upgrades = trend ? {
    strongBuy: trend.strongBuy || 0,
    buy: trend.buy || 0,
    hold: trend.hold || 0,
    sell: trend.sell || 0,
    strongSell: trend.strongSell || 0,
    consensus: null,
  } : null;

  // Yahoo news (separate endpoint)
  let news = [];
  try {
    const search = await yahoo.search(symbol, { newsCount: 5, quotesCount: 0 });
    news = (search?.news || []).slice(0, 5).map((n) => ({
      title: n.title,
      url: n.link,
      site: n.publisher,
      publishedDate: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString().slice(0, 10) : null,
    }));
  } catch (_) { /* skip news */ }

  if (!targets && !upgrades && news.length === 0) return null;
  return { targets, upgrades, news };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'NVDA').toUpperCase();

  const cacheKey = `fc:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  let result = null;
  let source = 'fmp';
  try { result = await fmpForecast(symbol, process.env.FMP_API_KEY); } catch (_) {}
  if (!result) {
    try { result = await yahooForecast(symbol); source = 'yahoo'; } catch (_) {}
  }
  if (!result) {
    const empty = { targets: null, upgrades: null, news: [], source: 'unavailable' };
    setCache(cacheKey, empty, 5 * 60 * 1000);
    return Response.json(empty);
  }
  result.source = source;
  setCache(cacheKey, result, 60 * 60 * 1000);
  return Response.json(result);
}