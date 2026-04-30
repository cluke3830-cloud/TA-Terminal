export const dynamic = 'force-dynamic';

import YahooFinance from 'yahoo-finance2';
import { getCached, setCache } from '../_cache';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const FMP = 'https://financialmodelingprep.com/stable';

async function yahooNews(symbol) {
  try {
    const s = await yahoo.search(symbol, { newsCount: 10, quotesCount: 0 });
    return (s?.news || []).map((n) => ({
      title: n.title,
      url: n.link,
      source: 'yahoo',
      site: n.publisher,
      date: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : null,
    }));
  } catch { return []; }
}

async function fmpNews(symbol, key) {
  if (!key) return [];
  try {
    const r = await fetch(`${FMP}/stock-news?tickers=${symbol}&limit=10&apikey=${key}`);
    if (!r.ok) return [];
    const arr = await r.json();
    if (!Array.isArray(arr)) return [];
    return arr.map((n) => ({
      title: n.title,
      url: n.url,
      source: 'fmp',
      site: n.site,
      date: n.publishedDate ? new Date(n.publishedDate).toISOString() : null,
    }));
  } catch { return []; }
}

async function scoreSentiment(origin, titles) {
  if (!titles.length) return [];
  try {
    const r = await fetch(`${origin}/data_pages/sentiment/gpu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: titles }),
    });
    if (!r.ok) return [];
    const j = await r.json();
    return j.results || [];
  } catch { return []; }
}

function rolling(articles, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = articles.filter((a) => a.date && new Date(a.date).getTime() >= cutoff && a.sentiment);
  if (!recent.length) return null;
  const s = recent.reduce((sum, a) => sum + (a.sentiment.positive - a.sentiment.negative), 0);
  return +(s / recent.length).toFixed(4);
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'AMD').toUpperCase();
  const cacheKey = `news:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  const [yhoo, fmp] = await Promise.all([
    yahooNews(symbol),
    fmpNews(symbol, process.env.FMP_API_KEY),
  ]);

  // Dedupe by title.
  const seen = new Set();
  const merged = [...yhoo, ...fmp].filter((a) => {
    if (!a.title || seen.has(a.title)) return false;
    seen.add(a.title);
    return true;
  });
  // Sort by date desc.
  merged.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const origin = new URL(req.url).origin;
  const scores = await scoreSentiment(origin, merged.map((a) => a.title));
  const articles = merged.map((a, i) => ({
    ...a,
    sentiment: scores[i] || null,
  }));

  const result = {
    symbol,
    articles,
    rolling: {
      d7: rolling(articles, 7),
      d30: rolling(articles, 30),
    },
    sentimentAvailable: scores.length > 0,
    ts: new Date().toISOString(),
  };
  setCache(cacheKey, result, 15 * 60 * 1000);
  return Response.json(result);
}