export const dynamic = 'force-dynamic';

import YahooFinance from 'yahoo-finance2';
import { getCached, setCache } from '../_cache';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const ONE_DAY = 24 * 60 * 60 * 1000;

async function fetchOne(symbol, period1, period2) {
  const cacheKey = `hist:${symbol}:${period1}:${period2}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  const res = await yahoo.chart(symbol, { period1, period2, interval: '1d' });
  const quotes = (res?.quotes || []).filter((q) => q && q.date && q.close != null);
  const out = quotes.map((q) => ({
    d: new Date(q.date).toISOString().slice(0, 10),
    c: q.close,
  }));
  setCache(cacheKey, out, ONE_DAY);
  return out;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbolsParam = (searchParams.get('symbols') || '').toUpperCase();
  const tickers = symbolsParam.split(',').map((s) => s.trim()).filter(Boolean);
  if (!tickers.length) return Response.json({ error: 'symbols required' }, { status: 400 });

  const start = searchParams.get('start') || '2018-01-01';
  const end = searchParams.get('end') || new Date().toISOString().slice(0, 10);
  const period1 = new Date(start);
  const period2 = new Date(end);
  if (isNaN(period1) || isNaN(period2) || period2 <= period1) {
    return Response.json({ error: 'invalid date range' }, { status: 400 });
  }

  // Chunk fetches to respect Yahoo rate limits (~5 req/sec).
  const series = {};
  const missing = [];
  const CHUNK = 5;
  for (let i = 0; i < tickers.length; i += CHUNK) {
    const chunk = tickers.slice(i, i + CHUNK);
    const results = await Promise.allSettled(chunk.map((s) => fetchOne(s, period1, period2)));
    chunk.forEach((sym, j) => {
      const r = results[j];
      if (r.status === 'fulfilled' && r.value.length > 5) {
        series[sym] = r.value;
      } else {
        missing.push({ ticker: sym, reason: r.status === 'rejected' ? String(r.reason).slice(0, 120) : 'no data' });
      }
    });
  }

  if (Object.keys(series).length === 0) {
    return Response.json({ error: 'no data for any ticker', missing }, { status: 404 });
  }

  // Align to intersection of trading days. Build a map per ticker first.
  const maps = {};
  Object.entries(series).forEach(([sym, arr]) => {
    maps[sym] = new Map(arr.map((p) => [p.d, p.c]));
  });
  const symList = Object.keys(maps);
  const baseDates = series[symList[0]].map((p) => p.d);
  const dates = baseDates.filter((d) => symList.every((s) => maps[s].has(d)));
  if (dates.length < 30) {
    return Response.json({ error: 'insufficient overlapping history', missing, available: dates.length }, { status: 404 });
  }
  const closes = {};
  symList.forEach((sym) => {
    closes[sym] = dates.map((d) => maps[sym].get(d));
  });

  return Response.json({ dates, closes, missing, ts: new Date().toISOString() });
}